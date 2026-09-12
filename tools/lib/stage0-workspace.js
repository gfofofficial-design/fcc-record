'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const domain = require('./stage0-domain');
const { appendInstrumentEvent } = require('./instrument-events');
const { dualCanonicalize } = require('./canonicalize');
const nextId = require('./ulid').makeUlidGenerator();
const clone = value => JSON.parse(JSON.stringify(value));
function snapshotHash(instrument) { const { events, ...data } = instrument; return domain.hash(data); }
function recordEvent(instrument, type, at) {
  instrument.events = appendInstrumentEvent(instrument.events, instrument.lock_sha256, { event_id: nextId(), type, at, payload: { fixture_only: true, snapshot_sha256: snapshotHash(instrument) } });
}
function makeFixture(letter) {
  const id = 'FCC-TEST-' + letter;
  const locked = { schema_version: '1', instrument_type: 'qualification-stance', instrument_id: id, decision: 'Fixture ' + letter + ': test measurement stays below 100', horizon: '2026-01-05T00:00:00.000Z', resolution_criteria: [{ criterion_id: 'depth', comparator: '<', threshold: 100 }], resolution_sources: [{ criterion_id: 'depth', primary_source: 'fixture-registry' }] };
  const lock_sha256 = crypto.createHash('sha256').update(dualCanonicalize(locked).bytes).digest('hex');
  const i = { instrument_id: id, fixture_only: true, state: 'OPEN', locked, lock_sha256, opened_at: '2026-01-01T00:00:00.000Z', trivial: false, disputed: false, counter_thesis: { content: 'Synthetic acceptance input: measurement may exceed the threshold.', label: 'FIXTURE — not an AI-generated adversarial review', model: null }, anchor: { fixture_only: true, blocktime: letter === 'D' ? '2026-01-07T00:00:00.000Z' : '2026-01-02T00:00:00.000Z' }, challenges: [], conduct_violations: [], events: [], resolution: null, resolution_input: null };
  recordEvent(i, 'filed-locked', i.opened_at);
  return i;
}
function reading(value) {
  const archive = { source: 'fixture-registry', measured_at: '2026-01-05T00:00:00.000Z', value };
  return { criterion_id: 'depth', ...archive, archive, archive_sha256: domain.hash(archive) };
}
function acceptanceFixtures() {
  return ['A','B','C','D'].map(letter => {
    const i = makeFixture(letter);
    if (['B','C'].includes(letter)) i.challenges.push({ challenge_id: 'FCC-TEST-CHALLENGE-'+letter, identity: 'FCC-TEST-IDENTITY', category: 'ignored-risk', claim: 'Synthetic adverse measurement', supporting_evidence: [], status: letter === 'B' ? 'UPHELD' : 'NOT-UPHELD', received_at: '2026-01-01T00:00:00.000Z', responded_at: letter === 'B' ? '2026-01-02T00:00:00.000Z' : '2026-01-09T00:00:00.000Z', resolution: { rationale: 'Synthetic fixture resolution; not a human adjudication', fixture_only: true } });
    i.resolution_input = { at: '2026-01-10T00:00:00.000Z', operator_confirmed: true, readings: [reading(letter === 'B' ? 120 : 80)] };
    i.resolution = domain.deriveResolution(i, i.resolution_input);
    i.state = 'TERMINAL';
    recordEvent(i, 'resolution-recorded', i.resolution_input.at);
    return i;
  });
}
function verifyReceipt(receipt, publicKey) {
  try { const { signature, ...body } = receipt; return crypto.verify(null, Buffer.from(canonicalize(body)), publicKey, Buffer.from(signature, 'base64')); } catch { return false; }
}
function createWorkspace(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'workspace.json');
  const lockFile = path.join(directory, 'workspace.lock');
  function read() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, instruments: [], receipts: [], corrections: [], filings: [] }; }
  function transaction(fn) {
    let lock;
    try { lock = fs.openSync(lockFile, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new Error('Workspace busy; retry the operation'); throw e; }
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      const data = read(); const result = fn(data);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
      return result;
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); fs.closeSync(lock); fs.unlinkSync(lockFile); }
  }
  function keys(data) {
    if (!data.test_keys) {
      const pair = crypto.generateKeyPairSync('ed25519');
      data.test_keys = { private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
    }
    return data.test_keys;
  }
  function publicState() { const { test_keys, ...data } = read(); return { ...data, receipt_public_key: test_keys?.public || null, aggregates: domain.aggregates(data.instruments, data.filings), capabilities: { fixture_only: true, production_publication: false, wallet_operations: false, passkey_registration: false, bitcoin_verification: false } }; }
  function loadAcceptance() {
    return transaction(data => {
      if (data.instruments.some(i => ['FCC-TEST-A','FCC-TEST-B','FCC-TEST-C','FCC-TEST-D'].includes(i.instrument_id))) throw new Error('Acceptance fixtures already exist; existing work is preserved');
      data.instruments.push(...acceptanceFixtures()); return { added: 4 };
    });
  }
  function createOpen(id) { domain.fixtureId(id); return transaction(data => { if(data.instruments.some(i => i.instrument_id === id)) throw new Error('Fixture identifier already exists'); const i = makeFixture(id.slice('FCC-TEST-'.length)); data.instruments.push(i); return i; }); }
  function submitChallenge(id, submission, receivedAt = new Date().toISOString()) {
    domain.fixtureId(id); domain.timestamp(receivedAt);
    return transaction(data => {
      const i = data.instruments.find(x => x.instrument_id === id);
      if (!i || i.state !== 'OPEN') throw new Error('Challenges require an OPEN fixture');
      const pair = keys(data);
      const body = { provisional_receipt_id: nextId(), instrument_id: id, challenge_content_sha256: domain.hash(submission), received_at: receivedAt, intake_key_version: 'FCC-TEST-KEY-1', fixture_only: true };
      const receipt = { ...body, signature: crypto.sign(null, Buffer.from(canonicalize(body)), pair.private).toString('base64') };
      const problems = domain.validateChallenge(submission);
      const duplicate = !problems.length && i.challenges.find(c => c.identity === submission.identity && c.category === submission.category && c.status !== 'RETURNED-MALFORMED');
      const challenge = { challenge_id: 'FCC-TEST-'+crypto.randomUUID().toUpperCase(), identity: submission?.identity || null, category: submission?.category || null, claim: submission?.claim || null, supporting_evidence: submission?.supporting_evidence || [], instrument_id: id, received_at: receivedAt, receipt_id: body.provisional_receipt_id, status: problems.length ? 'RETURNED-MALFORMED' : duplicate ? 'CONSOLIDATED' : 'PENDING', triage_reasons: problems, consolidated_into: duplicate?.challenge_id || null, first_filer: !duplicate && !problems.length };
      i.challenges.push(challenge);
      data.receipts.push({ receipt, submission, publication_status: 'LOCAL-ONLY', public_ref: null });
      recordEvent(i, 'challenge-received', receivedAt);
      return { challenge, receipt, public_key: pair.public, label: 'Signed test receipt; not a public admission' };
    });
  }
  function respond(id, challengeId, response) {
    return transaction(data => {
      const i = data.instruments.find(x => x.instrument_id === id); const c = i?.challenges.find(x => x.challenge_id === challengeId);
      if(!c || i.state !== 'OPEN' || c.status !== 'PENDING') throw new Error('Pending challenge not found');
      if(response.operator_confirmed !== true || !['UPHELD','PARTIALLY-UPHELD','NOT-UPHELD'].includes(response.status) || typeof response.rationale !== 'string' || !response.rationale.trim()) throw new Error('Operator confirmation, disposition and rationale required');
      domain.timestamp(response.at); if(domain.timestamp(response.at) < domain.timestamp(c.received_at)) throw new Error('Response precedes receipt');
      c.responded_at = response.at; c.status = response.status; c.resolution = { rationale: response.rationale, resolved_at: response.at, fixture_only: true };
      recordEvent(i, 'annex-added', response.at); return c;
    });
  }
  function resolve(id, input) {
    return transaction(data => {
      const i = data.instruments.find(x => x.instrument_id === id); if(!i) throw new Error('Fixture not found');
      const result = domain.deriveResolution(i, input);
      i.resolution_input = clone(input); i.resolution = result; i.state = 'TERMINAL';
      if(result.process === 'VIOLATED') data.corrections.push({ correction_id: 'FCC-TEST-CORRECTION-'+crypto.randomUUID().toUpperCase(), affected_refs: [id], class: 'process-violation', trigger: result.response_breaches.length ? 'Late response' : 'Recorded violation', entered_at: input.at, fixture_only: true });
      recordEvent(i, 'resolution-recorded', input.at); return result;
    });
  }
  return { publicState, loadAcceptance, createOpen, submitChallenge, respond, resolve };
}
module.exports = { createWorkspace, acceptanceFixtures, makeFixture, reading, verifyReceipt, snapshotHash };
