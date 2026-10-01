import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {registry, enhanceArticle, renderIndex} from './wiki.mjs';

const SITE_ROOT = process.env.SITE_ROOT || fileURLToPath(new URL('../', import.meta.url));
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
      if (row.some(value => value.trim() !== '')) rows.push(row);
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
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
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
    const safe = safeUrl(href);
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
  const requiredForPublish = ['Title', 'Summary', 'Body Markdown', 'Meta Title', 'Meta Description', 'Author', 'Date Published', 'Date Modified', 'Canonical URL'];
  for (const field of requiredForPublish) {
    if (!String(row[field] || '').trim()) throw new Error(`Published article ${slug} is missing ${field}.`);
  }
  const expected = `${SITE_ORIGIN}/${directory}/${slug}/`;
  const canonical = safeUrl(row['Canonical URL']);
  if (canonical !== expected) throw new Error(`Canonical URL for ${slug} must be ${expected}`);
  for (const field of ['Date Published', 'Date Modified']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row[field]).trim())) throw new Error(`${field} for ${slug} must use YYYY-MM-DD.`);
  }
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
  const modified = String(row['Date Modified']).trim();
  const sources = sourceList(row);
  const body = markdownToHtml(row['Body Markdown']);
  const sourcesHtml = sources.length ? `
    <section class="doc-section article-sources">
      <h2>Sources</h2>
      <ul>${sources.map(url => `<li><a href="${esc(url)}" rel="noopener">${esc(url)}</a></li>`).join('')}</ul>
    </section>` : '';
  const structured = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: metaDescription,
    datePublished: published,
    dateModified: modified,
    author: { '@type': 'Organization', name: author },
    publisher: { '@type': 'Organization', name: 'Local LLM Finder', url: 'https://localllmfinder.com/' },
    mainEntityOfPage: canonical
  }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#151719">
  <meta name="robots" content="index,follow">
  <meta name="description" content="${esc(metaDescription)}">
  <link rel="canonical" href="${esc(canonical)}">
  <title>${esc(metaTitle)}</title>
  <link rel="icon" href="../../favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/styles.css?v=20260929d">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/docs.css?v=20260929b">
  <link rel="stylesheet" href="https://localllmfinder.com/dist/palette.css?v=20260929f">
  <link rel="stylesheet" href="../../docs.css">
  <style>
    .article-body{padding-top:8px}
    .article-body h2{margin:30px 0 9px;font-size:1.12rem;line-height:1.3;letter-spacing:-.015em;font-weight:620}
    .article-body h3{margin:23px 0 7px;font-size:.98rem;line-height:1.35;font-weight:610}
    .article-body p,.article-body li{max-width:735px;color:#c0c0bc;font-size:.88rem;line-height:1.68}
    .article-body p{margin:0}.article-body p+p{margin-top:11px}.article-body ul{margin:9px 0 0;padding-left:21px}
    .article-body a,.article-sources a{color:#dddcd7;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
    .article-body code{padding:2px 5px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:#dddcd7;font-size:.82em}
  </style>
  <script type="application/ld+json">${structured}</script>
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
        <div class="doc-meta"><span class="doc-chip">Published</span><span>Updated ${esc(modified)}</span></div>
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
    const latest = rows.map(row => String(row['Date Modified'] || row['Date Published']).trim()).filter(Boolean).sort().at(-1);
    urls.push(`  <url><loc>${SITE_ORIGIN}/</loc>${latest ? `<lastmod>${esc(latest)}</lastmod>` : ''}</url>`);
  }
  for (const row of rows) {
    const canonical = safeUrl(row['Canonical URL']);
    const modified = String(row['Date Modified'] || row['Date Published']).trim();
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
  const published = records.filter(row => enabled(row.Enabled) && /^published$/i.test(String(row.Status || '').trim()));

  const seen = new Set();
  for (const row of published) {
    const { relative } = articlePath(row);
    if (seen.has(relative)) throw new Error(`Duplicate published article path: ${relative}`);
    seen.add(relative);
    validateArticle(row);
  }

  const references = registry(published);
  for (const directory of OWNED_DIRECTORIES) await rm(join(SITE_ROOT, directory), { recursive: true, force: true });
  for (const row of published) {
    const { relative } = articlePath(row);
    await writeRelative(relative, enhanceArticle(renderArticle(row), row, references));
  }

  await writeRelative('sitemap.xml', sitemapXml(published));
  await writeRelative('references.json', JSON.stringify(references, null, 2) + '\n');
  await writeRelative('index.html', renderIndex(references));
  console.log(`Built ${published.length} published Knowledge article(s).`);
}

await main();
