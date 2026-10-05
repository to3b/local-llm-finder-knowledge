import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseCsv} from '../scripts/finder/live-data.js';
import {recommendationContext,shortlist,modelTiers,renderRecommendation,finderLink} from '../scripts/recommendation-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixtures=join(root,'tests/fixtures');
for(const [key,name] of Object.entries({ARTICLES_CSV:'Articles',MODELS_CSV:'Models',GPUS_CSV:'GPUs',CALIBRATIONS_CSV:'Calibrations'}))process.env[key]=join(fixtures,name+'.csv');
const csvText=await readFile(process.env.ARTICLES_CSV,'utf8'), parsed=parseCsv(csvText), headers=parsed.shift();
const rows=parsed.filter(r=>r.some(Boolean)).map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]||''])));
const ctx=await recommendationContext(rows);
assert.equal(ctx.curated.length,6);
assert.equal(ctx.models.length,136);assert.equal(ctx.gpus.length,142);

// The checked-in offline engine is byte-identical to the inspected main rules.
// Production CI checks out the current main repository instead of forking them.
const pin=JSON.parse(await readFile(join(root,'scripts/finder/provenance.json'),'utf8'));
for(const [name,sha] of Object.entries(pin.files)){
  const data=await readFile(join(root,'scripts/finder',name));
  assert.equal(createHash('sha256').update(data).digest('hex'),sha);
}
const mainEngine=await import(pathToFileURL(join(process.env.FINDER_SOURCE_ROOT || join(root,'scripts/finder'),'recommend.js')).href);
for(const gpu of ctx.gpus.filter(g=>rows.some(r=>r.Type==='Hardware'&&r['Entity IDs']===g.id))){
  for(const task of ['chat','coding']){
    const picks=shortlist(ctx,gpu,task);
    const direct=mainEngine.recommend({hardware:{...gpu,ramGB:32,speedKnown:true},useCases:[task],primaryUse:task,preference:3,minSpeed:1,contextK:4,quantization:'Q4_K_M'},ctx.curated.map(e=>e.model));
    assert.deepEqual(picks.map(x=>x.model.id),direct.catalog.map(x=>x.model.id),'Hardware picks must follow the main engine order');
    assert.ok(picks.every(x=>x.fits && x.requiredGB+x.reserveGB<=gpu.vramGB));
  }
}
const gpu12=ctx.gpus.find(g=>g.id==='rtx-3060'),gpu8=ctx.gpus.find(g=>g.id==='rtx-4060');
assert.ok(!shortlist(ctx,gpu12,'chat').some(x=>x.model.id==='extra-gpt-oss-20b'),'13.5 GB weights must not be recommended for full residency in 12 GB');
assert.ok(!shortlist(ctx,gpu8,'coding').some(x=>x.model.id==='model-11'),'14B coder must not be recommended for full residency in 8 GB');
for(const {model} of ctx.curated){
  const q=model.quantizations[0];
  const tiers=modelTiers(ctx,model,q,4);
  assert.ok(tiers.some(t=>t.fits));
  const firstFit=tiers.findIndex(t=>t.fits);
  assert.ok(tiers.slice(firstFit).every(t=>t.fits),'More memory must not lose a fit');
  const link=new URL(finderLink({model,memory:16},true),'https://preview.example');
  assert.equal(link.pathname,'/finder/');
  const prefill=new URLSearchParams(link.hash.slice(1));
  assert.equal(prefill.get('model'),model.id);
  assert.equal(prefill.get('q'),'Q4_K_M');
  assert.equal(prefill.get('j'),'improve');
  for(const quant of model.quantizations)for(const context of [4,16]){
    assert.deepEqual(ctx.estimate(model,quant,{vramGB:16,ramGB:32},context),mainEngine.estimate(model,quant,{vramGB:16,ramGB:32},context),'Both directions use the same memory calculation');
  }
}
const oss=ctx.models.find(m=>m.id==='extra-gpt-oss-20b');
assert.equal(modelTiers(ctx,oss,oss.quantizations[0],4).find(t=>t.vramGB===16).fits,true);
assert.equal(modelTiers(ctx,oss,oss.quantizations[0],32).find(t=>t.vramGB===16).fits,false,'32K context must not inherit the short-context 16 GB fit');
const ossHtml=renderRecommendation(rows.find(r=>r.Slug==='gpt-oss-20b'),ctx,'<p>Setup notes.</p>',true);
assert.ok(ossHtml.includes('MXFP4 profile'));assert.ok(!ossHtml.includes('<td>16.50 GB</td>'),'Generic Q5 extrapolation must not be presented as a native MXFP4 artifact');

const temporary=await mkdtemp(join(root,'.recommendation-test-'));
try{
  const output=join(temporary,'site');
  const run=(mode,file=process.env.ARTICLES_CSV,extra={})=>spawnSync(process.execPath,[join(root,'scripts/build-articles.mjs')],{encoding:'utf8',env:{...process.env,SITE_ROOT:output,KNOWLEDGE_BUILD_MODE:mode,PREVIEW_PUBLISHED_ONLY:'1',ARTICLES_CSV:file,...extra}});
  let result=run('sandbox');assert.equal(result.status,0,result.stderr);
  for(const row of rows){
    const dir={Model:'models',Hardware:'hardware',Guide:'guides'}[row.Type];
    const html=await readFile(join(output,dir,row.Slug,'index.html'),'utf8');
    assert.match(html,/<meta name="robots" content="noindex,follow">/);
    assert.ok(html.includes(`rel="canonical" href="${row['Canonical URL']}"`));
    assert.ok(!/docs\.google\.com\/spreadsheets|moderation|submitterHash|approved_by|calibrationEligible|Edit this draft/i.test(html),'Public output must not contain editing links or private submission controls');
    const schemas=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
    assert.ok(!schemas.some(s=>['Review','AggregateRating'].includes(s['@type'])));
    if(row.Type!=='Guide'){
      assert.match(html,/Planning estimates/);
      assert.ok(html.includes('href="/sandbox-refine.css"'),'Knowledge must load the shared final styling');
      assert.ok(html.includes('class="supporting topic-note"'),'Source notes must be readable as separate topics');
      assert.ok(!html.includes('Setup notes and limitations'),'The full-article disclosure must not return');
      assert.match(html,/class="test-invite"/);
      const invite=html.match(/href="(https:\/\/localllmfinder.com\/tests\/\?[^\"]+)"/)[1].replaceAll('&amp;','&');
      assert.equal(new URL(invite).searchParams.get(row.Type==='Model'?'model':'hardware'),row['Entity IDs']);
      assert.equal(new URL(invite).searchParams.get('from'),dir+'/'+row.Slug);
    }
  }
  assert.ok(!(await readFile(join(output,'sitemap.xml'),'utf8')).includes('<url>'),'No sandbox entries in a sitemap');
  const good=await readFile(join(output,'models/qwen3-8b/index.html'),'utf8');
  const broken=join(temporary,'invalid.csv');
  const invalid=csvText.replace(/,(?:Published|"Published"),/,',"2026-10-01",');
  assert.notEqual(invalid,csvText,'The invalid-status fixture must actually change a status');
  await writeFile(broken,invalid);
  result=run('production',broken);assert.notEqual(result.status,0,'Invalid Status must stop publication');
  assert.equal(await readFile(join(output,'models/qwen3-8b/index.html'),'utf8'),good,'Invalid status must preserve the last good page');
  result=run('production',process.env.ARTICLES_CSV,{MODELS_CSV:join(temporary,'missing.csv')});assert.notEqual(result.status,0);
  assert.equal(await readFile(join(output,'models/qwen3-8b/index.html'),'utf8'),good,'Failed catalogue validation must preserve the last good page');
  result=run('production');assert.equal(result.status,0,result.stderr);
  const production=await readFile(join(output,'models/qwen3-8b/index.html'),'utf8');
  assert.ok(production.includes('content="index,follow"'));
  assert.ok(production.includes('href="https://localllmfinder.com/#'));
  assert.ok(!production.includes('Sandbox preview'));
  const sitemap=await readFile(join(output,'sitemap.xml'),'utf8');
  assert.equal((sitemap.match(/<url>/g)||[]).length,13);
  assert.ok([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].every(m=>! /preview|chatgpt|\?|#/.test(m[1])));
}finally{await rm(temporary,{recursive:true,force:true});}
console.log('Recommendation parity, memory boundaries, MXFP4, prefilling, contribution links, privacy, noindex, sitemaps and failed-publication preservation passed.');

