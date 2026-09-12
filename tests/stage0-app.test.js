'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const domain = require('../tools/lib/stage0-domain');
const { acceptanceFixtures, createWorkspace, makeFixture, reading, verifyReceipt } = require('../tools/lib/stage0-workspace');
const { createServer } = require('../tools/stage0-server');
const testRoot=path.resolve(__dirname,'..','.fcc-local','app-tests');
const temp = () => { fs.mkdirSync(testRoot,{recursive:true}); return fs.mkdtempSync(path.join(testRoot,'run-')); };
function cleanup(dir) { const resolved=path.resolve(dir); if(!resolved.startsWith(testRoot+path.sep))throw Error('Cleanup outside test workspace refused'); fs.rmSync(resolved,{recursive:true,force:true}); }
const submission = { identity:'FCC-TEST-IDENTITY', category:'ignored-risk', claim:'The threshold may be exceeded — 日本語', supporting_evidence:[{source_url:'https://example.test/evidence',content_sha256:'a'.repeat(64)}] };
const input = () => ({at:'2026-01-10T00:00:00.000Z',operator_confirmed:true,readings:[reading(80)]});
test('acceptance A-D preserve independent scoring and delayed-anchor precedence',()=>{
  const fixtures=acceptanceFixtures();
  assert.deepEqual(fixtures.map(i=>[i.resolution.outcome,i.resolution.process,i.resolution.ordering_evidence.level]),[['CORRECT','COMPLIANT','ANCHORED'],['INCORRECT','COMPLIANT','ANCHORED'],['CORRECT','VIOLATED','ANCHORED'],['CORRECT','COMPLIANT','PUBLISHED']]);
  for(const i of fixtures) assert.equal(domain.verifyFixture(i).valid,true);
  const a=domain.aggregates(fixtures);assert.deepEqual(a.hit_rate,{numerator:3,denominator:4,value:.75});assert.equal(a.process_violated.numerator,1);assert.equal(a.anchored_precedence.numerator,3);
});
test('verifier rejects changes to locked bytes, chain, projection and scoring',()=>{
  const original=acceptanceFixtures()[0];
  for(const mutate of [i=>i.locked.decision='tampered',i=>i.events[0].at='2026-01-02T00:00:00Z',i=>i.trivial=true,i=>i.resolution.outcome='INCORRECT',i=>i.events=[]]){
    const i=structuredClone(original);mutate(i);assert.equal(domain.verifyFixture(i).valid,false);
  }
});
test('terminal gating rejects early resolution, missing anchor, pending challenge, missing counter-thesis and absent operator confirmation',()=>{
  for(const mutate of [i=>i.opened_at='2026-01-09T00:00:00.000Z',i=>i.anchor=null,i=>i.challenges=[{status:'PENDING'}],i=>i.counter_thesis=null,i=>i.state='DRAFT']){
    const i=makeFixture('GATE');mutate(i);assert.throws(()=>domain.deriveResolution(i,input()));
  }
  assert.throws(()=>domain.deriveResolution(makeFixture('GATE'),{...input(),operator_confirmed:false}));
});
test('five dispositions retain frozen mappings and anti-erasure requirements',()=>{
  const i=makeFixture('MAP');
  assert.equal(domain.deriveResolution(i,{...input(),conceded:true}).outcome,'INCORRECT');
  assert.throws(()=>domain.deriveResolution(i,{...input(),invalidated:true}));
  const invalid=domain.deriveResolution(i,{...input(),invalidated:true,defect:'Synthetic missing lock-time disclosure'});
  assert.equal(invalid.outcome,'UNSCORED');assert.equal(invalid.process,'VIOLATED');assert.equal(invalid.informational_outcome,'CORRECT');
  assert.throws(()=>domain.deriveResolution(i,{...input(),void:true}));
  const archive={source:'fixture-registry',unavailable:true};
  const v=domain.deriveResolution(i,{...input(),void:true,readings:[],unavailable_sources:[{source:'fixture-registry',archive,archive_sha256:domain.hash(archive)}]});assert.equal(v.terminal_disposition,'VOID');assert.equal(v.outcome,'UNSCORED');
});
test('readings reject source substitution, archive tampering and premature measurements',()=>{
  for(const mutate of [r=>r.source='unregistered',r=>r.value=1,r=>r.archive.value=1,r=>r.measured_at='2025-01-01T00:00:00.000Z']){const r=reading(80);mutate(r);assert.throws(()=>domain.deriveResolution(makeFixture('READING'),{...input(),readings:[r]}));}
});
test('7-day boundary is exact and public-publication delay cannot move the deadline',()=>{
  const c={received_at:'2026-01-01T00:00:00.000Z',public_at:'2026-01-06T00:00:00.000Z',status:'PENDING'};
  assert.equal(domain.responseStatus(c,'2026-01-08T00:00:00.000Z').breached,false);
  assert.equal(domain.responseStatus(c,'2026-01-08T00:00:00.001Z').breached,true);
});
test('signed test receipt survives restart; malformed input retained; caller cannot inject adjudication',()=>{
  const dir=temp();try{
    const w=createWorkspace(dir);w.createOpen('FCC-TEST-LIVE');
    const r=w.submitChallenge('FCC-TEST-LIVE',{...submission,responded_at:'2026-01-01T00:00:00.000Z',status:'UPHELD'},'2026-01-01T00:00:00.000Z');
    assert.equal(r.challenge.status,'PENDING');assert.equal(r.challenge.responded_at,undefined);assert.equal(verifyReceipt(r.receipt,r.public_key),true);
    assert.equal(verifyReceipt({...r.receipt,received_at:'2026-01-02T00:00:00.000Z'},r.public_key),false);
    const again=createWorkspace(dir).publicState();assert.equal(again.receipts.length,1);assert.equal('test_keys' in again,false);assert.equal(domain.verifyFixture(again.instruments[0]).valid,true);
    const malformed=w.submitChallenge('FCC-TEST-LIVE',{claim:'invalid'},'2026-01-02T00:00:00.000Z');assert.equal(malformed.challenge.status,'RETURNED-MALFORMED');assert.equal(w.publicState().receipts.length,2);
    assert.equal(w.submitChallenge('FCC-TEST-LIVE',submission,'2026-01-03T00:00:00.000Z').challenge.status,'CONSOLIDATED');
  }finally{cleanup(dir);}
});
test('HTTP boundary rejects cross-origin mutation, arbitrary paths and production identifiers',async()=>{
  const dir=temp(),server=createServer({workspace:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/api/fixture',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({id:'FCC-TEST-X'})})).status,403);
    assert.equal((await fetch(base+'/api/fixture',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:'FCC-I-000001'})})).status,400);
    assert.equal((await fetch(base+'/api/artifact?path=../../.git/config')).status,400);
    assert.equal((await fetch(base+'/api/fixture',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:'FCC-TEST-HTTP'})})).status,201);
    const state=await(await fetch(base+'/api/state')).json();assert.equal(state.instruments.length,1);assert.equal(state.capabilities.production_publication,false);
    const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  }finally{await new Promise(r=>server.close(r));cleanup(dir);}
});
