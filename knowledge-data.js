const LIVE_KNOWLEDGE = Object.freeze({
  base: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQrzDgQUmV8FDdt8HDHgg0YzpyJmR28TKqxRGhkg4kW2LK7-ncnt1z_nEKgg8MJecNxt0MGLcm0syD1/pub',
  copyGid: '835955627',
  pagesGid: '1942045981',
  articlesGid: '323200577'
});

const COPY_REQUIRED = ['Key', 'Current Text', 'Enabled', 'Status'];
const PAGE_REQUIRED = ['Enabled', 'Type', 'Slug', 'Title', 'Summary', 'Status', 'URL', 'Sort Order'];
const ARTICLE_REQUIRED = ['Enabled', 'Slug', 'Status', 'Canonical URL'];

function sheetUrl(gid) {
  return `${LIVE_KNOWLEDGE.base}?gid=${gid}&single=true&output=csv`;
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

function recordsFromCsv(text, required, label) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${label} CSV has no data rows.`);
  const headers = rows[0].map(value => value.trim());
  for (const column of required) {
    if (!headers.includes(column)) throw new Error(`${label} is missing required column: ${column}`);
  }
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function enabled(value) {
  return /^(true|1|yes|y|on)$/i.test(String(value).trim());
}

function isHeld(status) {
  return /^hold$/i.test(String(status || '').trim());
}

function safeHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw, window.location.href);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function buildCopy(text) {
  const records = recordsFromCsv(text, COPY_REQUIRED, 'Knowledge Copy');
  const copy = new Map();
  for (const row of records) {
    if (!enabled(row.Enabled) || isHeld(row.Status)) continue;
    const key = String(row.Key || '').trim();
    if (!key) continue;
    if (copy.has(key)) throw new Error(`Duplicate Knowledge Copy key: ${key}`);
    copy.set(key, String(row['Current Text'] ?? '').trim());
  }
  if (!copy.size) throw new Error('Knowledge Copy has no enabled rows.');
  return copy;
}

function buildPages(text) {
  const records = recordsFromCsv(text, PAGE_REQUIRED, 'Knowledge Pages');
  const pages = [];
  const slugs = new Set();
  for (const row of records) {
    if (!enabled(row.Enabled) || isHeld(row.Status)) continue;
    const type = String(row.Type || '').trim();
    const slug = String(row.Slug || '').trim();
    const title = String(row.Title || '').trim();
    const summary = String(row.Summary || '').trim();
    const status = String(row.Status || '').trim() || 'Coming soon';
    if (!type || !slug || !title || !summary) throw new Error('Enabled Knowledge Pages rows require Type, Slug, Title and Summary.');
    if (slugs.has(slug)) throw new Error(`Duplicate Knowledge page slug: ${slug}`);
    slugs.add(slug);
    const order = Number(row['Sort Order']);
    pages.push({
      type,
      slug,
      title,
      summary,
      status,
      url: safeHref(row.URL),
      order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER
    });
  }
  if (!pages.length) throw new Error('Knowledge Pages has no enabled rows.');
  return pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function buildArticles(text) {
  const records = recordsFromCsv(text, ARTICLE_REQUIRED, 'Knowledge Articles');
  const articles = new Map();
  for (const row of records) {
    if (!enabled(row.Enabled)) continue;
    const slug = String(row.Slug || '').trim();
    const status = String(row.Status || '').trim() || 'Draft';
    if (!slug) throw new Error('Enabled Knowledge Articles rows require a Slug.');
    if (articles.has(slug)) throw new Error(`Duplicate Knowledge article slug: ${slug}`);
    const published = /^published$/i.test(status);
    const url = published ? safeHref(row['Canonical URL']) : '';
    if (published && !url) throw new Error(`Published Knowledge article ${slug} requires a valid Canonical URL.`);
    articles.set(slug, { status, url });
  }
  return articles;
}

function mergePublishedArticles(pages, articles) {
  return pages.map(page => {
    const article = articles.get(page.slug);
    if (!article || !/^published$/i.test(article.status) || !article.url) return page;
    return { ...page, status: 'Published', url: article.url };
  });
}

function applyCopy(copy) {
  document.querySelectorAll('[data-copy-key]').forEach(element => {
    const value = copy.get(element.dataset.copyKey);
    if (value !== undefined) element.textContent = value;
  });
  document.querySelectorAll('[data-copy-href-key]').forEach(element => {
    const href = safeHref(copy.get(element.dataset.copyHrefKey));
    if (href) element.setAttribute('href', href);
  });
  const title = copy.get('page_title');
  if (title) document.title = title;
  const description = copy.get('meta_description');
  const meta = document.querySelector('meta[name="description"]');
  if (description && meta) meta.setAttribute('content', description);
}

function renderPages(pages) {
  const grid = document.querySelector('[data-knowledge-pages]');
  if (!grid) return;
  const fragment = document.createDocumentFragment();
  for (const page of pages) {
    const card = document.createElement('article');
    card.className = 'preview-card';
    card.dataset.slug = page.slug;

    const label = document.createElement('span');
    label.className = 'upcoming-label';
    label.textContent = page.status;
    card.append(label);

    const type = document.createElement('small');
    type.textContent = page.type;
    card.append(type);

    if (/^published$/i.test(page.status) && page.url) {
      const title = document.createElement('a');
      title.className = 'knowledge-card-title';
      title.href = page.url;
      title.textContent = page.title;
      card.append(title);
    } else {
      const title = document.createElement('strong');
      title.textContent = page.title;
      card.append(title);
    }

    const summary = document.createElement('p');
    summary.textContent = page.summary;
    card.append(summary);
    fragment.append(card);
  }
  grid.replaceChildren(fragment);
}

async function fetchCsv(gid, signal) {
  const response = await fetch(sheetUrl(gid), { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
  return response.text();
}

async function loadKnowledge() {
  const state = { source: 'bundled', reason: 'Live Knowledge data has not been loaded.' };
  window.__KNOWLEDGE_DATA_STATE = state;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const [copyText, pagesText, articlesText] = await Promise.all([
      fetchCsv(LIVE_KNOWLEDGE.copyGid, controller.signal),
      fetchCsv(LIVE_KNOWLEDGE.pagesGid, controller.signal),
      fetchCsv(LIVE_KNOWLEDGE.articlesGid, controller.signal)
    ]);
    const copy = buildCopy(copyText);
    const articles = buildArticles(articlesText);
    const pages = mergePublishedArticles(buildPages(pagesText), articles);
    applyCopy(copy);
    renderPages(pages);
    Object.assign(state, {
      source: 'live-sheet',
      reason: 'Validated Knowledge data loaded from the published Google Sheet.',
      pages: pages.length,
      articles: articles.size
    });
    document.body.dataset.knowledgeSource = 'live-sheet';
  } catch (error) {
    Object.assign(state, { source: 'bundled', reason: error instanceof Error ? error.message : 'Live Knowledge data could not be loaded.' });
    document.body.dataset.knowledgeSource = 'bundled';
  } finally {
    window.clearTimeout(timeout);
  }
}

loadKnowledge();
