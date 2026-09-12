'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const { createStagingIntake } = require('../tools/lib/aws-staging-intake');
const keyArn = 'arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000001';
function harness() {
  const pair = crypto.generateKeyPairSync('ed25519'), rows = new Map(), messages = [];
  const flags = {}; let sequence = 0;
  const config = { environment: 'staging', table: 'fcc-staging-intake', keyArn,
    queueUrl: 'https://sqs.us-east-2.amazonaws.com/123456789012/fcc-staging-receipts',
    keyVersion: 'FCC-TEST-KEY-1', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    nextId: () => String(++sequence).padStart(26,'0'), now: () => '2026-09-12T00:00:00.000Z',
    db: { send: async command => {
      const input = command.input;
      if (command.constructor.name === 'GetCommand') { assert.equal(input.ConsistentRead,true); return { Item: rows.get(input.Key.pk) }; }
      if (command.constructor.name === 'ScanCommand') return { Items: [...rows.values()].filter(r => r.pk.startsWith('OUTBOX#')) };
      assert.equal(command.constructor.name,'TransactWriteCommand');
      if (flags.storageDown) throw Error('offline');
      const puts = input.TransactItems.map(t => t.Put);
      assert.equal(puts.length,2);
      for (const p of puts) { assert.equal(p.ConditionExpression,'attribute_not_exists(pk)'); if(rows.has(p.Item.pk)) throw Error('conflict'); }
      for (const p of puts) rows.set(p.Item.pk,structuredClone(p.Item));
      if (flags.ambiguousCommit) throw Error('response lost after commit');
      return {};
    } },
    kms: { send: async command => {
      if(flags.signingDown) throw Error('offline');
      assert.equal(command.input.MessageType,'RAW');assert.equal(command.input.SigningAlgorithm,'ED25519_SHA_512');
      return { KeyId: keyArn, SigningAlgorithm: 'ED25519_SHA_512', Signature: flags.badSignature ? Buffer.alloc(64) : crypto.sign(null,command.input.Message,pair.privateKey) };
    } },
    sqs: { send: async command => { if(flags.queueDown) throw Error('offline'); messages.push(JSON.parse(command.input.MessageBody)); return {}; } }
  };
  return { ...createStagingIntake(config), config, rows, flags, messages, pair };
}
function request(submission = { instrument_id:'FCC-TEST-I-1', claim:'日本語 — challenge' }) {
  return { requestContext:{http:{method:'POST'}}, headers:{'content-type':'application/json','idempotency-key':'a'.repeat(32)}, body:JSON.stringify(submission) };
}
test('receipt is independently verifiable and stored with outbox before acknowledgement',async()=>{
  const h=harness(), result=await h.handler(request());assert.equal(result.statusCode,202);
  assert.equal(h.rows.size,2);assert.equal(h.messages.length,1);
  const {receipt}=JSON.parse(result.body),{signature,...body}=receipt;
  assert.equal(crypto.verify(null,Buffer.from(canonicalize(body)),h.pair.publicKey,Buffer.from(signature,'base64')),true);
  assert.equal(receipt.challenge_content_sha256,crypto.createHash('sha256').update(canonicalize(JSON.parse(request().body))).digest('hex'));
  assert.equal(receipt.fixture_only,true);
});
test('retries and concurrent identical submissions retain one original receipt and timestamp',async()=>{
  const h=harness();const results=await Promise.all([h.handler(request()),h.handler(request())]);
  assert.ok(results.every(r=>r.statusCode===202));
  assert.deepEqual(JSON.parse(results[0].body).receipt,JSON.parse(results[1].body).receipt);
  assert.equal(h.rows.size,2);
  const retry=await h.handler(request());assert.deepEqual(JSON.parse(retry.body).receipt,JSON.parse(results[0].body).receipt);
  const restarted=createStagingIntake(h.config);
  assert.deepEqual(JSON.parse((await restarted.handler(request())).body).receipt,JSON.parse(results[0].body).receipt);
  const conflict=await h.handler(request({instrument_id:'FCC-TEST-I-1',claim:'different'}));assert.equal(conflict.statusCode,409);
});
test('queue failure retains receipt and dispatcher retries without claiming publication',async()=>{
  const h=harness();h.flags.queueDown=true;
  const result=await h.handler(request());assert.equal(result.statusCode,202);assert.equal(JSON.parse(result.body).queued,false);assert.equal(h.rows.size,2);
  assert.equal((await h.dispatch()).failed,1);h.flags.queueDown=false;
  assert.deepEqual(await h.dispatch(),{sent:1,failed:0,publication_active:false});
  assert.equal([...h.rows.values()].find(r=>r.pk.startsWith('OUTBOX#')).publication_status,'PENDING');
});
test('storage and signing failures never acknowledge an unpersisted receipt; ambiguous commits recover',async()=>{
  for(const flag of ['storageDown','signingDown','badSignature']){
    const h=harness();h.flags[flag]=true;assert.equal((await h.handler(request())).statusCode,503);assert.equal(h.rows.size,0);assert.equal(h.messages.length,0);
  }
  const h=harness();h.flags.ambiguousCommit=true;assert.equal((await h.handler(request())).statusCode,202);assert.equal(h.rows.size,2);
});
test('production configuration and identifiers are rejected; malformed challenge fields are retained for later triage',async()=>{
  const h=harness();assert.throws(()=>createStagingIntake({...h.config,environment:'production'}));
  assert.throws(()=>createStagingIntake({...h.config,table:'production'}));
  assert.equal((await h.handler(request({instrument_id:'FCC-I-000001'}))).statusCode,400);
  assert.equal((await h.handler(request({instrument_id:'FCC-TEST-I-1'}))).statusCode,202);
  assert.equal([...h.rows.values()].find(r=>r.receipt).submission.claim,undefined);
});
test('transport rejects invalid JSON, oversized bodies, absent retry keys and invalid methods',async()=>{
  for(const [patch,status] of [[{body:'{'},400],[{body:'x'.repeat(90001)},413],[{headers:{}},415],[{requestContext:{http:{method:'GET'}}},405],[{headers:{'content-type':'application/json'}},400]]){
    const h=harness();assert.equal((await h.handler({...request(),...patch})).statusCode,status);assert.equal(h.rows.size,0);
  }
  const h=harness(),event=request();event.body=Buffer.from(event.body).toString('base64');event.isBase64Encoded=true;assert.equal((await h.handler(event)).statusCode,202);
});
test('dispatcher follows scan cursors even when a filtered page is empty',async()=>{
  const h=harness(),cursor={pk:'cursor'};let calls=0;
  const service=createStagingIntake({...h.config,db:{send:async command=>{
    assert.equal(command.constructor.name,'ScanCommand');calls++;
    if(calls===1)return {Items:[],LastEvaluatedKey:cursor};
    assert.deepEqual(command.input.ExclusiveStartKey,cursor);
    return {Items:[{receipt_id:'test-receipt'}]};
  }}});
  assert.deepEqual(await service.dispatch(),{sent:1,failed:0,publication_active:false});assert.equal(calls,2);
});
