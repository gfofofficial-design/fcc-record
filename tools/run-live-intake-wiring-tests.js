#!/usr/bin/env node
// FCC STAGE 0 — SUPERVISED LIVE INTAKE WIRING TESTS (A–P, additive). No network.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateExecutionPreconditions } = require('./lib/intake-authorization.js');
const { runIntake, summarizeIntake } = require('./run-candidate-intake.js');
const { buildLiveProvider, buildFixtureProvider, mapItem } = require('./lib/live-acquisition-provider.js');
const fw = require('./lib/intake-final-write.js');
const intake = require('./lib/candidate-intake.js');

const ROOT = path.join(__dirname, '..');
const SLATE_PATH = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const MARKER_PATH = path.join(ROOT, 'governance', 'gates', 'intake-execution-001.completed.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const SLATE_BEFORE = sha(SLATE_PATH);
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

const AUTH = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'gates', 'intake-execution-001.json'), 'utf8'));
const GOOD = { cutoff: { defined: true, reached: true, cutoffTimestamp: '2026-08-31T00:00:00.000Z' }, authRecords: [{ name: 'intake-execution-001.json', record: AUTH }], methodologySha: AUTH.pins.methodology.sha256, freezeSha: AUTH.pins.experiment_freeze.sha256, slateShaNow: AUTH.pins.pre_intake_candidate_slate_sha256, completionMarkerExists: false, blockedRecordsPresent: false, tallyKeyPresent: true, readinessAggregate: 'READY', supervisedMode: true };
const refuses = (over, code) => { const r = evaluateExecutionPreconditions({ ...GOOD, ...over }); return !r.allowed && r.failures.some((f) => f.startsWith(code)); };

// ── A–F, I: gate refusals ────────────────────────────────────────────────
ok(refuses({ authRecords: [] }, 'B:'), 'A: authorization absent => refuse');
ok(refuses({ cutoff: { defined: true, reached: false, cutoffTimestamp: '2026-08-31T00:00:00.000Z' } }, 'A:'), 'B: pre-cutoff (simulated) => refuse');
ok(refuses({ tallyKeyPresent: false }, 'G:'), 'C: Tally key absent => refuse before any live acquisition');
ok(refuses({ readinessAggregate: 'BLOCKED' }, 'H:'), 'D: readiness blocked => refuse');
ok(refuses({ supervisedMode: false }, 'SUPERVISION:'), 'E: supervised marker absent => refuse');
{
  let threw = false;
  try { runIntake({ nowMs: Date.parse('2026-08-31T00:00:00Z'), adapters: undefined }); } catch (e) { threw = /no acquisition adapters/.test(e.message); }
  ok(threw, 'F: live provider absent => runIntake refuses (the exact refusal the owner observed)');
}
ok(refuses({ slateShaNow: 'e'.repeat(64) }, 'D:'), 'I: slate pre-hash drift => refuse');

// ── G/H: fixture dry-run is deterministic and writes nothing ────────────
const fixtureItems = [];
{
  const cut = '2026-08-31T00:00:00.000Z';
  const mk = (i, days, src) => ({ sourceId: src, canonicalId: `fx-${src}-${i}`, openedAt: `2026-08-${String(10 + (i % 15)).padStart(2, '0')}T00:00:00Z`, resolutionDate: new Date(Date.parse(cut) + days * 86400000).toISOString(), assetId: `asset-${i}`, title: `[FIXTURE] item ${i}`, keywords: ['fixture', 'item', String(i)], qualificationStanceShaped: true, subjectTouchesFederation: false });
  for (let i = 0; i < 7; i++) fixtureItems.push(mk(i, 5 + i, 'A1'));            // short
  for (let i = 10; i < 17; i++) fixtureItems.push(mk(i, 20 + i, 'A2'));         // medium
  for (let i = 20; i < 27; i++) fixtureItems.push(mk(i, 50 + i, 'C2'));         // long
  fixtureItems.push({ ...mk(99, 30, 'C1'), sourceId: 'G1' });                    // benchmark source sneaks in
  fixtureItems.push({ ...mk(98, 30, 'B1'), resolutionDate: null });              // undated
  fixtureItems.push({ ...mk(97, 30, 'D1'), title: '[FIXTURE] GFOF related', subjectTouchesFederation: true });
}
{
  const p1 = buildFixtureProvider(fixtureItems);
  const r1 = runIntake({ nowMs: Date.parse('2026-08-31T00:00:00Z'), adapters: p1, dryRun: true });
  const r2 = runIntake({ nowMs: Date.parse('2026-08-31T00:00:00Z'), adapters: buildFixtureProvider(fixtureItems), dryRun: true });
  const s1 = summarizeIntake(r1, p1), s2 = summarizeIntake(r2, p1);
  ok(JSON.stringify(s1.selected) === JSON.stringify(s2.selected) && s1.selected.length === 15, 'G1: fixture dry-run selects 15 deterministically across two runs');
  ok(s1.bucketCounts.short === 5 && s1.bucketCounts.medium === 5 && s1.bucketCounts.long === 5, 'G2: frozen 5/5/5 bucket rule applied');
  ok(sha(SLATE_PATH) === SLATE_BEFORE, 'G3: dry-run wrote nothing to candidate-slate.json');
  ok(!fs.existsSync(MARKER_PATH), 'H: completion marker remains absent after dry-run');
  ok(!JSON.stringify(s1).includes('TALLY') || !/TALLY_API_KEY=/.test(JSON.stringify(s1)), 'G4: summary carries no credential material');
  ok(s1.rejectedByReason && Object.keys(s1.rejectedByReason).some((k) => /source not in registry/.test(k)), 'O1: G1-sourced item rejected by the frozen registry filter');
  ok(Object.keys(s1.rejectedByReason).some((k) => /no source-published fixed resolution date/.test(k)), 'P0: undated item rejected by the frozen roadmap rule');
  ok(Object.keys(s1.rejectedByReason).some((k) => /permanent exclusion/.test(k)), 'G5: Federation-touching item permanently excluded');
  ok(s1.shortage.short.action === 'NONE' && s1.difficultyQuota.materialCount === 0, 'G6: shortage NONE with full buckets; adversary quota honestly reports 0 material (separate frozen mechanism)');
}
{ // shortage path
  const few = fixtureItems.filter((i) => i.sourceId === 'A1').slice(0, 2);
  const p = buildFixtureProvider(few);
  const s = summarizeIntake(runIntake({ nowMs: Date.parse('2026-08-31T00:00:00Z'), adapters: p, dryRun: true }), p);
  ok(s.shortage.short.action === 'EXTEND_LOOKBACK' && s.shortage.medium.action === 'EXTEND_LOOKBACK', 'G7: frozen shortage procedure surfaces EXTEND_LOOKBACK when buckets are short');
}

// ── O/P: structural exclusions in the live provider ─────────────────────
{
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'live-acquisition-provider.js'), 'utf8');
  ok(!/ADAPTERS\.G1|ADAPTERS\.G2|polymarket|kalshi/i.test(src.replace(/\/\/.*$/gm, '')), 'O2: live provider has NO G1/G2 acquisition code path (comments aside)');
  ok(!intake.REGISTRY_SOURCE_IDS.includes('G1') && !intake.REGISTRY_SOURCE_IDS.includes('G2'), 'O3: pipeline registry excludes G1/G2');
  const lp = buildLiveProvider({ repoRoot: ROOT, fetchFn: async () => ({ ok: true, statusCode: 200, headers: {}, body: '<rss><channel><item><guid>x</guid><pubDate>Sun, 30 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>' }), env: {}, nowMs: Date.parse('2026-08-31T00:00:00Z') });

  (async () => {
    await lp.collect();
    ok(lp.stats.C1 && /CONDITIONAL_ZERO/.test(lp.stats.C1.zeroReason), 'P1: C1 unconfirmed => zero contribution');
    ok(lp.stats.C2 && lp.stats.C2.rawItems >= 0 && !lp.stats.C2.zeroReason, 'P2: C2 ratified feed is acquired via the addendum surface');
    ok(lp.stats.A1 && /SCOPE_ADDENDUM_REQUIRED/.test(lp.stats.A1.zeroReason), 'P3: A1 without a ratified space list contributes zero — no unscoped global query');
    ok(lp.stats.A2 && lp.stats.A2.failure && lp.stats.A2.failure.state === 'CREDENTIAL_REQUIRED', 'P4: A2 without key is CREDENTIAL_REQUIRED (value never touched)');
    const m = mapItem('A1', { canonicalId: '0xabc', sourceTimestamp: 1756500000, sourceEnd: 1757000000, space: 'x.eth', title: 't' }, {});
    ok(m.resolutionDate === new Date(1757000000 * 1000).toISOString() && m.openedAt === new Date(1756500000 * 1000).toISOString(), 'P5: A1 resolution/opened dates are the source-published fields verbatim');
    ok(mapItem('B1', { canonicalId: '000-1', sourceTimestamp: '2026-08-20', form: '8-K' }, {}).resolutionDate === null, 'P6: filings carry no fabricated resolution date');

    // ── J/K/L/M: final write transaction core (temp dirs only) ───────────
    const baseSlate = JSON.parse(fs.readFileSync(SLATE_PATH, 'utf8'));
    const p1 = buildFixtureProvider(fixtureItems);
    const res = runIntake({ nowMs: Date.parse('2026-08-31T00:00:00Z'), adapters: p1, dryRun: true });
    const doc = fw.buildSlateDocument(baseSlate, res.selectedByBucket, { cutoffTimestamp: '2026-08-31T00:00:00.000Z', authorizationId: 'intake-execution-001' });
    ok(doc.all_slots_populated === true && doc.slots.length === 15, 'J0: slate document built with exactly 15 selected slots');
    const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-fw-')); fs.copyFileSync(SLATE_PATH, path.join(d, 'candidate-slate.json')); return d; };
    {
      const d = tmp(); const t = fw.fsTarget(d);
      const r = fw.runFinalWriteTransaction({ target: t, expectedPreHash: SLATE_BEFORE, newSlateDocument: doc, authorizationId: 'intake-execution-001', nowIso: '2026-08-31T01:00:00Z' });
      ok(r.ok && r.state === 'COMPLETED' && fs.existsSync(path.join(d, 'intake-execution-001.completed.json')), 'J: fixture transaction: slate written, verified, THEN completion marker');
      const r2 = fw.runFinalWriteTransaction({ target: t, expectedPreHash: SLATE_BEFORE, newSlateDocument: doc, authorizationId: 'intake-execution-001', nowIso: 'x' });
      ok(!r2.ok && /REFUSED/.test(r2.state), 'M: second use (marker present / hash moved) => refuse');
    }
    { const d = tmp(); const r = fw.runFinalWriteTransaction({ target: fw.fsTarget(d, { failSlateWrite: true }), expectedPreHash: SLATE_BEFORE, newSlateDocument: doc, authorizationId: 'x', nowIso: 'x' });
      ok(r.state === 'SLATE_WRITE_FAILED_NO_MARKER' && !fs.existsSync(path.join(d, 'intake-execution-001.completed.json')), 'K: slate-write failure => no marker'); }
    { const d = tmp(); const r = fw.runFinalWriteTransaction({ target: fw.fsTarget(d, { failMarkerWrite: true }), expectedPreHash: SLATE_BEFORE, newSlateDocument: doc, authorizationId: 'x', nowIso: 'x' });
      ok(r.state === 'RECONCILIATION_REQUIRED' && r.slateSha256 && /DO NOT rerun/.test(r.steps.join(' ')), 'L: marker failure after verified write => explicit RECONCILIATION_REQUIRED, no silent rerun'); }
    { const d = tmp(); const r = fw.runFinalWriteTransaction({ target: fw.fsTarget(d), expectedPreHash: 'f'.repeat(64), newSlateDocument: doc, authorizationId: 'x', nowIso: 'x' });
      ok(r.state === 'REFUSED_PRE_HASH_DRIFT', 'I2: transaction re-verifies the pre-hash immediately before writing'); }
    { let code = null; try { fw.executeFinalWrite(); } catch (e) { code = e.code; }
      ok(code === 'ARCHITECTURE_DECISION_REQUIRED', 'W: real-repo final write REFUSES pending the append-only architecture decision — nothing written'); }

    // ── N: ordinary CI cannot execute live intake ──────────────────────
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-candidate-intake.js'), '--no-write-dry-run'], { encoding: 'utf8', env: { ...process.env, FCC_SUPERVISED_INTAKE: '' } });
    ok(r.status === 2 || r.status === 3, 'N1: CLI without supervised mode (even with --no-write-dry-run) never enters the pipeline');
    ok(!/INTAKE RESULT SUMMARY/.test(r.stdout), 'N2: no summary produced without supervision');
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    ok(!/execute-intake-supervised|FCC_SUPERVISED_INTAKE|no-write-dry-run/.test(ci) && !/schedule:|workflow_dispatch/.test(ci), 'N3: CI workflow has no supervised flag, marker, dry-run, schedule, or manual dispatch path');

    ok(sha(SLATE_PATH) === SLATE_BEFORE && !fs.existsSync(MARKER_PATH), 'FINAL: real slate untouched and no real marker after the whole suite');
    console.log(`\nLIVE INTAKE WIRING SUITE: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })();
}
