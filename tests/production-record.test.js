'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),path=require('path');
const {REPOSITORY,buildPlan,verifyProductionRecord}=require('../tools/lib/production-record');
const bytes=Buffer.from('exact UTF-8 bytes — 日本語\n');
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const plan={repository:REPOSITORY,commit:'a'.repeat(40),artifacts:[{path:'record/example.json',expected_sha256:digest}]};
test('anonymous readback binds raw bytes to an immutable commit without credentials',async()=>{
  const result=await verifyProductionRecord(plan,{fetchImpl:async(url,options)=>{
    assert.equal(url,`https://raw.githubusercontent.com/${REPOSITORY}/${plan.commit}/record/example.json`);
    assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    return new Response(bytes);
  }});
  assert.equal(result.status,'VERIFIED');assert.equal(result.matched,1);
});
test('corruption, absent bytes, rate limits, network errors and oversize responses cannot verify',async()=>{
  const cases=[['MISMATCH',async()=>new Response('changed')],['NOT_FOUND',async()=>new Response('',{status:404})],['HTTP_ERROR',async()=>new Response('',{status:429})],['UNAVAILABLE',async()=>{throw Error('network');}],['TOO_LARGE',async()=>new Response(Buffer.alloc(2048))]];
  for(const [status,fetchImpl] of cases){const result=await verifyProductionRecord(plan,{fetchImpl,maxBytes:1024});assert.equal(result.status,'FAILED');assert.equal(result.artifacts[0].status,status);}
});
test('timeout aborts the request and remains unverified',async()=>{
  const result=await verifyProductionRecord(plan,{timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  assert.equal(result.artifacts[0].status,'UNAVAILABLE');
});
test('reject mutable refs, alternate repositories, duplicate targets and path traversal before networking',async()=>{
  for(const bad of [{...plan,commit:'main'},{...plan,repository:'other/repo'},{...plan,artifacts:[]},{...plan,artifacts:[...plan.artifacts,...plan.artifacts]},{...plan,artifacts:[{...plan.artifacts[0],path:'record/../../secret'}]}]){
    await assert.rejects(verifyProductionRecord(bad,{fetchImpl:async()=>{throw Error('Network must not run');}}));
  }
});
test('plan derives pinned hashes from committed blobs, including every record file',()=>{
  const p=buildPlan(path.join(__dirname,'..'));assert.match(p.commit,/^[a-f0-9]{40}$/);assert.ok(p.artifacts.some(a=>a.path==='governance/evidence/byte-exact-manifest.json'));assert.ok(p.artifacts.some(a=>a.manifest_pinned));assert.ok(p.artifacts.some(a=>a.path.startsWith('record/')));
});
