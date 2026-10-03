import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {registry, enhanceArticle, renderIndex, modifiedDate} from './wiki.mjs';
import {recommendationContext, renderRecommendation, renderRecommendationHome} from './recommendation-pages.mjs';

const SITE_ROOT = process.env.SITE_ROOT || fileURLToPath(new URL('../', import.meta.url));
const BUILD_MODE = process.env.KNOWLEDGE_BUILD_MODE || 'production';
const PREVIEW = BUILD_MODE === 'sandbox';
if (!['production', 'sandbox'].includes(BUILD_MODE)) throw new Error('Invalid KNOWLEDGE_BUILD_MODE.');
const SITE_ORIGIN = 'https://knowledge.localllmfinder.com';
const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQrzDgQUmV8FDdt8HDHgg0YzpyJmR28TKqxRGhkg4kW2LK7-ncnt1z_nEKgg8MJecNxt0MGLcm0syD1/pub';
const ARTICLES_GID = '323200577';
const OWNED_DIRECTORIES = ['models', 'hardware', 'guides'];
const REQUIRED = [
  'Enabled', 'Type', 'Slug', 'Title', 'Summary', 'Body Markdown', 'Meta Title',
  'Meta Description', 'Author', 'Date Published', 'Date Modified', 'Status',
  'Canonical URL', 'Source URLs'
];
const TYPE_DIR = Object.freeze({ Model: 'models', Hardware: 'hardware', Guide: 'guides' });

function sheetUrl(gid) {
  return `${SHEET_BASE}?gid=${gid}&single=true&output=csv`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some(value => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function recordsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 1) throw new Error('Knowledge Articles CSV is empty.');
  const headers = rows[0].map(value => value.trim());
  for (const column of REQUIRED) {
    if (!headers.includes(column)) throw new Error(`Knowledge Articles is missing required column: ${column}`);
  }
  return rows.slice(1).map((values, index) => ({...Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ''])), '_Sheet Row': index + 2}));
}

function enabled(value) {
  return /^(true|1|yes|y|on)$/i.test(String(value || '').trim());
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, SITE_ORIGIN);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function inlineMarkdown(value) {
  let text = esc(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => {
    // The text was escaped above; decode ampersands before validating the URL
    // so multi-parameter Finder links receive exactly one HTML escaping pass.
    const safe = safeUrl(href.replaceAll('&amp;', '&'));
    return safe ? `<a href="${esc(safe)}">${label}</a>` : label;
  });
  return text;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
  const out = [];
  let paragraph = [];
  let listOpen = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    out.push('</ul>');
    listOpen = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      flushParagraph(); closeList(); out.push(`<h3>${inlineMarkdown(h3[1])}</h3>`); continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flushParagraph(); closeList(); out.push(`<h2>${inlineMarkdown(h2[1])}</h2>`); continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!listOpen) { out.push('<ul>'); listOpen = true; }
      out.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

function articlePath(row) {
  const type = String(row.Type || '').trim();
  const slug = String(row.Slug || '').trim();
  const directory = TYPE_DIR[type];
  if (!directory) throw new Error(`Unsupported article Type "${type}" for ${slug || '(missing slug)'}.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid slug: ${slug}`);
  return { directory, slug, relative: `${directory}/${slug}/index.html` };
}

function validateArticle(row) {
  const { directory, slug } = articlePath(row);
  const published = /^published$/i.test(String(row.Status).trim());
  const required = ['Title', 'Summary', 'Body Markdown', 'Meta Title', 'Meta Description', 'Author', 'Date Modified', 'Canonical URL'];
  if (published) required.push('Date Published');
  for (const field of required) {
    if (!String(row[field] || '').trim()) throw new Error(`Available article ${slug} is missing ${field}.`);
  }
  const expected = `${SITE_ORIGIN}/${directory}/${slug}/`;
  const canonical = safeUrl(row['Canonical URL']);
  if (canonical !== expected) throw new Error(`Canonical URL for ${slug} must be ${expected}`);
  for (const field of ['Date Published', 'Date Modified']) {
    if (!published && field === 'Date Published' && !String(row[field] || '').trim()) continue;
    const value = String(row[field]).trim();
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error(`${field} for ${slug} must be a real date in YYYY-MM-DD format.`);
  }
  if (published && String(row['Date Modified']).trim() < String(row['Date Published']).trim()) throw new Error(`Date Modified for ${slug} must not precede Date Published.`);
  if (published && !sourceList(row).some(url => !/^https?:\/\/docs\.google\.com\/spreadsheets\//.test(url))) throw new Error(`Published article ${slug} needs a public documentation source.`);
}

function sourceList(row) {
  return String(row['Source URLs'] || '')
    .split(/\r?\n|\s*,\s*/)
    .map(value => safeUrl(value))
    .filter(Boolean);
}

function renderArticle(row) {
  validateArticle(row);
  const { directory, slug } = articlePath(row);
  const canonical = `${SITE_ORIGIN}/${directory}/${slug}/`;
  const title = String(row.Title).trim();
  const summary = String(row.Summary).trim();
  const metaTitle = String(row['Meta Title']).trim();
  const metaDescription = String(row['Meta Description']).trim();
  const author = String(row.Author).trim();
  const published = String(row['Date Published']).trim();
  const modified = modifiedDate(row['Date Modified']);
  const isPublished = /^published$/i.test(String(row.Status).trim());
  const draftNotice = isPublished ? '' : `<aside class="draft-notice"><strong>Draft reference</strong><p>Catalogue details and planning guidance are awaiting source review.</p></aside>`;
  const sources = sourceList(row);
  const body = markdownToHtml(row['Body Markdown']).replace(/<a href="https:\/\/docs\.google\.com\/spreadsheets\/d\/[^"<>]+\/edit[^"<>]*">([\s\S]*?)<\/a>/g, '$1');
  const sourcesHtml = sources.length ? `
    <section class="doc-section article-sources">
      <h2>Sources</h2>
      <ul>${sources.map(url => /https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/edit/.test(url) ? '<li>Finder catalogue (awaiting source review)</li>' : `<li><a href="${esc(url)}" rel="noopener">${esc(url)}</a></li>`).join('')}</ul>
    </section>` : '';
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${canonical}#article`,
    url: canonical,
    headline: title,
    description: metaDescription,
    datePublished: published,
    dateModified: modified,
    author: { '@type': 'Organization', name: author, ...(author === 'Local LLM Finder' ? { '@id': 'https://localllmfinder.com/#organization', url: 'https://localllmfinder.com/dist/methodology.html#editorial-process' } : {}) },
    publisher: { '@type': 'Organization', '@id': 'https://localllmfinder.com/#organization', name: 'Local LLM Finder', url: 'https://localllmfinder.com/' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    isPartOf: { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: 'Local LLM Finder Knowledge' },
    inLanguage: 'en'
  }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#151719">
  <meta name="robots" content="${isPublished ? 'index' : 'noindex'},follow">
  <meta name="description" content="${esc(metaDescription)}">
  <link rel="canonical" href="${esc(canonical)}">
  <title>${esc(metaTitle)}</title>
  <meta property="og:type" content="article"><meta property="og:site_name" content="Local LLM Finder">
  <meta property="og:title" content="${esc(metaTitle)}"><meta property="og:description" content="${esc(metaDescription)}"><meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(metaTitle)}"><meta name="twitter:description" content="${esc(metaDescription)}">
  ${isPublished ? `<meta property="article:published_time" content="${esc(published)}"><meta property="article:modified_time" content="${esc(modified)}">` : ''}
  <link rel="icon" href="../../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/styles.css?v=20260929d">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/docs.css?v=20260929b">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/palette.css?v=20260929f">
  <link rel="stylesheet" href="../../docs.css">
  <style>
    .article-test-invite { margin-top: 24px; padding: 24px 0; border-top: 1px solid var(--line); }
    .article-test-invite h2 { margin: 0 0 8px; font-size: 1.12rem; font-weight: 620; }
    .article-test-invite p { margin: 0 0 14px; color: var(--muted); font-size: 1rem; }
    .article-test-invite a { color: var(--accent); border-radius: 0 !important; }
    .article-body{padding-top:8px}
    .article-body h2{margin:30px 0 9px;font-size:1.12rem;line-height:1.3;letter-spacing:-.015em;font-weight:620}
    .article-body h3{margin:23px 0 7px;font-size:.98rem;line-height:1.35;font-weight:610}
    .article-body p,.article-body li{max-width:735px;color:#c0c0bc;font-size:.88rem;line-height:1.68}
    .article-body p{margin:0}.article-body p+p{margin-top:11px}.article-body ul{margin:9px 0 0;padding-left:21px}
    .article-body a,.article-sources a{color:#dddcd7;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
    .article-body code{padding:2px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:#dddcd7;font-size:.82em}
  </style>
  ${isPublished ? `<script type="application/ld+json">${structured}</script>` : ''}
<link rel="stylesheet" href="../../sandbox-refine.css?v=cleanup-2"></head>
<body>
  <main class="docs-shell">
    <header class="site-topbar">
      <a class="site-brand" href="https://localllmfinder.com/">Local LLM Finder</a>
      <nav class="site-nav" aria-label="Site">
        <a href="https://localllmfinder.com/">Finder</a>
        <a class="knowledge-nav" href="/">Knowledge</a>
        <a href="https://localllmfinder.com/dist/methodology.html">Methodology</a>
      </nav>
    </header>

    <article>
      <header class="doc-hero">
        <p class="eyebrow">${esc(row.Type)} reference</p>
        <h1>${esc(title)}</h1>
        <p class="doc-lede">${esc(summary)}</p>
        <div class="doc-meta"><span class="doc-chip">${isPublished ? 'Published' : 'Draft'}</span><span>${author === 'Local LLM Finder' ? `<a href="https://localllmfinder.com/dist/methodology.html#editorial-process">${esc(author)}</a>` : esc(author)}</span><span>Updated <time datetime="${esc(modified)}">${esc(modified)}</time></span></div>
        ${draftNotice}
      </header>
      <div class="doc-body article-body">${body}</div>${sourcesHtml}
      <div class="doc-actions"><a class="doc-button primary" href="https://localllmfinder.com/">Use the Finder</a><a class="doc-button secondary" href="/">Back to Knowledge</a></div>
    </article>

    <footer class="doc-footer"><span>Local LLM Finder</span><nav aria-label="Footer"><a href="https://localllmfinder.com/">Finder</a><a href="/">Knowledge</a><a href="https://localllmfinder.com/dist/privacy.html">Privacy</a><a href="https://localllmfinder.com/dist/terms.html">Terms</a></nav></footer>
  </main>
</body>
</html>`;
}

function sitemapXml(rows) {
  const urls = [];
  if (rows.length) {
    const latest = rows.map(row => modifiedDate(row['Date Modified'] || row['Date Published'])).filter(Boolean).sort().at(-1);
    urls.push(`  <url><loc>${SITE_ORIGIN}/</loc>${latest ? `<lastmod>${esc(latest)}</lastmod>` : ''}</url>`);
  }
  for (const row of rows) {
    const canonical = safeUrl(row['Canonical URL']);
    const modified = modifiedDate(row['Date Modified'] || row['Date Published']);
    urls.push(`  <url><loc>${esc(canonical)}</loc><lastmod>${esc(modified)}</lastmod></url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

async function writeRelative(relative, content) {
  const target = join(SITE_ROOT, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function setHomepageIndexable(hasPublishedArticles) {
  const indexPath = join(SITE_ROOT, 'index.html');
  const current = await readFile(indexPath, 'utf8');
  const desired = hasPublishedArticles ? 'index,follow' : 'noindex,follow';
  const updated = current.replace(/<meta name="robots" content="(?:noindex|index),follow">/, `<meta name="robots" content="${desired}">`);
  if (updated === current && !current.includes(`<meta name="robots" content="${desired}">`)) {
    throw new Error('Could not locate the homepage robots meta tag.');
  }
  await writeFile(indexPath, updated, 'utf8');
}

async function main() {
  const csv = process.env.ARTICLES_CSV ? await readFile(process.env.ARTICLES_CSV, 'utf8') : await (async () => { const response = await fetch(sheetUrl(ARTICLES_GID), { redirect: 'follow' }); if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`); return response.text(); })();
  const records = recordsFromCsv(csv);
  // Reject malformed statuses before touching any generated pages. A date pasted
  // into Status must not silently remove a previously published URL.
  for (const row of records) {
    if (enabled(row.Enabled) && !/^(published|draft|hold)$/i.test(String(row.Status || '').trim())) {
      throw new Error(`Knowledge Articles row ${row['_Sheet Row']} has invalid Status: ${row.Status}`);
    }
  }
  const published = records.filter(row => enabled(row.Enabled) && /^published$/i.test(String(row.Status || '').trim()));
  const draftSlugs=new Set(String(process.env.PREVIEW_DRAFT_SLUGS||'').split(',').filter(Boolean));
  const available = PREVIEW && process.env.PREVIEW_PUBLISHED_ONLY !== '1' ? records.filter(row => enabled(row.Enabled) && ( /^published$/i.test(String(row.Status || '').trim()) || /^draft$/i.test(String(row.Status || '').trim()) && (!draftSlugs.size||draftSlugs.has(row.Slug)) )) : published;

  const seen = new Set();
  for (const row of available) {
    const { relative } = articlePath(row);
    if (seen.has(relative)) throw new Error(`Duplicate available article path: ${relative}`);
    seen.add(relative);
    validateArticle(row);
  }

  const references = registry(available);
  // All catalogue parsing, calibration and recommendation validation happens
  // before deleting generated directories, preserving the last good output.
  const recommendations = await recommendationContext(PREVIEW?available:published,{includeDrafts:PREVIEW});
  const outputs=[];
  for (const row of available) {
    const { relative } = articlePath(row);
    const recommendation = renderRecommendation(row,recommendations,markdownToHtml(row['Body Markdown']),PREVIEW);
    let html = recommendation || enhanceArticle(renderArticle(row), row, references);
    // Sandbox invitations are added by its existing transform; keep one per live article.
    const article = references.articles.find(a => a.key + '/index.html' === relative);
    if (!recommendation && ['Model', 'Hardware'].includes(article.type) && article.entityIds?.length) {
      const p = new URLSearchParams({[article.type === 'Model' ? 'model' : 'hardware']: article.entityIds[0], from: article.key});
      const heading = article.type === 'Model' ? 'Have you tried this LLM?' : 'Have you run a model on this GPU?';
      const description = article.type === 'Model' ? `Share how ${article.title} ran on your hardware.` : `Share a model you tried on ${article.title}.`;
      const invite = `<aside class="article-test-invite" aria-label="Share your experience"><h2>${heading}</h2><p>${esc(description)} A quick report is enough.</p><a class="doc-button secondary" href="https://localllmfinder.com/tests/?${esc(p)}">Share a test</a></aside>`;
      html = html.replace('</article>', invite + '</article>');
    }
    if (!recommendation) {
      html=html.replace('</head>','<link rel="stylesheet" href="../../recommendations.css"></head>');
      if (PREVIEW) {
        html=html.replace(/content="index,follow"/g,'content="noindex,follow"')
          .replaceAll('href="https://knowledge.localllmfinder.com/','href="/')
          .replaceAll('href="https://localllmfinder.com/dist/','href="/finder/')
          .replaceAll('href="https://localllmfinder.com/#','href="/finder/#')
          .replaceAll('href="https://localllmfinder.com/"','href="/finder/"')
          .replace(/<a class="knowledge-nav" href="[^"]+">/,'<a class="knowledge-nav" href="/">')
          .replace('<article>','<div class="preview-notice">Sandbox preview · Production is unchanged</div><article>');
        // Canonicals remain the existing production URLs, never preview paths.
        html=html.replace(/<link rel="canonical" href="[^"]+">/,`<link rel="canonical" href="${esc(row['Canonical URL'])}">`);
      }
    }
    outputs.push({relative,html});
  }

  let homepage=recommendations?renderRecommendationHome(recommendations,PREVIEW):renderIndex(references, {includeDrafts: PREVIEW});
  if (PREVIEW) homepage=homepage.replace(/content="index,follow"/g,'content="noindex,follow"');
  // Finish rendering before touching the last good generated pages.
  for (const directory of OWNED_DIRECTORIES) await rm(join(SITE_ROOT, directory), { recursive: true, force: true });
  for (const {relative,html} of outputs) await writeRelative(relative, html);
  await writeRelative('sitemap.xml', sitemapXml(PREVIEW ? [] : published));
  await writeRelative('references.json', JSON.stringify(references, null, 2) + '\n');
  await writeRelative('index.html', homepage);
  console.log(`Built ${available.length} available Knowledge articles: ${published.length} published, ${available.length - published.length} drafts.`);
}

await main();
