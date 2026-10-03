import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseCsv} from '../scripts/finder/live-data.js';
import {recommendationContext,modelTiers,shortlist,renderRecommendation} from '../scripts/recommendation-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),fixtures=join(root,'tests/fixtures');
for(const [key,name]of Object.entries({MODELS_CSV:'Models',GPUS_CSV:'GPUs',CALIBRATIONS_CSV:'Calibrations'}))process.env[key]=join(fixtures,name+'.csv');
const batch=JSON.parse(await readFile(join(root,'draft-batch.json'),'utf8'));
const csv=await readFile(join(fixtures,'SandboxArticles.csv'),'utf8'),parsed=parseCsv(csv),headers=parsed.shift();
const rows=parsed.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
const ctx=await recommendationContext(rows,{includeDrafts:true}),published=await recommendationContext(rows);
assert.equal(ctx.curated.length,12);assert.equal(published.curated.length,6);
assert.ok(published.rows.every(r=>r.Status==='Published'));
for(const row of rows.filter(r=>r.Type==='Hardware')){
  const gpu=ctx.gpus.find(g=>g.id===row['Entity IDs']);
  for(const task of ['chat','coding']){
    const includeDrafts=row.Status==='Draft',entries=ctx.curated.filter(x=>includeDrafts||x.row.Status==='Published');
    const picks=shortlist(ctx,gpu,task,{includeDrafts});
    const direct=ctx.recommend({hardware:{...gpu,ramGB:32,speedKnown:true},useCases:[task],primaryUse:task,preference:3,minSpeed:1,contextK:4,quantization:'Q4_K_M'},entries.map(x=>x.model));
    assert.deepEqual(picks.map(x=>x.model.id),direct.catalog.map(x=>x.model.id));
    assert.ok(picks.every(x=>x.fits&&x.requiredGB+x.reserveGB<=gpu.vramGB));
  }
}
const minimums={'model-5':4,'model-9':24,'model-12':24,'model-16':12,'model-22':6,'extra-qwen3-coder-30b-a3b':24};
for(const entry of ctx.curated.filter(x=>x.row.Status==='Draft')){
  const tiers=modelTiers(ctx,entry.model,entry.model.quantizations[0]);
  assert.equal(tiers.find(t=>t.fits).vramGB,minimums[entry.model.id]);
  assert.ok(tiers.some(t=>t.fits&&t.vramGB-t.requiredGB-t.reserveGB>=2));
  assert.equal(renderRecommendation(entry.row,published,'<h2>Setup</h2>',false),null,'Drafts never render in production');
}
const gpu6=ctx.gpus.find(g=>g.id==='rtx-2060');
const coder7=shortlist(ctx,gpu6,'coding',{includeDrafts:true}).find(x=>x.model.id==='model-10');
assert.ok(coder7?.fits,'The existing calibrated 7B Coder fits narrowly in 6 GB at 4K');
assert.ok(gpu6.vramGB-coder7.requiredGB-coder7.reserveGB<0.5,'It must be described as a tight estimate');
const gpu10=ctx.gpus.find(g=>g.id==='rtx-3080-10');
assert.ok(!shortlist(ctx,gpu10,'chat',{includeDrafts:true}).some(x=>['model-8','model-11'].includes(x.model.id)));
const body='<h2>First question</h2><p>Short answer.</p>';
const moeHtml=renderRecommendation(rows.find(r=>r.Slug==='qwen3-coder-30b-a3b-instruct'),ctx,body,true);
assert.ok(moeHtml.includes('30.5B weights must fit'));
assert.ok(!moeHtml.includes('24 GB gives more headroom'));
assert.ok(moeHtml.includes('<th scope="row">32 GB</th>'),'Show a second tier when the first already has 2 GB spare');
const gemmaHtml=renderRecommendation(rows.find(r=>r.Slug==='gemma-3-12b'),ctx,body,true);
assert.ok(gemmaHtml.includes('Text inference only. Vision needs a matching projector'));
const temporary=await mkdtemp(join(root,'.draft-test-'));
try{
  const output=join(temporary,'site');
  const build=(mode,file=join(fixtures,'SandboxArticles.csv'))=>spawnSync(process.execPath,[join(root,'scripts/build-articles.mjs')],{encoding:'utf8',env:{...process.env,SITE_ROOT:output,KNOWLEDGE_BUILD_MODE:mode,ARTICLES_CSV:file}});
  let result=build('production');assert.equal(result.status,0,result.stderr);
  const refs=JSON.parse(await readFile(join(output,'references.json'),'utf8'));assert.equal(refs.articles.length,12);
  const sitemap=await readFile(join(output,'sitemap.xml'),'utf8');assert.equal((sitemap.match(/<url>/g)||[]).length,13);
  for(const draft of batch.drafts){
    await assert.rejects(access(join(output,{Model:'models',Hardware:'hardware'}[draft.type],draft.slug,'index.html')));
    assert.ok(!sitemap.includes('/'+draft.slug+'/'));
  }
  // Approval is simulated in an isolated CSV; no real row is promoted.
  const cell=x=>'"'+String(x).replaceAll('"','""')+'"';
  const promoted=join(temporary,'approved-fixture.csv');
  const ready=rows.map(r=>r.Status==='Draft'?{...r,Status:'Published','Date Published':'2026-10-03'}:r);
  const readyCtx=await recommendationContext(ready);
  const comparedModels=html=>[...html.match(/<div class="comparison-wrap"[^>]*>([\s\S]*?)<\/div>/)[1].matchAll(/href="(\/models\/[^\"]+)"/g)].map(m=>m[1]);
  for(const draft of batch.drafts.filter(d=>d.type==='Hardware')){
    const preview=renderRecommendation(rows.find(r=>r.Slug===draft.slug),ctx,body,true);
    const production=renderRecommendation(ready.find(r=>r.Slug===draft.slug),readyCtx,body,false);
    assert.deepEqual(comparedModels(production),comparedModels(preview),'Publishing must preserve the approved hardware comparison');
    if(['rtx-5090','rtx-6000-ada','rx-7900-xtx'].includes(draft.slug))assert.ok(comparedModels(production).includes('/models/qwen3-32b/'),'The larger chat option must survive publication');
  }
  await writeFile(promoted,[headers,...ready.map(r=>headers.map(h=>r[h]))].map(r=>r.map(cell).join(',')).join('\n')+'\n');
  result=build('production',promoted);assert.equal(result.status,0,result.stderr);
  const approvedRefs=JSON.parse(await readFile(join(output,'references.json'),'utf8'));assert.equal(approvedRefs.articles.length,24);
  const approvedSitemap=await readFile(join(output,'sitemap.xml'),'utf8');assert.equal((approvedSitemap.match(/<url>/g)||[]).length,25);
  for(const draft of batch.drafts){
    const html=await readFile(join(output,{Model:'models',Hardware:'hardware'}[draft.type],draft.slug,'index.html'),'utf8');
    assert.ok(html.includes('content="index,follow"'));
    assert.ok(!html.includes('Draft · awaiting your review')&&!html.includes('/drafts/'));
    assert.ok(html.includes('"datePublished":"2026-10-03"'));
  }
}finally{await rm(temporary,{recursive:true,force:true});}
console.log('Draft batch passed: shared recommendation parity, 6/10 GB boundaries, MoE and vision caveats, production exclusion and isolated publication readiness.');
