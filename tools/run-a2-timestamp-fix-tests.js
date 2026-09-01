#!/usr/bin/env node
// A2 ACTIVITY-EVALUATION FIX — regression tests (no network; injected fetch).
// Reproduces the Epoch 1 defect (RFC3339 string timestamps compared to numeric
// seconds -> every A2 proposal silently dropped -> governors silently skipped)
// and proves the fix: string timestamps counted, inactive governors printed,
// unparseable timestamps surfaced, 42d disposition label correct.
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { execSync } = require('child_process');
const D = require('./diagnose-a1a2-scope.js');
const intake = require('./lib/candidate-intake.js');
const ROOT = path.join(__dirname, '..');
const SLATE = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); const before = sha(SLATE);
let passed = 0, failed = 0; const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };
const res = (statusCode, body, headers = {}) => ({ ok: true, statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
let fakeNow = 1e12; D.setTiming({ sleep: async (ms) => { fakeNow += ms; }, now: () => fakeNow });
const CUT = Date.parse('2026-08-31T00:00:00.000Z') / 1000; // Epoch 1 cutoff, seconds
const KEY = 'test-only-placeholder-key';

// ── tsToSec ────────────────────────────────────────────────────────────
ok(D.tsToSec('2026-08-20T10:00:00Z') === Date.parse('2026-08-20T10:00:00Z') / 1000, 'T1: RFC3339 string -> epoch seconds');
ok(D.tsToSec('2026-08-20T10:00:00.000+00:00') === Date.parse('2026-08-20T10:00:00Z') / 1000, 'T2: RFC3339 with offset/fraction');
ok(D.tsToSec(1755684000) === 1755684000 && D.tsToSec('1755684000') === 1755684000, 'T3: numeric seconds (number or digit-string) pass through');
ok(D.tsToSec(1755684000123) === 1755684000, 'T4: numeric milliseconds scaled to seconds');
ok(D.tsToSec('not a date') === null && D.tsToSec(null) === null && D.tsToSec({}) === null, 'T5: unparseable -> null, never NaN');

// ── the Epoch 1 failure mode, reproduced then fixed ────────────────────
const iso = (secOffsetFromCut) => new Date((CUT + secOffsetFromCut) * 1000).toISOString();
const proposalsPage = (govId) => ({ data: { proposals: { nodes: [
  { id: '9001', onchainId: '41', block: { timestamp: iso(-2 * 86400) }, end: { timestamp: iso(+5 * 86400) }, metadata: { title: '[FIXTURE] in-window, ends 5d after cutoff' } },
  { id: '9000', onchainId: '40', block: { timestamp: iso(-30 * 86400) }, end: { timestamp: iso(-23 * 86400) }, metadata: { title: '[FIXTURE] in 90d, outside 21d' } },
  { id: '8999', onchainId: '39', block: { timestamp: iso(-120 * 86400) }, end: { timestamp: iso(-113 * 86400) }, metadata: { title: '[FIXTURE] older than 90d' } },
], pageInfo: { lastCursor: null } } } });
(async () => {
  process.env.TALLY_API_KEY = KEY;
  D.setFetch(async (req) => { const b = JSON.parse(req.body); if (req.headers['Api-Key'] !== KEY) return res(401, {}); if (/proposals\(/.test(b.query)) return res(200, proposalsPage(b.variables.input.filters.governorId)); return res(422, { errors: [{ message: 'x' }] }); });
  const act = await D.a2ProposalsCreatedBetween('eip155:1:0x' + '1'.repeat(40), CUT - 90 * 86400, CUT);
  ok(!act.error && act.items.length === 2, 'F1: RFC3339 timestamps are now counted in the 90d window (2 of 3 fixtures; the 120d-old one excluded)');
  ok(act.items.every((p) => typeof p._createdSec === 'number'), 'F2: items carry normalized _createdSec');
  ok(act.items.filter((p) => p._createdSec >= CUT - 21 * 86400).length === 1, 'F3: 21d sub-window counts exactly the 2-day-old item');
  ok(act.unparseable.length === 0, 'F4: no unparseable timestamps for valid RFC3339 input');
  // unparseable surfaced, not silently dropped
  D.setFetch(async () => res(200, { data: { proposals: { nodes: [{ id: '1', onchainId: '1', block: { timestamp: 'garbage' }, end: { timestamp: null } }], pageInfo: { lastCursor: null } } } }));
  const bad = await D.a2ProposalsCreatedBetween('g', CUT - 90 * 86400, CUT);
  ok(bad.items.length === 0 && bad.unparseable.length === 1 && bad.unparseable[0].rawTimestamp === 'garbage', 'F5: unparseable timestamp is reported, not silently counted or dropped');

  // regression: the OLD comparison would have yielded 0 for the same fixtures
  const oldStyle = proposalsPage('x').data.proposals.nodes.filter((p) => p.block.timestamp >= (CUT - 90 * 86400) && p.block.timestamp <= CUT).length;
  ok(oldStyle === 0, 'F6: REGRESSION PROOF — the pre-fix comparison (string >= number) yields 0 on the same fixtures (the Epoch 1 failure mode)');

  // ── pool + eligibility through the ratified pipeline with normalized seconds ──
  const { mapItem } = require('./lib/live-acquisition-provider.js');
  const it = mapItem('A2', { canonicalId: '41', sourceTimestamp: act.items[0]._createdSec, sourceEnd: D.tsToSec(act.items[0].end.timestamp), title: 't' }, { governorId: 'g' });
  const e = intake.checkEligibility(it, { cutoffTimestamp: '2026-08-31T00:00:00.000Z', aiLintPass: true });
  ok(e.eligible === true && intake.horizonBucket(e.daysToResolution) === 'short', 'F7: a normalized A2 item ending 5d after cutoff is ELIGIBLE and SHORT through the ratified pipeline');

  // ── disposition label: 42d block must say WAIT_AND_RERUN when still short ──
  const d21 = D.diagnose([], 21); const d42 = D.diagnose([], 42);
  ok(d21.shortage.medium === 'EXTEND_LOOKBACK' && d42.shortage.medium === 'WAIT_AND_RERUN', 'L1: FIX — diagnose(pool, 42) now reports WAIT_AND_RERUN (was hardcoded to 21 -> EXTEND_LOOKBACK)');
  ok(D.diagnose([]).shortage.long === 'EXTEND_LOOKBACK', 'L2: default lookback remains 21');

  // ── fetchedInactive is printed (code-level check: the silent `continue` is gone) ──
  const src = fs.readFileSync(path.join(__dirname, 'diagnose-a1a2-scope.js'), 'utf8');
  ok(/fetchedInactive\.push\(/.test(src) && /report\.A2\.fetchedInactive = fetchedInactive/.test(src), 'P1: governors with zero window activity are recorded and printed under A2.fetchedInactive');
  ok(!/if \(act\.items\.length < 1\) continue;/.test(src), 'P2: the silent skip is gone');
  ok(!/p\.block\.timestamp >= win\(/.test(src) && !/p\.block\.timestamp >= w\.fromSec/.test(src) && !/created >= fromSec && created <= toSec/.test(src), 'P3: no raw string-vs-number A2 comparison remains');
  ok(/report\.A2\.timestampNormalization/.test(src), 'P4: the normalization is disclosed in the report output');

  // ── acquisition bound unchanged (still the cutoff, not run time) ──
  ok(/const nowSec = Math\.floor\(cutoffMs \/ 1000\);/.test(src), 'B1: acquisition bound remains created <= cutoff (nowSec = cutoff)');
  ok(sha(SLATE) === before, 'W1: slate untouched');
  delete process.env.TALLY_API_KEY;
  console.log(`\nA2 TIMESTAMP FIX SUITE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
