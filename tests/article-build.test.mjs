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
const rows=[model,article('Guide','quant'),article('Guide','draft','Draft')];
async function build(records){
  const lines=[headers,...records.map(row=>headers.map(key=>row[key]||''))].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(','));
  await writeFile(csv,lines.join('\n')+'\n');
  return spawnSync(process.execPath,[path.join(root,'scripts/build-articles.mjs')],{env:{...process.env,ARTICLES_CSV:csv,SITE_ROOT:output},encoding:'utf8'});
}
try {
  let run=await build(rows);
  assert.equal(run.status,0,run.stderr);
  const html=await readFile(path.join(output,'models/example/index.html'),'utf8');
  const referenceText=await readFile(path.join(output,'references.json'),'utf8');
  assert.ok(html.includes('href="https://localllmfinder.com/#d=gpu&amp;g=rtx-3060&amp;v=12"'),'Finder hash parameters must be escaped exactly once');
  assert.ok(!html.includes('&amp;amp;'),'URLs must not be double escaped');
  assert.ok(html.includes('href="https://knowledge.localllmfinder.com/guides/quant/"'));
  assert.ok(!html.includes('href="https://knowledge.localllmfinder.com/guides/draft/"'));
  assert.equal(JSON.parse(referenceText).articles.length,2);
  assert.ok(!(await readFile(path.join(output,'sitemap.xml'),'utf8')).includes('/guides/draft/'));
  await assert.rejects(access(path.join(output,'guides/draft/index.html')));
  for(const invalid of [article('Guide','invalid','Published',{'Body Markdown':''}),article('Model','duplicate','Published',{'Entity IDs':'model-7'})]){
    run=await build([...rows,invalid]);
    assert.notEqual(run.status,0,'Invalid publication must fail');
    assert.equal(await readFile(path.join(output,'models/example/index.html'),'utf8'),html,'Failed validation must preserve existing article pages');
    assert.equal(await readFile(path.join(output,'references.json'),'utf8'),referenceText,'Failed validation must preserve the deployed registry');
  }
  console.log('Article build passed: Finder deep links, draft exclusion and transactional validation.');
} finally {await rm(temporary,{recursive:true,force:true});}
