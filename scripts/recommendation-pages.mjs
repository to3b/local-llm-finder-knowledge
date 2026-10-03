import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {escape as e, modifiedDate} from './wiki.mjs';

// These mappings select existing, reviewed article subjects, not new scoring rules.
// Names, memory profiles, quantizations and ranking come from the main Finder.
export const subjects = Object.freeze({
  'qwen3-4b': {id:'model-6', task:'chat', use:'Small general-purpose model', note:'Leaves more memory for other applications. Check answers on your own tasks.', download:'https://huggingface.co/Qwen/Qwen3-4B-GGUF'},
  'qwen3-8b': {id:'model-7', task:'chat', use:'General chat and mixed tasks', note:'A middle-sized option with more memory headroom than the 14B models.', download:'https://huggingface.co/Qwen/Qwen3-8B-GGUF'},
  'qwen3-14b': {id:'model-8', task:'chat', use:'General chat with a larger model', note:'Uses more memory than 8B. A larger model is not proof of better answers for your task.', download:'https://huggingface.co/Qwen/Qwen3-14B-GGUF'},
  'qwen2-5-coder-7b': {id:'model-10', task:'coding', use:'Coding with a smaller memory budget', note:'A coding-focused model. Run and review generated code before using it.', download:'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF'},
  'qwen2-5-coder-14b': {id:'model-11', task:'coding', use:'Coding with a larger model', note:'More memory than the 7B version. Compare them on your own codebase.', download:'https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF'},
  'gpt-oss-20b': {id:'extra-gpt-oss-20b', task:'reasoning', use:'Reasoning and tool-oriented tasks', note:'Needs a runtime that supports MXFP4 and the Harmony conversation format.', download:'https://huggingface.co/openai/gpt-oss-20b'},
});

const defaultRoot = fileURLToPath(new URL('./finder/', import.meta.url));
const sheetBase = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQrzDgQUmV8FDdt8HDHgg0YzpyJmR28TKqxRGhkg4kW2LK7-ncnt1z_nEKgg8MJecNxt0MGLcm0syD1/pub';
async function csv(envName, gid) {
  if (process.env[envName]) return readFile(process.env[envName], 'utf8');
  const response = await fetch(`${sheetBase}?gid=${gid}&single=true&output=csv`, {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error(`${envName}: Google Sheets returned ${response.status}`);
  return response.text();
}

export async function recommendationContext(rows) {
  if (!rows.some(r=>r.Type==='Model' && /^published$/i.test(r.Status) && subjects[r.Slug])) return null;
  const root=process.env.FINDER_SOURCE_ROOT || defaultRoot;
  const [engine,parser,texts] = await Promise.all([
    import(pathToFileURL(join(root,'recommend.js')).href),
    import(pathToFileURL(join(root,'live-data.js')).href),
    Promise.all([csv('MODELS_CSV','624018495'),csv('GPUS_CSV','1333766306'),csv('CALIBRATIONS_CSV','500465526')]),
  ]);
  const models=parser.buildModelsFromCsv(texts[0]), gpus=parser.buildGpusFromCsv(texts[1]);
  parser.applySheetCalibrations(models,texts[2]);
  parser.validateCatalogue(models,gpus);
  const modelRows=rows.filter(r=>r.Type==='Model' && /^published$/i.test(r.Status) && subjects[r.Slug]);
  const curated=modelRows.map(r=>{
    const subject=subjects[r.Slug], model=models.find(m=>m.id===subject.id);
    if (!model || String(r['Entity IDs']).trim()!==subject.id) throw Error(`Unresolved model article: ${r.Slug}`);
    return {row:r,subject,model};
  });
  for (const r of rows.filter(r=>r.Type==='Hardware' && /^published$/i.test(r.Status))) {
    if (!gpus.some(g=>g.id===String(r['Entity IDs']).trim())) throw Error(`Unresolved hardware article: ${r.Slug}`);
  }
  return {models,gpus,curated,rows,estimate:engine.estimate,recommend:engine.recommend};
}

export const finderLink = ({gpu,model,task='chat',context=4,quant='Q4_K_M',memory=16}, preview=false) => {
  const p=new URLSearchParams({d:'gpu',r:'32',t:task,p:'3',c:String(context),q:quant,s:'1'});
  if (gpu) p.set('g',gpu.id); else p.set('v',String(memory));
  if (model) {p.set('model',model.id);p.set('j','improve');}
  return `${preview?'/finder/':'https://localllmfinder.com/'}#${p}`;
};
const quantLabel=(model,q)=>model.id==='extra-gpt-oss-20b'?'MXFP4 profile':q.name;
const hardware=(g)=>({...g,ramGB:32,speedKnown:true});
const kb='/';
const pathFor=(row)=>`${{Model:'models',Hardware:'hardware',Guide:'guides'}[row.Type]}/${row.Slug}/`;
const relative=(row,preview)=>`${preview?kb:'/'}${pathFor(row)}`;
const localize=(html,preview)=>preview?html.replaceAll('https://knowledge.localllmfinder.com/',kb).replaceAll('https://localllmfinder.com/dist/','/finder/').replaceAll('href="https://localllmfinder.com/#','href="/finder/#'):html;

export function shortlist(ctx,gpu,task) {
  const models=ctx.curated.map(x=>x.model);
  const result=ctx.recommend({hardware:hardware(gpu),useCases:[task],primaryUse:task,preference:3,minSpeed:1,contextK:4,quantization:'Q4_K_M'},models);
  return result.catalog.map(x=>({...x,entry:ctx.curated.find(y=>y.model.id===x.model.id)}));
}

export function modelTiers(ctx,model,q,context=4) {
  return [6,8,12,16,24,32,48].map(vramGB=>({vramGB,...ctx.estimate(model,q,{vramGB,ramGB:32},context)}));
}

function table(headers,rows,label) {
  return `<div class="comparison-wrap" role="region" aria-label="${e(label)}" tabindex="0"><table><thead><tr>${headers.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((x,i)=>i===0?`<th scope="row">${x}</th>`:`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function frame(row,content,{preview=false,title,description}={}) {
  const canonical=row?row['Canonical URL']:'https://knowledge.localllmfinder.com/';
  const name=title || row?.Title || 'Which local LLM fits your setup?';
  const desc=description || row?.['Meta Description'] || 'Choose your hardware or a local model to compare practical starting points, memory requirements and setup advice.';
  const published=row && /^published$/i.test(row.Status);
  const meta=published?{'@context':'https://schema.org','@type':'Article',headline:name,description:desc,url:canonical,datePublished:row['Date Published'],dateModified:modifiedDate(row['Date Modified']),author:{'@type':'Organization',name:row.Author},publisher:{'@type':'Organization',name:'Local LLM Finder',url:'https://localllmfinder.com/'},mainEntityOfPage:canonical}:null;
  const base=preview?kb:'/';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#151719"><meta name="robots" content="${preview || row && !published?'noindex,follow':'index,follow'}"><title>${e(name)} | Local LLM Finder</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(canonical)}"><meta property="og:type" content="${row?'article':'website'}"><meta property="og:title" content="${e(name)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(canonical)}"><meta name="twitter:card" content="summary"><link rel="icon" href="${base}favicon.svg"><link rel="stylesheet" href="${base}styles.css"><link rel="stylesheet" href="${base}docs.css"><link rel="stylesheet" href="${base}palette.css"><link rel="stylesheet" href="${base}sandbox-refine.css"><link rel="stylesheet" href="${base}recommendations.css">${meta?`<script type="application/ld+json">${JSON.stringify(meta).replaceAll('<','\\u003c')}</script>`:''}</head><body><main class="docs-shell"><header class="site-topbar"><a class="site-brand" href="${preview?'/finder/':'https://localllmfinder.com/'}">Local LLM Finder</a><nav class="site-nav" aria-label="Site"><a href="${preview?'/finder/':'https://localllmfinder.com/'}">Finder</a><a href="${base}" aria-current="page">Knowledge</a></nav></header>${preview?'<div class="preview-notice">Sandbox preview</div>':''}${row?`<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${base}">Knowledge</a><span>/</span><span>${e(row.Title)}</span></nav>`:''}${content}<footer class="doc-footer"><span>Local LLM Finder</span><nav aria-label="Footer"><a href="${base}guides/q4-vs-q5/">Quantisation</a><a href="${base}guides/context-length/">Context length</a><a href="${preview?'/finder/methodology.html':'https://localllmfinder.com/dist/methodology.html'}">Methodology</a><a href="https://localllmfinder.com/dist/privacy.html">Privacy</a><a href="https://localllmfinder.com/dist/terms.html">Terms</a></nav></footer></main><script type="module" src="${base}recommendations-ui.js"></script></body></html>`;
}

function contribution(row,preview) {
  const id=String(row['Entity IDs']).trim();
  const p=new URLSearchParams({[row.Type==='Model'?'model':'hardware']:id,from:`${pathFor(row).slice(0,-1)}`});
  // This remains the existing public form. QA never posts a synthetic report.
  return `<aside class="test-invite"><div><h2>${row.Type==='Model'?'Have you tried this LLM?':'Run a model on this GPU?'}</h2><p>A quick report helps check these estimates.</p></div><a class="doc-button secondary" href="https://localllmfinder.com/tests/?${e(p)}">Share a test</a></aside>`;
}

function sourceLabel(url) {
  const u=new URL(url);
  if(u.hostname.includes('nvidia.com'))return 'NVIDIA specifications';
  if(u.pathname.includes('config.json'))return 'Model configuration';
  if(u.pathname.includes('GGUF'))return 'Official GGUF files';
  if(u.hostname.includes('openai.com'))return 'OpenAI model card';
  if(u.hostname==='huggingface.co')return 'Publisher’s model card';
  return u.hostname;
}

function localBody(body,ctx,preview) {
  return localize(body.replace(/<a href="https:\/\/docs\.google\.com\/spreadsheets\/d\/[^"<>]+">([\s\S]*?)<\/a>/g,'$1')
    .replace(/\[\[((?:models|hardware|guides)\/[a-z0-9-]+)(?:\|([^\]]+))?\]\]/g,(_m,key,label)=>{const ref=ctx.rows.find(r=>pathFor(r).slice(0,-1)===key);return ref?`<a href="${relative(ref,preview)}">${e(label||ref.Title)}</a>`:e(label||key);}),preview);
}

function supporting(row,ctx,body,preview) {
  const related=ctx.rows.filter(r=>r.Slug!==row.Slug && String(row['Related Articles']).split(/[,\n]+/).map(x=>x.trim()).includes(pathFor(r).slice(0,-1)));
  const sources=String(row['Source URLs']).split(/\n|\s*,\s*/).filter(url=>/^https:\/\//.test(url) && !/docs\.google\.com\/spreadsheets/.test(url));
  const linked=localBody(body,ctx,preview);
  let section=0;
  const notes=linked.split(/(?=<h2>)/).filter(Boolean).map(part=>{
    const heading=part.match(/^<h2>([\s\S]*?)<\/h2>/);
    if(!heading)return `<div class="detail-body">${part}</div>`;
    return `<details class="supporting topic-note" id="note-${++section}"><summary>${heading[1]}</summary><div class="detail-body">${part.slice(heading[0].length)}</div></details>`;
  }).join('');
  // Keep previously published section fragments valid after the shorter edition.
  const aliases=[1,2,3,4,5].map(n=>`<span class="legacy-anchor" id="section-${n}" aria-hidden="true"></span>`).join('');
  const method=preview?'/finder/methodology.html':'https://localllmfinder.com/dist/methodology.html';
  return `<section class="support-section" aria-labelledby="setup-heading">${aliases}<h2 id="setup-heading">Setup and common questions</h2>${notes}<details class="supporting"><summary>How are these recommendations chosen?</summary><div class="detail-body"><p>We use the main Finder’s balanced task selection and memory calculation, limited to models with published guides here. Task scores and speed proxies are planning inputs, not measured quality rankings.</p><p>GPU memory includes weights, context cache and a 0.9 GB runtime allowance, plus a 3% reserve (0.15–1.5 GB). Cache format and runtime buffers can change the fit. <a href="${method}#memory-fit">See the calculation assumptions</a>.</p></div></details><details class="supporting" id="section-6"><summary>Sources and related guides</summary><div class="detail-body"><p>Specification sources checked 2 October 2026.</p><ul class="source-list">${sources.map(url=>`<li><a href="${e(url)}" rel="noopener">${e(sourceLabel(url))}</a></li>`).join('')}</ul>${related.length?`<ul class="related-links">${related.map(r=>`<li><a href="${relative(r,preview)}">${e(r.Title)}</a></li>`).join('')}</ul>`:''}</div></details><p class="evidence-note">These comparisons are planning estimates. No reviewed or independently reproduced measurements are available yet. <a href="${method}#evidence-labels">About test evidence</a>.</p></section>`;
}

function guidePage(row,ctx,body,preview) {
  let section=0;
  const headings=[];
  const linked=body.replace(/<a href="https:\/\/docs\.google\.com\/spreadsheets\/d\/[^"<>]+">([\s\S]*?)<\/a>/g,'$1')
    .replace(/\[\[((?:models|hardware|guides)\/[a-z0-9-]+)(?:\|([^\]]+))?\]\]/g,(_m,key,label)=>{const ref=ctx.rows.find(r=>pathFor(r).slice(0,-1)===key);return ref?`<a href="${relative(ref,preview)}">${e(label||ref.Title)}</a>`:e(label||key);})
    .replace(/<h2>([\s\S]*?)<\/h2>/g,(_m,title)=>{const id=`section-${++section}`;headings.push({id,title});return `<h2 id="${id}">${title}</h2>`;});
  const sources=String(row['Source URLs']).split(/\n|\s*,\s*/).filter(url=>/^https:\/\//.test(url)&&!/docs\.google\.com\/spreadsheets/.test(url));
  const related=ctx.rows.filter(r=>r.Slug!==row.Slug && String(row['Related Articles']).split(/[,\n]+/).map(x=>x.trim()).includes(pathFor(r).slice(0,-1)));
  const content=`<article><header class="doc-hero"><p class="eyebrow">Guide</p><h1>${e(row.Title)}</h1><p class="doc-lede">${e(row.Summary)}</p><p class="hero-caption">Local LLM Finder · Updated ${e(modifiedDate(row['Date Modified']))}</p></header><details class="supporting guide-contents"><summary>On this page</summary><ul>${headings.map(h=>`<li><a href="#${h.id}">${h.title}</a></li>`).join('')}</ul></details><div class="guide-content article-body">${localize(linked,preview)}</div><details class="supporting" id="section-${section+1}"><summary>Sources and related guides</summary><div class="detail-body"><ul>${sources.map(url=>`<li><a href="${e(url)}">${e(new URL(url).hostname+new URL(url).pathname)}</a></li>`).join('')}</ul><ul>${related.map(r=>`<li><a href="${relative(r,preview)}">${e(r.Title)}</a></li>`).join('')}</ul></div></details></article>`;
  return frame(row,content,{preview,title:row['Meta Title'].replace(/\s*[|—]\s*Local LLM Finder.*$/,''),description:row['Meta Description']});
}

function hardwarePage(row,ctx,body,preview) {
  const gpu=ctx.gpus.find(g=>g.id===String(row['Entity IDs']).trim());
  if (!gpu) return null;
  const chat=shortlist(ctx,gpu,'chat'), coding=shortlist(ctx,gpu,'coding');
  if (!chat.length) throw Error(`No curated model fits ${gpu.id}`);
  const first=chat[0], codingStart=coding.find(x=>x.entry.subject.task==='coding') || coding[0];
  const smallest=[...chat].sort((a,b)=>a.requiredGB-b.requiredGB)[0];
  const middle=chat.find(x=>!['extra-gpt-oss-20b','model-8'].includes(x.model.id)) || chat[1];
  const chosen=[...new Map([first,codingStart,middle,smallest].filter(Boolean).map(x=>[x.model.id,x])).values()];
  const modelAnchor=x=>`<a href="${relative(x.entry.row,preview)}">${e(x.model.name)}</a>`;
  const comparison=table(['Model / starting file','Why consider it','GPU memory estimate','Memory left¹'],chosen.map(x=>[`${modelAnchor(x)}<small>${e(quantLabel(x.model,x.quant))}</small>`,`${e(x.entry.subject.use)}<small>${e(x.entry.subject.note)}</small>`,`${x.requiredGB.toFixed(1)} GB`,`${(gpu.vramGB-x.requiredGB-x.reserveGB).toFixed(1)} GB`]),'Model memory comparison');
  const title=`Which local LLMs can an ${row.Title} run?`;
  const content=`<article><header class="doc-hero"><p class="eyebrow">Hardware → models</p><h1>${e(row.Title)}</h1><p class="doc-lede">Start with ${modelAnchor(first)} at ${e(quantLabel(first.model,first.quant))} for general chat. For a coding-focused option, try ${modelAnchor(codingStart)}.</p><div class="doc-actions"><a class="doc-button primary" href="${e(finderLink({gpu},preview))}">Use my ${e(row.Title)} in the Finder</a></div></header><section class="answer-section"><div class="section-heading"><h2>Models to start with</h2><span class="estimate-label">Planning estimates</span></div><p class="settings-line">${gpu.vramGB} GB dedicated VRAM · 4,000 tokens · 32 GB system RAM · full GPU residency</p>${comparison}<p class="table-note">From the published model guides here; the Finder covers the full catalogue. ¹ Memory left after the Finder’s reserve. Other applications can use this space. Larger models and higher precision do not guarantee better answers.</p><p class="limit-note">${gpu.vramGB<=8?'Keep context modest on this card. The 14B models above this tier do not fit the selected full-GPU profile.':gpu.vramGB===12?'14B Q4 profiles fit at 4K in this estimate, but leave less headroom. gpt-oss-20b does not fit this full-GPU budget.':gpu.vramGB===16?'gpt-oss-20b fits the short-context planning profile; its MXFP4 runtime requirements still matter. Longer context can exceed 16 GB.':'24 GB allows more context or a larger quantisation. It does not establish speed or output quality.'} CPU offloading changes the memory allocation and may slow generation.</p></section>${contribution(row,preview)}${supporting(row,ctx,body,preview)}</article>`;
  return frame(row,content,{preview,title,description:`Local model starting points for ${row.Title}: chat and coding choices, estimated GPU memory at 4K context, trade-offs and a prefilled Finder.`});
}

function modelPage(row,ctx,body,preview) {
  const entry=ctx.curated.find(x=>x.row.Slug===row.Slug); if (!entry) return null;
  const {model,subject}=entry;
  const quants=model.quantizations.filter(q=>q.name==='Q4_K_M'||model.id!=='extra-gpt-oss-20b' && q.name==='Q5_K_M');
  const q=quants[0], tiers=modelTiers(ctx,model,q), minimum=tiers.find(t=>t.fits), comfortable=tiers.find(t=>t.fits && t.vramGB-t.requiredGB-t.reserveGB>=2);
  if (!minimum || !comfortable) throw Error(`No memory tier for ${model.id}`);
  const choices=[minimum,...tiers.filter(t=>t.vramGB>minimum.vramGB && t.vramGB<=comfortable.vramGB+4)].slice(0,3);
  const comparisons=table(['Dedicated GPU memory','At 4,000 tokens','At 16,000 tokens','Example from these guides'],choices.map(t=>{const longer=ctx.estimate(model,q,{vramGB:t.vramGB,ramGB:32},16); const card=ctx.rows.find(r=>r.Type==='Hardware'&&ctx.gpus.find(g=>g.id===r['Entity IDs']&&g.vramGB===t.vramGB));return [`${t.vramGB} GB`,`${t.vramGB===minimum.vramGB?'Smallest listed tier that fits':'More headroom'}<small>${t.requiredGB.toFixed(1)} GB + ${t.reserveGB.toFixed(2)} GB reserve</small>`,`${longer.fits?'Fits the estimate':'Exceeds this budget'}<small>${longer.requiredGB.toFixed(1)} GB + reserve</small>`,card?`<a href="${relative(card,preview)}">${e(card.Title)}</a>`:'Compare your exact hardware in the Finder'];}),'Hardware memory tiers');
  const quantTable=table(['File profile','Weight input¹','GPU estimate at 4K','GPU estimate at 16K'],quants.map(quant=>[e(quantLabel(model,quant)),`${quant.weightsGB.toFixed(2)} GB`,`${ctx.estimate(model,quant,{vramGB:comfortable.vramGB,ramGB:32},4).requiredGB.toFixed(1)} GB`,`${ctx.estimate(model,quant,{vramGB:comfortable.vramGB,ramGB:32},16).requiredGB.toFixed(1)} GB`]),'Quantisation and context estimates');
  const title=`What hardware do you need for ${row.Title}?`;
  const content=`<article><header class="doc-hero"><p class="eyebrow">Model → hardware</p><h1>${e(row.Title)}</h1><p class="doc-lede">Plan for <strong>${minimum.vramGB} GB of dedicated GPU memory</strong> at ${e(quantLabel(model,q))} and a 4,000-token context. <strong>${comfortable.vramGB} GB gives more headroom</strong> under the same settings.</p><p class="hero-caption">${e(subject.use)}. Memory fit is an estimate, not a speed or quality guarantee.</p><div class="doc-actions"><a class="doc-button primary" href="${e(finderLink({model,task:subject.task,memory:comfortable.vramGB},preview))}">Check ${e(row.Title)} in the Finder</a><a class="doc-button secondary" href="${e(subject.download)}">Publisher’s downloads</a></div></header><section class="answer-section"><div class="section-heading"><h2>Hardware starting points</h2><span class="estimate-label">Planning estimates</span></div><p class="settings-line">${e(quantLabel(model,q))} · 32 GB system RAM · one active request · full GPU residency</p>${comparisons}<p class="table-note">The smallest tier fits the calculation; it is not a verified minimum. Cache precision and runtime buffers can change the fit. “More headroom” means at least 2 GB remains after the estimate and reserve.</p><p class="limit-note">${model.id==='extra-gpt-oss-20b'?'The publisher describes operation within 16 GB with native MXFP4. Use a compatible runtime and its Harmony chat template. This is a native MXFP4 planning profile, not an ordinary Q4_K_M or Q5 file.':`Use the publisher’s Instruct / chat template in a current GGUF-capable runtime. The ${minimum.vramGB} GB tier can become tight when display use, buffers or context grow.`} CPU offloading needs adequate system RAM and changes performance; it is not included in these full-GPU estimates.</p></section>${contribution(row,preview)}<details class="supporting"><summary>Compare quantisation and context</summary><div class="detail-body">${quantTable}<p>¹ Catalogue planning weights. These can differ from an exact downloaded file; runtime memory also includes cache and buffers.${model.id==='model-6'?' The current 4B profile uses a conservative 4.00 GB Q4 planning input rather than the publisher’s smaller download.':''}</p><p>Keep the exact file, runtime version, cache type and context limit consistent when comparing. ${model.id==='extra-gpt-oss-20b'?'Generic Q5/Q8 extrapolations are omitted for this native MXFP4 model.':'Q5 uses more memory; compare its answers on your own tasks before accepting the trade-off.'}</p></div></details>${supporting(row,ctx,body,preview)}</article>`;
  return frame(row,content,{preview,title,description:`Hardware and memory planning for ${row.Title}: ${minimum.vramGB} GB starting tier, ${comfortable.vramGB} GB with more headroom, quantisation, context and runtime limitations.`});
}

export function renderRecommendation(row,ctx,body,preview=false) {
  if (!ctx || !/^published$/i.test(row.Status)) return null;
  return row.Type==='Hardware'?hardwarePage(row,ctx,body,preview):row.Type==='Model'?modelPage(row,ctx,body,preview):row.Type==='Guide'?guidePage(row,ctx,body,preview):null;
}

export function renderRecommendationHome(ctx,preview=false) {
  const rows=ctx.rows.filter(r=>/^published$/i.test(r.Status));
  const tiles=(type)=>rows.filter(r=>r.Type===type).map(r=>{const entry=ctx.curated.find(x=>x.row.Slug===r.Slug);const g=ctx.gpus.find(g=>g.id===r['Entity IDs']);return `<a class="choice-card" href="${relative(r,preview)}"><strong>${e(r.Title)}</strong><span>${e(type==='Hardware'?`${g.vramGB} GB VRAM · model starting points`:entry?.subject.use || r.Summary)}</span></a>`;}).join('');
  const base=preview?kb:'/';
  return frame(null,`<header class="doc-hero home-hero"><p class="eyebrow">Local LLM Finder Knowledge</p><h1>What can you run?</h1><p class="doc-lede">Start with your hardware or a model you want to try.</p></header><nav class="intent-tabs" aria-label="Choose a starting point"><a href="#hardware" id="hardware-tab" aria-current="true">I own this hardware</a><a href="#models" id="models-tab">I want this model</a></nav><section id="hardware" class="intent-panel" aria-labelledby="hardware-heading"><div class="section-heading"><h2 id="hardware-heading">Choose your hardware</h2><a class="text-link" href="${preview?'/finder/':'https://localllmfinder.com/'}">Different setup? Use the Finder</a></div><div class="choice-grid">${tiles('Hardware')}</div></section><section id="models" class="intent-panel" aria-labelledby="models-heading"><div class="section-heading"><h2 id="models-heading">Choose a model</h2></div><div class="choice-grid">${tiles('Model')}</div></section><section class="guide-section" id="guides"><h2>Understand the settings</h2><div class="guide-links"><a href="${base}guides/q4-vs-q5/"><strong>Q4 or Q5?</strong><span>Choose a quantisation</span></a><a href="${base}guides/context-length/"><strong>How much context?</strong><span>Plan space for prompts and replies</span></a></div><p class="table-note">These pages offer planning estimates. For your exact setup and task, use the main Finder.</p></section>`,{preview,title:'Local LLM hardware and model guides'});
}
