#!/usr/bin/env node
// BUILD 03.1 CLOSURE — ADDITIVE TEST SUITE.
//
// Covers the AD-3 governance closure: gate-record lineage resolution,
// the frozen cutoff computed against the real repo records, and the
// production Telegram classifier's activation condition. Every BUILD 03
// assertion (including "PRODUCTION without gate evidence throws") remains
// in force in run-build03-tests.js — nothing here weakens or replaces it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readAd3Status, computeCutoffFromRepo, computeCutoff } = require('./lib/intake-cutoff.js');
const { classifyTelegramAttempt, OUTCOME } = require('./lib/witness-classifier.js');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('PASS ' + label); }
  else { failed++; console.error('FAIL ' + label); }
}
function throws(fn, needle, label) {
  try { fn(); failed++; console.error('FAIL (no throw) ' + label); }
  catch (e) { ok(String(e.message).includes(needle), label); }
}
function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-closure-'));
  fs.mkdirSync(path.join(root, 'governance', 'gates'), { recursive: true });
  for (const [name, obj] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'governance', 'gates', name), JSON.stringify(obj));
  }
  return root;
}

// ---- L: gate-record lineage resolution ------------------------------------
{
  const base = { decision: 'AD-3', status: 'UNRESOLVED', verified_at: null };
  const r1 = readAd3Status(tmpRepo({ 'build03-1-ad3-status.json': base }));
  ok(r1.status === 'UNRESOLVED', 'L1: lone v1 record resolves as-is (UNRESOLVED)');

  const v2 = { decision: 'AD-3', status: 'VERIFIED', verified_at: '2026-08-29T23:27:52Z' };
  const r2 = readAd3Status(tmpRepo({ 'build03-1-ad3-status.json': base, 'build03-1-ad3-status.v2.json': v2 }));
  ok(r2.status === 'VERIFIED' && r2.verified_at === v2.verified_at, 'L2: v2 supersedes v1 without touching v1');

  const v3 = { decision: 'AD-3', status: 'UNRESOLVED', verified_at: null, note: 'hypothetical later reopening' };
  const r3 = readAd3Status(tmpRepo({ 'build03-1-ad3-status.json': base, 'build03-1-ad3-status.v2.json': v2, 'build03-1-ad3-status.v3.json': v3 }));
  ok(r3.status === 'UNRESOLVED', 'L3: highest version wins even when it is a reopening — no cherry-picking a favorable version');

  const r4 = readAd3Status(tmpRepo({ 'unrelated.json': { x: 1 } }));
  ok(r4.status === 'MISSING', 'L4: no lineage file at all resolves MISSING');

  const r5 = readAd3Status(tmpRepo({ 'build03-1-ad3-status.v2.json.bak': v2, 'build03-1-ad3-status.json': base }));
  ok(r5.status === 'UNRESOLVED', 'L5: non-lineage filenames (e.g. .bak) are ignored, not resolved');
}

// ---- R: real-repo state ----------------------------------------------------
{
  const real = readAd3Status(ROOT);
  ok(real.status === 'VERIFIED' && real.record_version === 2, 'R1: real repo resolves the v2 VERIFIED record');
  const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'gates', 'build03-1-ad3-status.json'), 'utf8'));
  ok(v1.status === 'UNRESOLVED', 'R2: v1 record still exists and still says UNRESOLVED (history preserved)');
  const v1Sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'governance', 'gates', 'build03-1-ad3-status.json'))).digest('hex');
  const v2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'gates', 'build03-1-ad3-status.v2.json'), 'utf8'));
  ok(v2.supersedes && v2.supersedes.sha256 === v1Sha, 'R3: v2 supersession pointer hash-matches the untouched v1 bytes');
}

// ---- C: frozen cutoff against real records ---------------------------------
{
  const real = computeCutoffFromRepo(ROOT, Date.parse('2026-08-30T23:59:59Z'));
  ok(real.defined === true, 'C1: cutoff is now DEFINED (both trigger conditions met)');
  ok(real.cutoffTimestamp === '2026-08-31T00:00:00.000Z', 'C2: cutoff = 00:00:00 UTC exactly 2 calendar days after the later condition (AD-3 VERIFIED 2026-08-29)');
  ok(real.laterConditionWas === 'AD-3 VERIFIED', 'C3: later condition correctly identified as AD-3 (ratification was 2026-08-18)');
  ok(real.reached === false && real.authorized === false, 'C4: one second before the cutoff, intake is NOT authorized');
  const after = computeCutoffFromRepo(ROOT, Date.parse('2026-08-31T00:00:00Z'));
  ok(after.reached === true && after.authorized === true, 'C5: at the exact cutoff instant, the formula (and only the formula) authorizes');
  // Formula immutability spot-check retained from BUILD 04.1: extra keys change nothing.
  const base = { ad3Status: { status: 'VERIFIED', verified_at: '2026-08-29T23:27:52Z' }, ratification: { ratified: true, ratified_at: '2026-08-18' } };
  const r1 = computeCutoff(base, Date.parse('2026-08-30T00:00:00Z'));
  const r2 = computeCutoff({ ...base, extraCondition: 'ignored' }, Date.parse('2026-08-30T00:00:00Z'));
  ok(r1.cutoffTimestamp === r2.cutoffTimestamp, 'C6: no third condition can enter the computation');
}

// ---- P: production classifier activation -----------------------------------
{
  const evOk = { send: { boundaryCrossed: true, ok: true, messageId: 9, hostDate: 'Sat, 29 Aug 2026 23:00:00 GMT' }, publicReadback: { available: true, found: true, contentSha256: 'aa', observedAt: 't' } };
  const evRej = { send: { boundaryCrossed: true, definitiveError4xx: true } };
  const evAbsent = { send: { boundaryCrossed: true, ok: true, messageId: 10, hostDate: 'x' }, publicReadback: { available: true, found: false } };
  const gate = readAd3Status(ROOT);

  throws(() => classifyTelegramAttempt(evOk, 'PRODUCTION'), 'TELEGRAM_PRODUCTION_CLASSIFIER_GATED', 'P1: PRODUCTION without the gate record still throws (BUILD 03 assertion preserved)');
  throws(() => classifyTelegramAttempt(evOk, 'PRODUCTION', { decision: 'AD-3', status: 'UNRESOLVED', verified_at: null }), 'TELEGRAM_PRODUCTION_CLASSIFIER_GATED', 'P2: PRODUCTION with an UNRESOLVED record throws');
  throws(() => classifyTelegramAttempt(evOk, 'PRODUCTION', { decision: 'AD-4', status: 'VERIFIED', verified_at: 'x' }), 'TELEGRAM_PRODUCTION_CLASSIFIER_GATED', 'P3: a different gate\'s VERIFIED record does not activate AD-3');

  const p = classifyTelegramAttempt(evOk, 'PRODUCTION', gate);
  const m = classifyTelegramAttempt(evOk, 'MOCK');
  ok(p.outcome === OUTCOME.SUCCESS && m.outcome === OUTCOME.SUCCESS && p.timeEvidenceClass === m.timeEvidenceClass, 'P4: PRODUCTION success rule identical to the ratified MOCK rule (send ack + public readback)');
  ok(classifyTelegramAttempt(evRej, 'PRODUCTION', gate).outcome === OUTCOME.FAILURE, 'P5: definitive pre-publication rejection is AUTHORITATIVE_FAILURE (empirical: chat-not-found class)');
  ok(classifyTelegramAttempt(evAbsent, 'PRODUCTION', gate).outcome === OUTCOME.UNCERTAIN, 'P6: absence after API success stays UNCERTAIN in production (Case-B retained; timeouts were not empirically resolved)');
}

console.log(`\nBUILD 03.1 CLOSURE SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
