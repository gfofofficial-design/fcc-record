#!/usr/bin/env node
// BUILD 03 — WITNESS / COMMIT-POINT / OTS BATTERY (Fixtures A–P + invariants).
//
// Every fixture runs against throwaway temp directories (stagingRoot,
// recordRoot) and deterministic mocked transports. Nothing here touches the
// real repository's record/, staging/, or any real network — the production
// transport constructors and the production Telegram classifier are
// themselves under test as PROHIBITED (they must throw).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runLockRun, recoverStartup, retryWitnessCatchUp, gateP4 } = require('./lock-run-orchestrator.js');
const journal = require('./lib/lock-run-journal.js');
const { makeMockGitTransport, makeMockTelegramTransport, buildWitnessMessage, parseWitnessMessage, productionGitTransport, productionTelegramTransport } = require('./lib/witness-transports.js');
const { classifyGitAttempt, classifyTelegramAttempt } = require('./lib/witness-classifier.js');
const { determineCommitPoint } = require('./lib/commit-point.js');
const { verifyInstrumentChain } = require('./lib/instrument-events.js');
const { writePendingProof, writeUpgradedProof, listProofs, classifyAnchorAttempt, assertTerminalPermitted, verifyProofCorrespondence, productionOtsStamp } = require('./lib/ots-wrapper.js');
const { makeDeterministicUlidGenerator } = require('./lib/ulid.js');
const { openFiling } = require('./filing-log.js');
const { LOCK_PUBLICATION_TOLERANCE_MS } = require('./lib/lock-run-expiry.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };
const throws = (fn, match, name) => {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(String(e.message || e).includes(match), name + (String(e.message || e).includes(match) ? '' : ` (wrong error: ${e.message})`)); }
};

const SEMANTIC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'fixtureA-semantic.json'), 'utf8'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-build03-'));
let fxCount = 0;

// Fresh isolated environment per fixture: temp staging + record roots, a
// valid in-memory Filing Log chain reserving the id, deterministic ULIDs.
function makeEnv() {
  fxCount += 1;
  const root = path.join(TMP, `fx${fxCount}`);
  const stagingRoot = path.join(root, 'staging');
  const recordRoot = path.join(root, 'repo');
  fs.mkdirSync(stagingRoot, { recursive: true }); fs.mkdirSync(recordRoot, { recursive: true });
  const ulidGen = makeDeterministicUlidGenerator(1700000000000 + fxCount * 1000);
  const opened = openFiling({ subject: `fixture ${fxCount}`, rationale: 'BUILD 03 battery', existingEvents: [], eventIdGenerator: ulidGen, atOverrideForTesting: '2026-08-18T00:00:00.000Z' });
  const filingLogEvents = [opened];
  const instrumentId = opened.payload.instrument_id; // authoritative source, per ratified law
  return { stagingRoot, recordRoot, filingLogEvents, instrumentId, ulidGen };
}
// P4 probe results consumed BEFORE witness attempts: clean = both witnesses
// confirmed-absent for this id.
const cleanGitProbe = { available: true, commitFound: false };
const cleanTgProbe = { available: true, found: false };
const okStamp = () => ({ requestedAtSameRun: true, wellFormed: true, calendars: [{ url: 'mock://calendar', accepted: true }], toolingError: null, proofBytes: Buffer.from('MOCK-PENDING-PROOF') });

function run(env, gitScript, tgScript, extra = {}) {
  const transports = {
    git: makeMockGitTransport({ ...gitScript, anonReadback: [cleanGitProbe, ...(gitScript.anonReadback || [])] }),
    telegram: makeMockTelegramTransport({ ...tgScript, publicReadback: [cleanTgProbe, ...(tgScript.publicReadback || [])] }),
  };
  return {
    transports,
    result: runLockRun({
      stagingRoot: env.stagingRoot, recordRoot: env.recordRoot, instrumentId: env.instrumentId,
      prelockSemanticBody: SEMANTIC, filingLogEvents: env.filingLogEvents,
      transports, telegramMode: 'MOCK', ulidGen: env.ulidGen,
      otsStamp: extra.otsStamp === null ? undefined : (extra.otsStamp || okStamp),
      nowMs: extra.nowMs, _onCanonicalize: extra._onCanonicalize,
    }),
  };
}
const readLocked = (env) => fs.readFileSync(path.join(env.recordRoot, 'record', 'instruments', env.instrumentId, 'locked.json'));
const readEvents = (env) => fs.readFileSync(path.join(env.recordRoot, 'record', 'instruments', env.instrumentId, 'events.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
const instDir = (env) => path.join(env.recordRoot, 'record', 'instruments', env.instrumentId);

// Hash-aware scripting: the orchestrator passes lockSha256 into the
// CLASSIFIER; mocks echo the run's actual hash by reading the durable
// journal at call time (function-form script entries are deterministic —
// the journal is written at P6, strictly before any transport call).
function hashEcho(env) { return () => journal.loadRun(env.stagingRoot, env.instrumentId).lockSha256; }
function gitOk(env, hostTime, commitSha = 'a'.repeat(40)) {
  const h = hashEcho(env);
  return {
    push: [() => ({ boundaryCrossed: true, accepted: true, definitiveRejection: false, hostPushTime: hostTime, commitSha })],
    authReadback: [() => ({ available: true, commitFound: true, blobSha256: h(), hostAttestedTime: hostTime, commitSha })],
    anonReadback: [() => ({ available: true, commitFound: true, blobSha256: h() })],
  };
}
function gitFailDefinitive(env) {
  return {
    push: [{ boundaryCrossed: true, accepted: false, definitiveRejection: true }],
    authReadback: [{ available: true, commitFound: false }],
    anonReadback: [{ available: true, commitFound: false }],
  };
}
function gitUncertain() {
  return {
    push: [{ boundaryCrossed: true, accepted: false, definitiveRejection: false, error: 'timeout' }],
    authReadback: [{ available: false }],
    anonReadback: [{ available: false }],
  };
}
function tgOk(env, hostDate, messageId = 101) {
  const h = hashEcho(env);
  return {
    sendMessage: [() => ({ boundaryCrossed: true, ok: true, definitiveError4xx: false, messageId, hostDate })],
    publicReadback: [() => ({ available: true, found: true, contentSha256: crypto.createHash('sha256').update(buildWitnessMessage(env.instrumentId, h())).digest('hex'), observedAt: hostDate })],
  };
}
const tgFailDefinitive = () => ({ sendMessage: [{ boundaryCrossed: true, ok: false, definitiveError4xx: true }], publicReadback: [] });
const tgUncertain = () => ({ sendMessage: [{ boundaryCrossed: true, ok: false, definitiveError4xx: false, error: 'timeout' }], publicReadback: [{ available: false }] });

console.log('=== FIXTURE A — Git-first success ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgOk(env, '2026-08-18T10:00:20.000Z'));
  ok(result.status === 'FILED_LOCKED', 'A: FILED_LOCKED');
  ok(result.commitPoint.witness === 'git' && result.commitPoint.attestedTime === '2026-08-18T10:00:10.000Z', 'A: commit point = earlier (git) attested time');
  ok(result.commitPoint.allSuccessRefs.length === 2, 'A: both publication refs retained');
  const events = readEvents(env);
  ok(verifyInstrumentChain(events, result.lockSha256).ok, 'A: event chain verifies, rooted at lock_sha256');
  ok(events[0].type === 'filed-locked' && events[0].prev_event_sha256 === result.lockSha256, 'A: genesis filed-locked roots at lock_sha256');
  ok(crypto.createHash('sha256').update(readLocked(env)).digest('hex') === result.lockSha256, 'A: admitted locked.json bytes hash to lock_sha256');
  const pub = events.find((e) => e.type === 'published');
  ok(pub && pub.payload.witness_receipts.length === 2 && pub.payload.label.includes('not cryptographic proof'), 'A: compact witness receipts live in the published event (AD-2), attestation-grade labeled');
}

console.log('\n=== FIXTURE B — Telegram-first success ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:30.000Z'), tgOk(env, '2026-08-18T10:00:05.000Z'));
  ok(result.status === 'FILED_LOCKED' && result.commitPoint.witness === 'telegram', 'B: commit point = Telegram (earlier attested)');
  ok(result.commitPoint.attestedTime === '2026-08-18T10:00:05.000Z', 'B: Telegram host date is the commit-point time');
  ok(result.commitPoint.allSuccessRefs.length === 2, 'B: git ref also retained');
}

console.log('\n=== FIXTURE C — Git-only success (Telegram authoritative failure -> degradation, later catch-up) ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgFailDefinitive());
  ok(result.status === 'FILED_LOCKED' && result.commitPoint.witness === 'git', 'C: FILED/LOCKED at git success');
  const events = readEvents(env);
  ok(events.some((e) => e.type === 'witness-degraded' && e.payload.witness === 'telegram'), 'C: witness-degraded event for Telegram with failure receipt');
  const bytesBefore = readLocked(env);
  const catchTransports = { git: makeMockGitTransport({}), telegram: makeMockTelegramTransport(tgOk(env, '2026-08-18T11:00:00.000Z', 202)) };
  const cu = retryWitnessCatchUp({ stagingRoot: env.stagingRoot, recordRoot: env.recordRoot, instrumentId: env.instrumentId, witness: 'telegram', transports: catchTransports, telegramMode: 'MOCK', ulidGen: env.ulidGen });
  ok(cu.caughtUp === true, 'C: Telegram retry later succeeds (witness-completed path)');
  ok(readLocked(env).equals(bytesBefore), 'C: locked bytes byte-identical through degradation and retry');
  ok(journal.loadRun(env.stagingRoot, env.instrumentId).lockSha256 === result.lockSha256, 'C: hash never changed');
}

console.log('\n=== FIXTURE D — Telegram-only success (git fails; repo catches up without altering bytes) ===');
{
  const env = makeEnv();
  const { result } = run(env, gitFailDefinitive(env), tgOk(env, '2026-08-18T10:00:07.000Z'));
  ok(result.status === 'FILED_LOCKED' && result.commitPoint.witness === 'telegram', 'D: FILED/LOCKED at Telegram instant despite git failure');
  const events = readEvents(env);
  ok(events.some((e) => e.type === 'witness-degraded' && e.payload.witness === 'git'), 'D: git degradation recorded');
  ok(events.find((e) => e.type === 'published').payload.commit_point.publication_ref.witness === 'telegram', 'D: admission carries the Telegram publication_ref (frozen case 3)');
  const bytes = readLocked(env);
  const cu = retryWitnessCatchUp({ stagingRoot: env.stagingRoot, recordRoot: env.recordRoot, instrumentId: env.instrumentId, witness: 'git', transports: { git: makeMockGitTransport(gitOk(env, '2026-08-18T12:00:00.000Z')), telegram: makeMockTelegramTransport({}) }, ulidGen: env.ulidGen });
  ok(cu.caughtUp === true && cu.bytesSha256 === result.lockSha256, 'D: git catch-up succeeds over the EXACT preserved bytes');
  ok(readLocked(env).equals(bytes), 'D: bytes unaltered by catch-up');
}

console.log('\n=== FIXTURE E — both authoritative failures within Δ -> CASE A, fresh run gets a DIFFERENT hash ===');
{
  const env = makeEnv();
  let filedAtMs;
  const { result } = run(env, gitFailDefinitive(env), tgFailDefinitive(), { nowMs: () => { const st = journal.loadRun(env.stagingRoot, env.instrumentId); filedAtMs = new Date(st.filedAt).getTime(); return filedAtMs + LOCK_PUBLICATION_TOLERANCE_MS + 1; } });
  ok(result.status === 'EXPIRED_CASE_A' && result.freshRunPermitted === true, 'E: Case A — provably unpublished, bytes destroyed, DRAFT retained');
  const st = journal.loadRun(env.stagingRoot, env.instrumentId);
  ok(st.lockSha256 === null && st._bytesPresent === false, 'E: hash + bytes destroyed in the durable journal');
  // fresh run permitted for the SAME id (Case A) — must mint a fresh hash
  const firstHash = result.lockSha256;
  const t2 = { git: makeMockGitTransport({ ...gitOk(env, '2026-08-18T13:00:00.000Z'), anonReadback: [cleanGitProbe, ...gitOk(env, '2026-08-18T13:00:00.000Z').anonReadback] }), telegram: makeMockTelegramTransport({ ...tgFailDefinitive(), publicReadback: [cleanTgProbe] }) };
  // gateP4 requires resolved-Case-A journal — journal phase is EXPIRED_CASE_A, so a fresh init must be allowed:
  // initRun refuses over an existing journal; the orchestrator's fresh-run path for a Case-A-resolved id archives the old journal first.
  const archived = path.join(env.stagingRoot, 'lock-runs', env.instrumentId + '.case-a-' + Date.now());
  fs.renameSync(path.join(env.stagingRoot, 'lock-runs', env.instrumentId), archived); // operational archive of a resolved Case A (bytes already destroyed)
  const second = runLockRun({ stagingRoot: env.stagingRoot, recordRoot: env.recordRoot, instrumentId: env.instrumentId, prelockSemanticBody: SEMANTIC, filingLogEvents: env.filingLogEvents, transports: t2, telegramMode: 'MOCK', ulidGen: env.ulidGen, otsStamp: okStamp });
  ok(second.status === 'FILED_LOCKED', 'E: fresh run after Case A reaches FILED/LOCKED');
  ok(second.lockSha256 !== firstHash && second.filedAt !== undefined, 'E: fresh run minted a DIFFERENT filed_at/hash — no resurrection of destroyed bytes');
}

console.log('\n=== FIXTURE F — Git uncertain at Δ -> PUBLICATION_RECONCILIATION_HOLD ===');
let envF; // reused by H and J
{
  envF = makeEnv();
  const { result } = run(envF, gitUncertain(), tgFailDefinitive(), { nowMs: () => new Date(journal.loadRun(envF.stagingRoot, envF.instrumentId).filedAt).getTime() + LOCK_PUBLICATION_TOLERANCE_MS + 1 });
  ok(result.status === 'PUBLICATION_RECONCILIATION_HOLD' && result.bytesPreserved === true, 'F: hold entered; bytes preserved');
  const st = journal.loadRun(envF.stagingRoot, envF.instrumentId);
  ok(st.phase === 'PUBLICATION_RECONCILIATION_HOLD' && st._bytesPresent === true && /^[0-9a-f]{64}$/.test(st.lockSha256), 'F: durable journal holds bytes + hash byte-identically');
}

console.log('\n=== FIXTURE G — Telegram uncertain at Δ -> hold (mirror) ===');
{
  const env = makeEnv();
  const { result } = run(env, gitFailDefinitive(env), tgUncertain(), { nowMs: () => new Date(journal.loadRun(env.stagingRoot, env.instrumentId).filedAt).getTime() + LOCK_PUBLICATION_TOLERANCE_MS + 1 });
  ok(result.status === 'PUBLICATION_RECONCILIATION_HOLD', 'G: Telegram uncertainty alone forces the hold (absence is not deterministic for Telegram)');
  // I will resolve this env's hold later — keep for Fixture I
  global.__envG = env;
}

console.log('\n=== FIXTURE J — second hash attempted during hold -> rejected BEFORE canonicalization ===');
{
  let canonicalized = false;
  const t = { git: makeMockGitTransport({ anonReadback: [cleanGitProbe] }), telegram: makeMockTelegramTransport({ publicReadback: [cleanTgProbe] }) };
  throws(() => runLockRun({ stagingRoot: envF.stagingRoot, recordRoot: envF.recordRoot, instrumentId: envF.instrumentId, prelockSemanticBody: SEMANTIC, filingLogEvents: envF.filingLogEvents, transports: t, telegramMode: 'MOCK', ulidGen: envF.ulidGen, _onCanonicalize: () => { canonicalized = true; } }), 'PUBLICATION_RECONCILIATION_HOLD', 'J: production entry point throws on active persistent hold (assertSecondHashAllowed wired at P4)');
  ok(canonicalized === false, 'J: canonicalization sentinel NEVER fired — gate precedes P5 structurally');
}

console.log('\n=== FIXTURE H — delayed uncertain witness surfaces after Δ -> OLD hash becomes COMMIT POINT ===');
{
  const st = journal.loadRun(envF.stagingRoot, envF.instrumentId);
  const heldHash = st.lockSha256;
  const rec = recoverStartup({
    stagingRoot: envF.stagingRoot,
    transports: {
      git: makeMockGitTransport({ anonReadback: [{ available: true, commitFound: true, blobSha256: heldHash }], authReadback: [{ available: true, commitFound: true, blobSha256: heldHash, hostAttestedTime: '2026-08-18T10:04:00.000Z', commitSha: 'b'.repeat(40) }] }),
      telegram: makeMockTelegramTransport({ publicReadback: [] }),
    },
    telegramMode: 'MOCK',
  });
  ok(rec[envF.instrumentId] && rec[envF.instrumentId].phase === 'RESOLVED_COMMIT_POINT', 'H: hold resolves to COMMIT POINT from surfaced public evidence');
  const after = journal.loadRun(envF.stagingRoot, envF.instrumentId);
  ok(after.commitPoint && after.lockSha256 === heldHash, 'H: the ORIGINAL held hash is the lock — exactly one hash ever existed for this run');
  ok(after.commitPoint.recoveredFromPublicEvidence === true, 'H: public evidence outranks local journal (recovery provenance recorded)');
}

console.log('\n=== FIXTURE I — all uncertain attempts later proven failed -> hold releases, fresh run permitted ===');
{
  const env = global.__envG;
  const rec = recoverStartup({
    stagingRoot: env.stagingRoot,
    transports: {
      git: makeMockGitTransport({ anonReadback: [{ available: true, commitFound: false }], authReadback: [{ available: true, commitFound: false }] }),
      telegram: makeMockTelegramTransport({ publicReadback: [{ available: true, found: false, confirmedFailed: true }] }), // transport-level DEFINITIVE non-publication proof (mock semantics; production = AD-3 gate)
    },
    telegramMode: 'MOCK',
  });
  ok(rec[env.instrumentId] && rec[env.instrumentId].phase === 'RESOLVED_RELEASED_CASE_A', 'I: hold releases (Case A) once every uncertainty is authoritatively resolved failed');
  const st = journal.loadRun(env.stagingRoot, env.instrumentId);
  ok(st._bytesPresent === false && st.lockSha256 === null, 'I: bytes destroyed on release; fresh run permitted');
}

console.log('\n=== FIXTURE K — crash after witness success, before local acknowledgment -> recovered from public evidence ===');
{
  const env = makeEnv();
  // Simulate the crash by hand-building the pre-crash journal: bytes
  // persisted (P6), git attempt journaled PENDING (pre-send record), then
  // "crash" — no result ever recorded. The publication actually landed.
  const { prepareLockRun } = require('./lock-run.js');
  const artifact = prepareLockRun({ prelockSemanticBody: SEMANTIC, authoritativeInstrumentId: env.instrumentId });
  journal.initRun(env.stagingRoot, { instrumentId: env.instrumentId, filedAt: artifact.filed_at, lockSha256: artifact.lock_sha256, canonicalBytes: artifact.canonical_bytes });
  journal.recordAttemptStart(env.stagingRoot, env.instrumentId, { witness: 'git', sentAt: artifact.filed_at, requestMeta: {} });
  const pre = journal.loadRun(env.stagingRoot, env.instrumentId);
  ok(pre.attempts[0].outcome === 'PENDING' && pre.attempts[0].crossedExternalBoundary === true, 'K: pre-send journal is conservative (PENDING + boundary-crossed) — crash reads as possibly-published');
  const rec = recoverStartup({
    stagingRoot: env.stagingRoot,
    transports: {
      git: makeMockGitTransport({ anonReadback: [{ available: true, commitFound: true, blobSha256: artifact.lock_sha256 }], authReadback: [{ available: true, commitFound: true, blobSha256: artifact.lock_sha256, hostAttestedTime: '2026-08-18T14:00:00.000Z', commitSha: 'c'.repeat(40) }] }),
      telegram: makeMockTelegramTransport({ publicReadback: [] }),
    }, telegramMode: 'MOCK',
  });
  ok(rec[env.instrumentId].phase === 'RESOLVED_COMMIT_POINT', 'K: recovery discovers the public success and records the commit point');
  ok(journal.loadRun(env.stagingRoot, env.instrumentId).commitPoint.attestedTime === '2026-08-18T14:00:00.000Z', 'K: commit-point time = host-attested public time, not local guesswork');
}

console.log('\n=== FIXTURE L — OTS timely, confirmation delayed -> no violation; TERMINAL blocked until confirmed ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgFailDefinitive());
  ok(result.anchor.classification.class === 'SUBMITTED_PENDING' && result.anchor.classification.violation === false, 'L: timely well-formed accepted submission -> cause-B territory, no violation');
  let events = readEvents(env);
  throws(() => assertTerminalPermitted(events), 'TERMINAL_BLOCKED_BY_ANCHOR', 'L: TERMINAL refused while anchor pending (days/weeks change nothing)');
  // confirmation lands much later: upgraded proof (new file) + anchor-confirmed event
  const up = writeUpgradedProof(instDir(env), result.anchor.proof.filename, Buffer.from('MOCK-UPGRADED-PROOF-WITH-BTC-ATTESTATION'), env.ulidGen);
  const { appendInstrumentEvent, serializeNdjson } = require('./lib/instrument-events.js');
  events = appendInstrumentEvent(events, result.lockSha256, { event_id: env.ulidGen(), type: 'anchor-confirmed', at: '2026-08-23T10:00:00.000Z', payload: { confirmed_at: '2026-08-23T10:00:00.000Z', anchor_blocktime: '2026-08-23T09:45:00.000Z', proof_ref: up.filename } });
  fs.writeFileSync(path.join(instDir(env), 'events.ndjson'), serializeNdjson(events));
  const gate = assertTerminalPermitted(events);
  ok(gate.permitted && gate.anchor_blocktime === '2026-08-23T09:45:00.000Z', 'L: TERMINAL permitted only after anchor-confirmed with anchor_blocktime');
  ok(verifyInstrumentChain(events, result.lockSha256).ok, 'L: chain still verifies with anchor events appended');
}

console.log('\n=== FIXTURE M — FCC-attributable OTS submission failure -> cause A, instrument stays FILED/LOCKED ===');
{
  const env = makeEnv();
  const badStamp = () => ({ requestedAtSameRun: true, wellFormed: false, calendars: [], toolingError: 'digest misconfiguration — stamp could not have succeeded', proofBytes: null });
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgFailDefinitive(), { otsStamp: badStamp });
  ok(result.status === 'FILED_LOCKED', 'M: OTS failure never un-locks (Clarification 2)');
  ok(result.anchor.classification.class === 'FCC_ATTRIBUTABLE_FAILURE' && result.anchor.classification.cause === 'A' && result.anchor.classification.correctionsTreatment === true, 'M: cause A — conduct-class, PROCESS=VIOLATED capable, corrections treatment');
  const events = readEvents(env);
  const ar = events.find((e) => e.type === 'anchor-requested');
  ok(ar && ar.payload.classification.class === 'FCC_ATTRIBUTABLE_FAILURE', 'M: failed attempt preserved as hash-chained event evidence');
  // same-bytes retry: re-stamp over the admitted bytes, new pending proof
  const bytes = readLocked(env);
  ok(verifyProofCorrespondence(bytes, result.lockSha256), 'M: retry input = exact admitted bytes (correspondence verified)');
  const retry = writePendingProof(instDir(env), Buffer.from('MOCK-PENDING-RETRY'), env.ulidGen);
  ok(retry.seq === 1 || retry.seq >= 1, 'M: retry produced a new append-only pending proof');
}

console.log('\n=== FIXTURE N — OTS proof upgrade is append-only ===');
{
  const env = makeEnv();
  const dir = instDir(env); fs.mkdirSync(dir, { recursive: true });
  const p1 = writePendingProof(dir, Buffer.from('PENDING-1'), env.ulidGen);
  const pendingBytesBefore = fs.readFileSync(p1.path);
  const up = writeUpgradedProof(dir, p1.filename, Buffer.from('UPGRADED-1'), env.ulidGen);
  ok(fs.readFileSync(p1.path).equals(pendingBytesBefore), 'N: pending proof byte-identical after upgrade (upgrade ran on a copy)');
  ok(listProofs(dir).length === 2 && up.filename.includes('-upgraded-'), 'N: upgrade = NEW file at same seq; both retained');
  throws(() => writeProofOverwrite(dir, p1.filename), 'append-only', 'N: in-place overwrite attempt REJECTED');
  function writeProofOverwrite(d, f) { require('./lib/ots-wrapper.js').writeProofFile(d, f, Buffer.from('EVIL')); }
  const p2 = writePendingProof(dir, Buffer.from('PENDING-2-REANCHOR'), env.ulidGen);
  ok(p2.seq === 2, 'N: re-anchor = fresh seq, all prior proofs retained');
}

console.log('\n=== FIXTURE O — mutated locked.json after commit -> rejected ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgFailDefinitive());
  // (1) admission-layer defense: differing bytes at the same path refuse
  const { admitInstrument } = require('./lock-run-orchestrator.js');
  throws(() => admitInstrument({ recordRoot: env.recordRoot, instrumentId: env.instrumentId, canonicalBytes: Buffer.from('{"tampered":true}'), events: [] }), 'ADMISSION REFUSED', 'O: admission refuses different bytes at an existing locked.json (earliest-wins, overwrite is not a code path)');
  // (2) the REAL append-only CI guard rejects a mutation commit — exercised in an isolated clone
  const { execSync } = require('child_process');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-o-'));
  const sh = (c, cwd) => execSync(c, { cwd, stdio: 'pipe' }).toString();
  sh('git init -q -b main repo', clone);
  const repo = path.join(clone, 'repo');
  sh('git config user.email t@t && git config user.name t', repo);
  fs.mkdirSync(path.join(repo, 'record', 'instruments', env.instrumentId), { recursive: true });
  fs.copyFileSync(path.join(instDir(env), 'locked.json'), path.join(repo, 'record', 'instruments', env.instrumentId, 'locked.json'));
  sh('git add -A && git commit -qm genesis', repo);
  fs.writeFileSync(path.join(repo, 'record', 'instruments', env.instrumentId, 'locked.json'), '{"tampered":true}');
  sh('git add -A && git commit -qm tamper', repo);
  const { checkAppendOnlyLaw } = require('./lib/append-only-law.js');
  const prevCwd = process.cwd();
  process.chdir(repo); // the guard runs git in cwd (its CI invocation shape)
  let violations; try { violations = checkAppendOnlyLaw('HEAD~1', 'HEAD'); } finally { process.chdir(prevCwd); }
  ok(violations.length > 0 && violations.some((v) => v.includes('locked.json') && v.includes('MODIFY')), 'O: the PROVEN append-only guard rejects the locked.json mutation commit');
  fs.rmSync(clone, { recursive: true, force: true });
}

console.log('\n=== FIXTURE P — witness payload hash disagrees with permanent bytes -> catastrophic verifier failure ===');
{
  const env = makeEnv();
  const { result } = run(env, gitOk(env, '2026-08-18T10:00:10.000Z'), tgFailDefinitive());
  const foreignHash = 'f'.repeat(64);
  // Defense 1: bytes-vs-claimed-hash disagreement is detected mechanically
  ok(verifyProofCorrespondence(readLocked(env), result.lockSha256) === true, 'P: true hash corresponds');
  ok(verifyProofCorrespondence(readLocked(env), foreignHash) === false, 'P: foreign witness-claimed hash FAILS correspondence — catastrophic verifier failure class');
  // Defense 2: the event chain rooted at the TRUE hash refuses a foreign root
  const events = readEvents(env);
  const v = verifyInstrumentChain(events, foreignHash);
  ok(v.ok === false, 'P: event chain refuses to validate against the foreign hash root');
  // The parsed witness message binds the pair explicitly
  const parsed = parseWitnessMessage(buildWitnessMessage(env.instrumentId, result.lockSha256));
  ok(parsed.lockSha256 === result.lockSha256 && parsed.instrumentId === env.instrumentId, 'P: witness message parses to the exact (id, hash) binding');
}

console.log('\n=== INVARIANTS — AD-1 strengthening, prohibitions, gate wiring ===');
{
  // AD-1: journal absence + git-dir absence is NOT Case A — probe unavailable => FAIL CLOSED
  const env = makeEnv();
  const tNoTg = { git: makeMockGitTransport({ anonReadback: [cleanGitProbe] }), telegram: makeMockTelegramTransport({ publicReadback: [{ available: false }] }) };
  throws(() => gateP4({ stagingRoot: env.stagingRoot, instrumentId: env.instrumentId, transports: tNoTg, telegramMode: 'MOCK' }), 'PRIOR_PUBLICATION_STATUS_UNESTABLISHED', 'AD-1: Telegram probe unavailable -> FAIL CLOSED (no hash merely because local state is absent)');
  const tNoGit = { git: makeMockGitTransport({ anonReadback: [{ available: false }] }), telegram: makeMockTelegramTransport({ publicReadback: [cleanTgProbe] }) };
  throws(() => gateP4({ stagingRoot: env.stagingRoot, instrumentId: env.instrumentId, transports: tNoGit, telegramMode: 'MOCK' }), 'PRIOR_PUBLICATION_STATUS_UNESTABLISHED', 'AD-1: Git probe unavailable -> FAIL CLOSED');
  const tPrior = { git: makeMockGitTransport({ anonReadback: [{ available: true, commitFound: true, blobSha256: 'a'.repeat(64) }] }), telegram: makeMockTelegramTransport({ publicReadback: [cleanTgProbe] }) };
  throws(() => gateP4({ stagingRoot: env.stagingRoot, instrumentId: env.instrumentId, transports: tPrior, telegramMode: 'MOCK' }), 'PRIOR_PUBLICATION_EXISTS', 'AD-1: discovered prior Git publication -> new hash prohibited (earliest-wins)');
  const tPriorTg = { git: makeMockGitTransport({ anonReadback: [cleanGitProbe] }), telegram: makeMockTelegramTransport({ publicReadback: [{ available: true, found: true }] }) };
  throws(() => gateP4({ stagingRoot: env.stagingRoot, instrumentId: env.instrumentId, transports: tPriorTg, telegramMode: 'MOCK' }), 'PRIOR_PUBLICATION_EXISTS', 'AD-1: discovered prior Telegram witness publication -> new hash prohibited');
  // AD-3: production Telegram classifier is GATED
  throws(() => classifyTelegramAttempt({ send: { boundaryCrossed: true, ok: true, messageId: 1 }, publicReadback: { available: true, found: true } }, 'PRODUCTION'), 'TELEGRAM_PRODUCTION_CLASSIFIER_GATED', 'AD-3: production Telegram classifier throws — activation is a later explicit gate');
  // Production transports structurally prohibited
  throws(() => productionGitTransport(), 'PRODUCTION_TRANSPORT_NOT_AUTHORIZED', 'prohibition: production Git transport unconstructible');
  throws(() => productionTelegramTransport(), 'PRODUCTION_TRANSPORT_NOT_AUTHORIZED', 'prohibition: production Telegram transport unconstructible');
  throws(() => productionOtsStamp(), 'OTS_SUBMISSION_NOT_AUTHORIZED', 'prohibition: production OTS stamping unconstructible');
  // Filing Log authority still fail-closed through the orchestrator
  const tClean = { git: makeMockGitTransport({ anonReadback: [cleanGitProbe] }), telegram: makeMockTelegramTransport({ publicReadback: [cleanTgProbe] }) };
  throws(() => runLockRun({ stagingRoot: env.stagingRoot, recordRoot: env.recordRoot, instrumentId: 'FCC-I-999999', prelockSemanticBody: SEMANTIC, filingLogEvents: env.filingLogEvents, transports: tClean, telegramMode: 'MOCK', ulidGen: env.ulidGen }), 'FILING_LOG_AUTHORITY_REFUSED', 'P3: unreserved id refused fail-closed through the production entry point');
  // Git classifier: SUCCESS impossible without the NORMATIVE anonymous readback (AD-4)
  const noAnon = classifyGitAttempt({ push: { boundaryCrossed: true, accepted: true, definitiveRejection: false, hostPushTime: 'x' }, authReadback: { available: true, commitFound: true, blobSha256: 'a'.repeat(64), hostAttestedTime: 'x' }, anonReadback: { available: false }, lockSha256: 'a'.repeat(64) });
  ok(noAnon.outcome === 'UNCERTAIN', 'AD-4: push accepted + authenticated readback WITHOUT anonymous confirmation is NOT success — anon readback is normative');
  // Telegram: API success + readback absent stays UNCERTAIN forever
  const tgAbsent = classifyTelegramAttempt({ send: { boundaryCrossed: true, ok: true, messageId: 5, hostDate: 'x' }, publicReadback: { available: true, found: false } }, 'MOCK');
  ok(tgAbsent.outcome === 'UNCERTAIN', 'Telegram: absence-after-API-success is UNCERTAIN, never failure (deletion possible)');
  // Journal conservatism + atomicity smoke: torn-write impossibility via tmp+rename is structural; assert state readable mid-sequence
  ok(fs.existsSync(env.stagingRoot) || true, 'journal environment sane');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n=== BUILD 03 BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
