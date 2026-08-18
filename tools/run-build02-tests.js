#!/usr/bin/env node
// BUILD 02.1 acceptance battery — fixtures A-M under the ratified PRELOCK
// PACKAGE / LOCK RUN architecture. No live witnesses anywhere. Never
// touches real record/.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { validatePrelockPackage } = require('./prelock.js');
const { prepareLockRun } = require('./lock-run.js');
const { dualCanonicalize } = require('./lib/canonicalize.js');
const { buildEvent, verifyEventChain } = require('./lib/event-hash.js');
const { evaluateExpiry, reconcileHold, assertSecondHashAllowed, LOCK_PUBLICATION_TOLERANCE_MS } = require('./lib/lock-run-expiry.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };

const semantic = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/fixtureA-prelock.json'), 'utf8'));

console.log('=== FIXTURE A: valid lock-run artifact ===');
{
  const pre = validatePrelockPackage(JSON.parse(JSON.stringify(semantic)), { computeDryRunEvidence: true });
  ok(pre.proof_status === 'NOT_FILED_NOT_LOCKED' && pre.dry_run_evidence.hash_class === 'DRY_RUN_ONLY' && pre.dry_run_evidence.dry_run_sha256, 'PRELOCK produces only dry-run evidence, unmistakably labeled');
  const run = prepareLockRun({ prelockSemanticBody: semantic, authoritativeInstrumentId: 'FCC-I-000001' });
  ok(run.status === 'UNPUBLISHED_LOCK_RUN_ARTIFACT', 'Lock Run output classified UNPUBLISHED_LOCK_RUN_ARTIFACT');
  ok(/^[0-9a-f]{64}$/.test(run.lock_sha256), 'lock_sha256 present, lowercase 64-hex, from a real Lock Run only');
  const recomputed = crypto.createHash('sha256').update(run.canonical_bytes).digest('hex');
  ok(recomputed === run.lock_sha256, 'independently recomputed hash matches exactly');
}

console.log('\n=== FIXTURE B: semantic-equivalence (reordered source -> identical canonical bytes/hash) ===');
{
  const fixed = { ...semantic, instrument_id: 'FCC-I-000001', filed_at: '2026-08-17T00:00:00.000Z' };
  const reordered = {}; Object.keys(fixed).reverse().forEach(k => reordered[k] = fixed[k]);
  const b1 = dualCanonicalize(fixed).bytes, b2 = dualCanonicalize(reordered).bytes;
  ok(b1.equals(b2), 'differently-ordered source JSON produces identical canonical bytes');
}

console.log('\n=== FIXTURE C: mutation changes hash; admitted bytes stay protected ===');
{
  const mutated = JSON.parse(JSON.stringify(semantic)); mutated.decision += ' MUTATED';
  const r1 = prepareLockRun({ prelockSemanticBody: semantic, authoritativeInstrumentId: 'FCC-I-000002' });
  const r2 = prepareLockRun({ prelockSemanticBody: mutated, authoritativeInstrumentId: 'FCC-I-000003' });
  ok(r1.lock_sha256 !== r2.lock_sha256, 'single-field mutation changes hash');
}
{
  let threw = false;
  try { require('child_process').execFileSync('node', [path.join(__dirname, 'verify-candidate-immutability-after-admission.js')], { stdio: 'pipe' }); }
  catch (e) { threw = true; }
  ok(!threw, 'real lock-run output byte-for-byte immutable after admission (isolated clone)');
}

console.log('\n=== FIXTURE D: invalid schema rejected before canonicalization ===');
{
  const invalid = JSON.parse(JSON.stringify(semantic)); delete invalid.decision;
  let threw = false;
  try { validatePrelockPackage(invalid); } catch (e) { threw = /PRELOCK SCHEMA VALIDATION FAILED/.test(e.message); }
  ok(threw, 'PRELOCK: missing required field rejected before any canonicalization');

  const prohibited = JSON.parse(JSON.stringify(semantic)); prohibited.unknown_field = 'x';
  let threw2 = false;
  try { validatePrelockPackage(prohibited); } catch (e) { threw2 = /SCHEMA VALIDATION FAILED/.test(e.message); }
  ok(threw2, 'PRELOCK: unknown/prohibited field rejected');
}

console.log('\n=== FIXTURE E: cross-language parity ===');
{
  const { bytes } = dualCanonicalize({ z: 1, a: { b: 2, a: 1 }, list: [3, 1, 2] });
  ok(Buffer.isBuffer(bytes) && bytes.length > 0, 'Node/Python agree (would have thrown otherwise)');
}

console.log('\n=== FIXTURE F: event chain ===');
{
  const run = prepareLockRun({ prelockSemanticBody: semantic, authoritativeInstrumentId: 'FCC-I-000004' });
  const e1 = buildEvent({ event_id: '01TESTEVENT00000000000001', type: 'filed-locked', at: '2026-08-17T00:00:00Z', payload_refs: [run.instrument_id] }, run.lock_sha256);
  const e2 = buildEvent({ event_id: '01TESTEVENT00000000000002', type: 'published', at: '2026-08-17T00:01:00Z', payload_refs: [] }, e1.event_sha256);
  ok(verifyEventChain([e1, e2], run.lock_sha256).ok, 'valid chain verifies');
  const tampered = [JSON.parse(JSON.stringify(e1)), JSON.parse(JSON.stringify(e2))];
  tampered[0].type = 'TAMPERED';
  const r = verifyEventChain(tampered, run.lock_sha256);
  ok(!r.ok && r.brokenAtIndex === 0, 'mutating a prior event breaks downstream verification');
}

console.log('\n=== FIXTURE G: PRELOCK conversion ===');
{
  const pre = validatePrelockPackage(JSON.parse(JSON.stringify(semantic)));
  ok(pre.proof_status === 'NOT_FILED_NOT_LOCKED', 'semantic PRELOCK validates');
  const run = prepareLockRun({ prelockSemanticBody: pre.semantic_body, authoritativeInstrumentId: 'FCC-I-000005' });
  ok(run.instrument_id === 'FCC-I-000005' && /^20\d\d/.test(run.filed_at), 'authoritative id + freshly-minted filed_at injected');
  ok(/^[0-9a-f]{64}$/.test(run.lock_sha256), 'complete body validates, parity confirmed, stable hash produced');
}

console.log('\n=== FIXTURE H: no ID authority ===');
{
  let threw = false;
  try { prepareLockRun({ prelockSemanticBody: semantic }); } catch (e) { threw = /NO AUTHORITATIVE FILING-LOG ID SUPPLIED/.test(e.message); }
  ok(threw, 'production lock-run preparation without an authoritative Filing-Log id HARD FAILS');
}

console.log('\n=== FIXTURE I: Stage-0 allocation gate ===');
{
  const Ajv2020 = require('ajv/dist/2020'); const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ strict: true }); addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../governance/schemas/v1/locked-body.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);
  const allocBody = { ...semantic, instrument_type: 'allocation', instrument_id: 'FCC-I-000006', filed_at: '2026-08-17T00:00:00Z', sizing: { book_pct: 1, sector: 'x', denomination: 'SOL' } };
  ok(validate(allocBody), 'frozen schema RECOGNIZES the allocation type as structurally valid');

  const allocPrelock = { ...semantic, instrument_type: 'allocation', sizing: { book_pct: 1, sector: 'x', denomination: 'SOL' } };
  let threw = false;
  try { prepareLockRun({ prelockSemanticBody: allocPrelock, authoritativeInstrumentId: 'FCC-I-000007' }); }
  catch (e) { threw = /STAGE-0 ELIGIBILITY/.test(e.message); }
  ok(threw, 'Stage-0 pipeline REFUSES to produce a lock-run artifact for allocation (Doctrine §B1)');
}

console.log('\n=== FIXTURE J: empty evidence ===');
{
  const noEvidence = { ...semantic, evidence_chain: [] };
  let threw = false;
  try { prepareLockRun({ prelockSemanticBody: noEvidence, authoritativeInstrumentId: 'FCC-I-000008' }); }
  catch (e) { threw = /SCHEMA VALIDATION FAILED/.test(e.message); }
  ok(threw, 'qualification-stance with empty evidence_chain HARD FAILS');
}

console.log('\n=== FIXTURE K: real parity divergence (injected into the ACTUAL pipeline) ===');
{
  const divergentOracles = {
    nodeFn: (obj) => Buffer.from(JSON.stringify(obj)),
    pyFn: (obj) => Buffer.from(JSON.stringify(obj) + ' '), // deliberately different
  };
  let threw = false, errMsg = '';
  let runResult;
  try {
    runResult = prepareLockRun({ prelockSemanticBody: semantic, authoritativeInstrumentId: 'FCC-I-000009', _testOracles: divergentOracles });
  } catch (e) { threw = true; errMsg = e.message; }
  ok(threw && /PARITY FAILURE/.test(errMsg), 'the ACTUAL pipeline (not a standalone fake) fails non-zero on forced Node/Python divergence');
  ok(runResult === undefined, 'no lock-run result object returned');
  ok(!fs.existsSync(path.join(__dirname, '../staging/candidates')), 'no candidate/prelock directory exists on disk (production Lock Run never writes to disk by construction)');
  const grepOut = require('child_process').execSync(`grep -rn "_testOracles" tools/ --include=*.js | grep -v run-build02-tests.js`, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const productionUsesSeam = grepOut.split('\n').filter(Boolean).some(l => !l.includes('canonicalize.js') && !l.includes('lock-run.js'));
  ok(!productionUsesSeam, 'the injection seam has no production call site outside its own definition and pass-through');
}

console.log('\n=== FIXTURE L: Δ Case A (provably unpublished) ===');
{
  const filedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const state = { filedAt, instrumentId: 'FCC-I-000010', attempts: [], generatedBytesRef: 'BYTES', lockHashRef: 'HASH' };
  const result = evaluateExpiry(state, Date.now());
  ok(result.phase === 'EXPIRED_CASE_A' && result.bytesDiscarded === true && result.freshRunPermitted === true && result.generatedBytesRef === null,
     'no crossed-boundary attempts -> Case A -> bytes discardable, DRAFT, fresh run permitted');

  const state2 = { filedAt, instrumentId: 'FCC-I-000011', attempts: [{ witness: 'git', crossedExternalBoundary: true, outcome: 'CONFIRMED_FAILED' }], generatedBytesRef: 'BYTES', lockHashRef: 'HASH' };
  const result2 = evaluateExpiry(state2, Date.now());
  ok(result2.phase === 'EXPIRED_CASE_A' && result2.bytesDiscarded === true, 'all crossed-boundary attempts authoritatively failed -> Case A');
}

console.log('\n=== FIXTURE M: Δ Case B (publication status uncertain) ===');
{
  const filedAt = new Date(Date.now() - LOCK_PUBLICATION_TOLERANCE_MS - 1000).toISOString();
  const state = { filedAt, instrumentId: 'FCC-I-000012', attempts: [{ witness: 'telegram', crossedExternalBoundary: true, outcome: 'PENDING' }], generatedBytesRef: 'REAL_BYTES', lockHashRef: 'REAL_HASH' };
  const held = evaluateExpiry(state, Date.now());
  ok(held.phase === 'PUBLICATION_RECONCILIATION_HOLD' && held.holdActive === true, 'uncertain attempt at T0+5m -> PUBLICATION_RECONCILIATION_HOLD entered');
  ok(held.generatedBytesRef === 'REAL_BYTES' && held.lockHashRef === 'REAL_HASH', 'old bytes and hash REMAIN PRESERVED, not destroyed');

  let heldStatesById = { 'FCC-I-000012': held };
  let rejected = false;
  try { assertSecondHashAllowed(heldStatesById, 'FCC-I-000012'); } catch (e) { rejected = /SECOND HASH REJECTED/.test(e.message); }
  ok(rejected, 'a second hash for the SAME instrument ID is REJECTED while the hold is active');

  const released = reconcileHold(held, [{ witness: 'telegram', crossedExternalBoundary: true, outcome: 'CONFIRMED_FAILED' }]);
  ok(released.phase === 'RESOLVED_RELEASED_CASE_A' && released.holdActive === false && released.freshRunPermitted === true, 'once every uncertain attempt is proven failed, hold releases and a fresh run is permitted');

  const commitPointReached = reconcileHold(held, [{ witness: 'telegram', crossedExternalBoundary: true, outcome: 'CONFIRMED_PUBLISHED' }]);
  ok(commitPointReached.phase === 'RESOLVED_COMMIT_POINT' && commitPointReached.bytesDiscarded === false, 'a delayed publication surfacing makes the retained bytes the commit point — never lost because the hold preserved them');
}

console.log('\n=== FIXTURE N: process evidence floor (universal, owner/ChatGPT final closure) ===');
{
  const processInstrument = {
    instrument_type: 'process',
    decision: 'TEST-FIXTURE: adopt governing procedure X.',
    thesis: 'Fixture thesis for a process instrument.',
    evidence_chain: [
      { source_url: 'https://example.test/governing-artifact', retrieved_at: '2026-08-17T00:00:00Z', note: 'the governing artifact this process decision depends on' }
    ],
    risk_statement: 'Fixture risk statement.',
    horizon: '2026-09-01T00:00:00Z',
    resolution_criteria: [{ criterion_id: 'c1', statement: 'procedure adopted', comparator: '==', threshold: true, evaluation_procedure: 'check adoption record' }],
    resolution_sources: [{ criterion_id: 'c1', primary_source: 'fcc-corrections-log', registry_class: 'direct-onchain' }],
    conflicts_disclosures: [],
    doctrine_version: '0.1.1',
    schema_version: '1',
  };
  const run = prepareLockRun({ prelockSemanticBody: processInstrument, authoritativeInstrumentId: 'FCC-I-000013' });
  ok(/^[0-9a-f]{64}$/.test(run.lock_sha256), 'process instrument WITH one governing-artifact evidence item -> PASS (valid lock-run artifact)');

  const emptyProcess = { ...processInstrument, evidence_chain: [] };
  let threw = false;
  try { prepareLockRun({ prelockSemanticBody: emptyProcess, authoritativeInstrumentId: 'FCC-I-000014' }); }
  catch (e) { threw = /SCHEMA VALIDATION FAILED/.test(e.message); }
  ok(threw, 'otherwise-identical process instrument with evidence_chain:[] -> HARD FAIL (universal floor)');
}

console.log('\n=== CANDIDATE QUARANTINE (still enforced; nothing writes to staging by default now) ===');
{
  let out = 0;
  try { require('child_process').execFileSync('node', [path.join(__dirname, 'verify-candidate-quarantine.js')], { stdio: 'pipe' }); }
  catch (e) { out = 1; }
  ok(out === 0, 'staging quarantine guard still passes (0 leaks; staging/ git-ignored)');
}

console.log(`\n=== BUILD 02.1 BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
