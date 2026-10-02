const origin = 'https://knowledge.localllmfinder.com';
const dirs = {Model:'models', Hardware:'hardware', Guide:'guides'};
export const escape = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const list = v => String(v || '').split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
export function registry(rows) {
  const articles = rows.map(r=>({key:`${dirs[r.Type]}/${r.Slug}`,type:r.Type,slug:r.Slug,title:r.Title,summary:r.Summary,url:r['Canonical URL'],status:/^draft$/i.test(String(r.Status).trim())?'Draft':'Published',entityIds:list(r['Entity IDs']),modified:r['Date Modified'],related:list(r['Related Articles']),body:r['Body Markdown']}));
  const keys = new Set(), ids = new Set();
  for(const a of articles) {
    if(!dirs[a.type] || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug) || a.url !== `${origin}/${a.key}/` || keys.has(a.key)) throw Error(`Invalid/duplicate reference: ${a.key}`);
    keys.add(a.key);
    for(const id of a.entityIds) {const key=`${a.type}:${id}`; if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id)||ids.has(key)||a.type==='Guide') throw Error(`Invalid/duplicate Entity ID: ${key}`); ids.add(key);}
    for(const key of a.related) if(!/^(models|hardware|guides)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw Error(`Related Articles must use type/slug: ${key}`);
    a.outgoing = [...new Set([...a.related,...[...String(a.body).matchAll(/\[\[((?:models|hardware|guides)\/[a-z0-9-]+)(?:\|[^\]]+)?\]\]/g)].map(m=>m[1]),...[...String(a.body).matchAll(/https:\/\/knowledge\.localllmfinder\.com\/((?:models|hardware|guides)\/[a-z0-9-]+)\//g)].map(m=>m[1])])];
  }
  // Keep published guides focused while drafts are being prepared in bulk.
  for(const a of articles) a.backlinks=articles.filter(b=>b.key!==a.key && (a.status==='Draft'||b.status==='Published') && b.outgoing.includes(a.key)).map(b=>b.key);
  return {version:1,articles:articles.map(({body,...a})=>a)};
}
export function enhanceArticle(html, row, data) {
  const key=`${dirs[row.Type]}/${row.Slug}`;
  const byKey=new Map(data.articles.map(a=>[a.key,a]));
  const current=byKey.get(key);
  html=html.replace(/\[\[((?:models|hardware|guides)\/[a-z0-9-]+)(?:\|([^\]]+))?\]\]/g,(_m,k,label)=>byKey.has(k)?`<a href="${escape(byKey.get(k).url)}">${label||escape(byKey.get(k).title)}</a>`:(label||escape(k.split('/')[1].replaceAll('-',' '))));
  // Hide links to unavailable (disabled or held) Knowledge pages.
  html=html.replace(/<a href="https:\/\/knowledge\.localllmfinder\.com\/((?:models|hardware|guides)\/[a-z0-9-]+)\/">([\s\S]*?)<\/a>/g,(m,k,label)=>byKey.has(k)?m:label);
  const toc=[];
  let n=0;
  html=html.replace(/<h2>([\s\S]*?)<\/h2>/g,(_m,label)=>{const id=`section-${++n}`;toc.push({id,label:label.replace(/<[^>]*>/g,'')});return `<h2 id="${id}">${label}</h2>`;});
  const related=[...new Set([...current.related,...current.outgoing])].filter(k=>k!==key && byKey.has(k));
  const links=ks=>`<ul>${ks.map(k=>`<li><a href="${escape(byKey.get(k).url)}">${escape(byKey.get(k).title)}</a></li>`).join('')}</ul>`;
  const nav=`<nav class="article-contents" aria-label="On this page"><strong>On this page</strong><ul>${toc.map(t=>`<li><a href="#${t.id}">${t.label}</a></li>`).join('')}</ul></nav>`;
  html=html.replace('<article>',`<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="../../">Knowledge</a><span> / </span><a href="../../#${dirs[row.Type]}">${escape(row.Type)} references</a><span> / ${escape(row.Title)}</span></nav><article>`).replace('<div class="doc-body article-body">',`${nav}<div class="doc-body article-body">`);
  const connections=(related.length?`<section class="doc-section"><h2>Related references</h2>${links(related)}</section>`:'')+(current.backlinks.length?`<section class="doc-section"><h2>Referenced by</h2>${links(current.backlinks)}</section>`:'');
  html=html.replace('<div class="doc-actions">',`${connections}<div class="doc-actions">`).replaceAll('href="/"','href="../../"');
  return html.replace('</head>','<link rel="stylesheet" href="../../wiki.css?v=2"></head>');
}
export function renderIndex(data, {includeDrafts = data.articles.some(a=>a.status==='Draft')} = {}) {
  const published=data.articles.filter(a=>a.status!=='Draft').length;
  const drafts=data.articles.length-published;
  const groups=Object.entries(dirs).map(([type,dir])=>{
    const articles=data.articles.filter(a=>a.type===type);
    const items=articles.map(a=>`<li data-reference-status="${a.status||'Published'}" data-reference-search="${escape(`${a.title} ${a.summary} ${a.type}`.toLowerCase())}"><a href="${escape(a.url)}">${escape(a.title)}</a>${a.status==='Draft'?'<span class="reference-draft">Draft</span>':''}<p>${escape(a.summary)}</p></li>`).join('');
    return `<section class="doc-section reference-group" id="${dir}"><h2>${type} references <span class="reference-count">(${articles.length})</span></h2>${items?`<ul class="reference-list">${items}</ul>`:'<p>No references yet.</p>'}</section>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="${published?'index':'noindex'},follow">
<meta name="description" content="Model requirements, hardware and practical guides for Local LLM Finder.">
<link rel="canonical" href="${origin}/"><title>Knowledge — Local LLM Finder</title>
<link rel="icon" href="./favicon.svg">
<link rel="stylesheet" href="https://localllmfinder.com/dist/styles.css?v=20260929d">
<link rel="stylesheet" href="./docs.css"><link rel="stylesheet" href="./wiki.css?v=2">
<link rel="stylesheet" href="./sandbox-refine.css?v=cleanup-2">
</head><body><main class="docs-shell">
<header class="site-topbar"><a class="site-brand" href="https://localllmfinder.com/">Local LLM Finder</a><nav class="site-nav" aria-label="Site"><a href="https://localllmfinder.com/">Finder</a><a class="knowledge-nav" href="./" aria-current="page">Knowledge</a><a href="https://localllmfinder.com/dist/methodology.html">Methodology</a></nav></header>
<header class="doc-hero"><h1>Model and hardware references</h1><p class="doc-lede">${includeDrafts ? 'Requirements, quantization, context and practical hardware guidance. Drafts are available for sandbox review.' : 'Requirements, quantization, context and practical hardware guidance.'}</p><p class="reference-totals">${published} published${includeDrafts ? ` · ${drafts} drafts` : ''}</p></header>
<div class="reference-search"><div class="reference-controls">
<div><label for="reference-search">Find a reference</label><input id="reference-search" type="search" placeholder="Search models, hardware or guides" aria-describedby="reference-search-status"></div>
${includeDrafts ? '<div><label for="reference-status">Show</label><select id="reference-status"><option value="all">All references</option><option value="Published">Published</option><option value="Draft">Drafts</option></select></div>' : ''}
</div><p id="reference-search-status" role="status" aria-live="polite">${data.articles.length} references</p></div>
<nav class="reference-types" aria-label="Reference categories"><a href="#models">Models</a><a href="#hardware">Hardware</a><a href="#guides">Guides</a></nav>
${groups}
<footer class="doc-footer"><span>Local LLM Finder</span><nav aria-label="Footer"><a href="https://localllmfinder.com/">Finder</a><a href="https://localllmfinder.com/dist/privacy.html">Privacy</a><a href="https://localllmfinder.com/dist/terms.html">Terms</a></nav></footer>
</main><script type="module" src="./wiki-search.js?v=2"></script></body></html>`;
}
