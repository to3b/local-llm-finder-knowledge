import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(path.join(root,'.article-build-test-'));
const output=path.join(temporary,'site'), csv=path.join(temporary,'articles.csv');
const headers=['Enabled','Type','Slug','Title','Summary','Body Markdown','Meta Title','Meta Description','Author','Date Published','Date Modified','Status','Canonical URL','Source URLs','Entity IDs','Related Articles'];
const article=(Type,Slug,Status='Published',extra={})=>({Enabled:'TRUE',Type,Slug,Title:Slug,Summary:'Article summary','Body Markdown':'## Memory\n\nUseful article body.','Meta Title':Slug,'Meta Description':'Article description',Author:'Local LLM Finder','Date Published':'2026-10-01','Date Modified':'2026-10-01',Status,'Canonical URL':`https://knowledge.localllmfinder.com/${{Model:'models',Guide:'guides'}[Type]}/${Slug}/`,'Source URLs':'https://huggingface.co/Qwen/Qwen3-8B',...extra});
const model=article('Model','example','Published',{'Entity IDs':'model-7','Related Articles':'guides/quant, guides/draft','Body Markdown':'## Memory\n\n[Compare hardware](https://localllmfinder.com/#d=gpu&g=rtx-3060&v=12) [[guides/quant|Quantization]] [[guides/draft|Draft guide]]'});
const draft=article('Guide','draft','Draft',{'Date Published':'','Body Markdown':'## Memory\n\n[Catalogue row](https://docs.google.com/spreadsheets/d/example/edit#gid=1&range=A1)','Source URLs':'https://docs.google.com/spreadsheets/d/example/edit#gid=1'});
const rows=[model,article('Guide','quant'),draft,article('Guide','held','Hold'),article('Guide','disabled','Draft',{Enabled:'FALSE'})];
async function build(records, mode='sandbox'){
  const lines=[headers,...records.map(row=>headers.map(key=>row[key]||''))].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(','));
  await writeFile(csv,lines.join('\n')+'\n');
  return spawnSync(process.execPath,[path.join(root,'scripts/build-articles.mjs')],{env:{...process.env,ARTICLES_CSV:csv,SITE_ROOT:output,KNOWLEDGE_BUILD_MODE:mode},encoding:'utf8'});
}
try {
  let run=await build(rows);
  assert.equal(run.status,0,run.stderr);
  const html=await readFile(path.join(output,'models/example/index.html'),'utf8');
  const referenceText=await readFile(path.join(output,'references.json'),'utf8');
  assert.ok(html.includes('href="https://localllmfinder.com/#d=gpu&amp;g=rtx-3060&amp;v=12"'),'Finder hash parameters must be escaped exactly once');
  assert.ok(!html.includes('&amp;amp;'),'URLs must not be double escaped');
  assert.ok(html.includes('href="https://knowledge.localllmfinder.com/guides/quant/"'));
  assert.ok(html.includes('href="https://knowledge.localllmfinder.com/guides/draft/"'));
  const references=JSON.parse(referenceText);
  assert.equal(references.articles.length,3);
  assert.equal(references.articles.find(a=>a.slug==='draft').status,'Draft');
  const draftHtml=await readFile(path.join(output,'guides/draft/index.html'),'utf8');
  assert.ok(draftHtml.includes('<meta name="robots" content="noindex,follow">'));
  assert.ok(draftHtml.includes('Draft reference'));
  assert.ok(!draftHtml.includes('Edit this draft'));
  assert.ok(!draftHtml.includes('https://docs.google.com/spreadsheets/d/'),'Spreadsheet source rows must not be visitor editing links');
  assert.ok(!draftHtml.includes('range=A4:Q4'),'Visitors must not receive spreadsheet editing links');
  assert.ok(!draftHtml.includes('application/ld+json'),'Drafts must not claim published Article metadata');
  assert.ok(html.includes('<meta name="robots" content="index,follow">'));
  assert.ok(html.includes('application/ld+json'));
  assert.ok(!(await readFile(path.join(output,'sitemap.xml'),'utf8')).includes('/guides/draft/'));
  await assert.rejects(access(path.join(output,'guides/held/index.html')));
  await assert.rejects(access(path.join(output,'guides/disabled/index.html')));
  for(const invalid of [article('Guide','invalid','Published',{'Body Markdown':''}),article('Model','duplicate','Draft',{'Entity IDs':'model-7'}),article('Guide','invalid-draft','Draft',{'Body Markdown':''})]){
    run=await build([...rows,invalid]);
    assert.notEqual(run.status,0,'Invalid publication must fail');
    assert.equal(await readFile(path.join(output,'models/example/index.html'),'utf8'),html,'Failed validation must preserve existing article pages');
    assert.equal(await readFile(path.join(output,'references.json'),'utf8'),referenceText,'Failed validation must preserve the deployed registry');
  }
  run=await build([article('Guide','draft-only','Draft',{'Date Published':''})]);
  assert.equal(run.status,0,run.stderr);
  assert.ok((await readFile(path.join(output,'index.html'),'utf8')).includes('content="noindex,follow"'));
  assert.ok(!(await readFile(path.join(output,'sitemap.xml'),'utf8')).includes('<url>'));
  run=await build([article('Guide','draft-only','Published')]);
  assert.equal(run.status,0,run.stderr);
  assert.ok((await readFile(path.join(output,'guides/draft-only/index.html'),'utf8')).includes('content="index,follow"'));
  assert.ok(!(await readFile(path.join(output,'guides/draft-only/index.html'),'utf8')).includes('Draft reference'));
  assert.ok((await readFile(path.join(output,'sitemap.xml'),'utf8')).includes('/guides/draft-only/'));
  run=await build(rows,'production');
  assert.equal(run.status,0,run.stderr);
  const publicReferences=JSON.parse(await readFile(path.join(output,'references.json'),'utf8'));
  assert.equal(publicReferences.articles.length,2);
  assert.ok(publicReferences.articles.every(a=>a.status==='Published'));
  await assert.rejects(access(path.join(output,'guides/draft/index.html')));
  await assert.rejects(access(path.join(output,'guides/draft-only/index.html')));
  const publicIndex=await readFile(path.join(output,'index.html'),'utf8');
  assert.ok(!publicIndex.includes('Drafts')&&!publicIndex.includes('id="reference-status"'));
  const publicModel=await readFile(path.join(output,'models/example/index.html'),'utf8');
  assert.ok(!publicModel.includes('href="https://knowledge.localllmfinder.com/guides/draft/"'));
  run=await build(rows,'invalid');assert.notEqual(run.status,0);
  const env={...process.env,ARTICLES_CSV:csv,SITE_ROOT:output};delete env.KNOWLEDGE_BUILD_MODE;
  run=spawnSync(process.execPath,[path.join(root,'scripts/build-articles.mjs')],{env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(await readFile(path.join(output,'references.json'),'utf8')).articles.length,2,'Unset build mode must default to published-only production');
  console.log('Article build passed: published-only production, sandbox-only drafts, status promotion, held/disabled exclusion, no visitor editor links, Finder links and transactional validation.');
} finally {await rm(temporary,{recursive:true,force:true});}
