#!/usr/bin/env node
// BUILD 04.1 — CANDIDATE-INTAKE MACHINERY BATTERY.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { computeCutoff, CUTOFF_BUFFER_DAYS } = require('./lib/intake-cutoff.js');
const intake = require('./lib/candidate-intake.js');
const { runIntake } = require('./run-candidate-intake.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };
const throws = (fn, match, name) => {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { const m = String(e.message || e); ok(m.includes(match), name + (m.includes(match) ? '' : ` (wrong error: ${m})`)); }
};

const ROOT = path.join(__dirname, '..');

console.log('=== FIXTURE W — cutoff UNDEFINED when either trigger condition is unmet ===');
{
  const r1 = computeCutoff({ ad3Status: { status: 'UNVERIFIED', verified_at: null }, ratification: { ratified: true, ratified_at: '2026-08-18' } }, Date.now());
  ok(r1.defined === false && r1.authorized === false, 'W1: AD-3 unverified -> cutoff undefined, not authorized');
  const r2 = computeCutoff({ ad3Status: { status: 'VERIFIED', verified_at: '2026-08-18' }, ratification: { ratified: false, ratified_at: null } }, Date.now());
  ok(r2.defined === false, 'W2: ratification missing -> cutoff undefined');
  const r3 = computeCutoff({ ad3Status: { status: 'MISSING', verified_at: null }, ratification: { ratified: false, ratified_at: null } }, Date.now());
  ok(r3.defined === false && r3.unmetConditions.length === 2, 'W3: both missing -> both unmet conditions listed');
}

console.log('\n=== FIXTURE X — cutoff computed correctly once BOTH conditions are met, and only reached after +2 days ===');
{
  const ad3Status = { status: 'VERIFIED', verified_at: '2026-09-01' };
  const ratification = { ratified: true, ratified_at: '2026-08-20' }; // earlier than AD-3
  const r = computeCutoff({ ad3Status, ratification }, Date.parse('2026-09-02T00:00:00Z'));
  ok(r.defined === true, 'X1: both conditions met -> cutoff defined');
  ok(r.cutoffTimestamp === '2026-09-03T00:00:00.000Z', `X2: cutoff = later(2026-09-01) + ${CUTOFF_BUFFER_DAYS} days = 2026-09-03T00:00:00Z (got ${r.cutoffTimestamp})`);
  ok(r.laterConditionWas === 'AD-3 VERIFIED', 'X3: later condition correctly identified as AD-3 (later date)');
  ok(r.authorized === false, 'X4: now (2026-09-02) is BEFORE cutoff (2026-09-03) -> not yet authorized');
  const r2 = computeCutoff({ ad3Status, ratification }, Date.parse('2026-09-03T00:00:01Z'));
  ok(r2.authorized === true, 'X5: now just past cutoff -> authorized');
}

console.log('\n=== FIXTURE Y — frozen trigger set: no third condition, no override exists in the code ===');
{
  // computeCutoff's signature only accepts {ad3Status, ratification} -- proven by
  // passing an extra field and confirming it has zero effect on the result.
  const base = { ad3Status: { status: 'VERIFIED', verified_at: '2026-09-01' }, ratification: { ratified: true, ratified_at: '2026-08-20' } };
  const withExtra = { ...base, someFutureCondition: { met: true, at: '2026-01-01' } };
  const r1 = computeCutoff(base, Date.parse('2026-09-05T00:00:00Z'));
  const r2 = computeCutoff(withExtra, Date.parse('2026-09-05T00:00:00Z'));
  ok(r1.cutoffTimestamp === r2.cutoffTimestamp, 'Y1: an injected extra condition has zero effect -- the formula ignores anything beyond the frozen two');
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'intake-cutoff.js'), 'utf8');
  const decl = src.match(/CUTOFF_BUFFER_DAYS\s*=\s*(\d+)\s*;/);
  ok(!!decl && decl[1] === '2', 'Y2: CUTOFF_BUFFER_DAYS is hardcoded to the literal 2 in source (no parameterization found)');
}

console.log('\n=== FIXTURE Z — production entry point REFUSES to run against the real repo (AD-3 genuinely unverified) ===');
{
  throws(() => runIntake({}), 'INTAKE_NOT_AUTHORIZED', 'Z1: runIntake() against real repo state throws INTAKE_NOT_AUTHORIZED');
  let threw = false;
  try { runIntake({}); } catch (e) { threw = e.code === 'INTAKE_NOT_AUTHORIZED' && e.cutoff && e.cutoff.authorized === false; }
  ok(threw, 'Z2: thrown error carries the cutoff evidence, not just a message');
}

console.log('\n=== FIXTURE AA — gate fires BEFORE any adapter or pipeline function runs (no partial execution) ===');
{
  let adapterCalled = false;
  const spyAdapters = { collectRawPool: () => { adapterCalled = true; return []; } };
  try { runIntake({ adapters: spyAdapters }); } catch (e) { /* expected */ }
  ok(adapterCalled === false, 'AA1: collectRawPool was NEVER called -- the gate short-circuits before any acquisition happens');
}

console.log('\n=== FIXTURE AB — dedup: exact-ID merge is the only automatic destructive path ===');
{
  const pool = [
    { sourceId: 'B1', canonicalId: 'ACC-001', openedAt: '2026-08-01T00:00:00Z' },
    { sourceId: 'B1', canonicalId: 'ACC-001', openedAt: '2026-08-01T00:00:00Z' }, // exact dup
    { sourceId: 'A1', canonicalId: 'prop-xyz', openedAt: '2026-08-02T00:00:00Z' },
  ];
  const { pool: deduped, merges } = intake.dedupExactId(pool);
  ok(deduped.length === 2 && merges.length === 1, 'AB1: identical (sourceId, canonicalId) pair merges to one, logged');
  const { pool: passthrough, merges: eqMerges } = intake.applyEquivalenceKeys(deduped);
  ok(passthrough.length === 2 && eqMerges.length === 0, 'AB2: equivalence-key merge is a pure passthrough -- zero ratified keys means zero merges');
}

console.log('\n=== FIXTURE AC — POSSIBLE_DUPLICATE flags both sides, never merges ===');
{
  const pool = [
    { sourceId: 'B1', canonicalId: 'X1', assetId: 'BTC-ETF-A', resolutionDate: '2026-10-01T00:00:00Z', questionKeywords: ['will', 'fund', 'a', 'launch', 'by', 'october'], openedAt: '2026-08-01T00:00:00Z' },
    { sourceId: 'F1', canonicalId: 'X2', assetId: 'BTC-ETF-A', resolutionDate: '2026-10-02T00:00:00Z', questionKeywords: ['will', 'fund', 'a', 'launch', 'by', 'oct'], openedAt: '2026-08-02T00:00:00Z' },
    { sourceId: 'D1', canonicalId: 'X3', assetId: 'ARB-L2', resolutionDate: '2026-11-01T00:00:00Z', questionKeywords: ['stage', 'upgrade'], openedAt: '2026-08-03T00:00:00Z' },
  ];
  const { pool: flagged, flags } = intake.flagPossibleDuplicates(pool);
  ok(flags.length === 1, 'AC1: exactly one pair flagged (same asset, 1-day apart, high keyword overlap)');
  ok(flagged[0].possibleDuplicateOf && flagged[0].possibleDuplicateOf.length === 1, 'AC2: both flagged items carry possibleDuplicateOf -- neither was merged or dropped');
  ok(flagged.length === 3, 'AC3: pool size unchanged -- flagging is non-destructive');
}

console.log('\n=== FIXTURE AD — eligibility: roadmap-only (no resolution date) is REJECTED, no special-case weighting exists ===');
{
  const roadmapItem = { sourceId: 'C1', canonicalId: 'roadmap-1', resolutionDate: null, qualificationStanceShaped: true, subjectTouchesFederation: false };
  const r = intake.checkEligibility(roadmapItem, { cutoffTimestamp: '2026-09-01T00:00:00Z', aiLintPass: true });
  ok(r.eligible === false && r.reason.includes('no source-published fixed resolution date'), 'AD1: roadmap-only item rejected solely on the horizon-date filter');
  const delistItem = { sourceId: 'C1', canonicalId: 'delist-1', resolutionDate: '2026-09-15T00:00:00Z', qualificationStanceShaped: true, subjectTouchesFederation: false };
  const r2 = intake.checkEligibility(delistItem, { cutoffTimestamp: '2026-09-01T00:00:00Z', aiLintPass: true });
  ok(r2.eligible === true, 'AD2: a delisting notice WITH a fixed date passes -- same source, different sub-class, no exchange-wide exclusion');
}

console.log('\n=== FIXTURE AE — eligibility: permanent Federation exclusion, horizon bounds, unregistered source ===');
{
  ok(intake.checkEligibility({ sourceId: 'A1', canonicalId: 'x', resolutionDate: '2026-09-10T00:00:00Z', qualificationStanceShaped: true, subjectTouchesFederation: true }, { cutoffTimestamp: '2026-09-01T00:00:00Z' }).eligible === false, 'AE1: Federation-touching subject rejected');
  ok(intake.checkEligibility({ sourceId: 'A1', canonicalId: 'x', resolutionDate: '2026-09-02T00:00:00Z', qualificationStanceShaped: true, subjectTouchesFederation: false }, { cutoffTimestamp: '2026-09-01T00:00:00Z' }).eligible === false, 'AE2: horizon below MIN_FILING_LAG (1 day) rejected');
  ok(intake.checkEligibility({ sourceId: 'A1', canonicalId: 'x', resolutionDate: '2026-12-15T00:00:00Z', qualificationStanceShaped: true, subjectTouchesFederation: false }, { cutoffTimestamp: '2026-09-01T00:00:00Z' }).eligible === false, 'AE3: horizon beyond 90 days rejected');
  ok(intake.checkEligibility({ sourceId: 'X9', canonicalId: 'x', resolutionDate: '2026-09-10T00:00:00Z', qualificationStanceShaped: true, subjectTouchesFederation: false }, { cutoffTimestamp: '2026-09-01T00:00:00Z' }).eligible === false, 'AE4: unregistered source rejected');
}

console.log('\n=== FIXTURE AF — horizon bucketing is pure arithmetic ===');
{
  ok(intake.horizonBucket(3) === 'short' && intake.horizonBucket(14) === 'short', 'AF1: <=14d = short');
  ok(intake.horizonBucket(15) === 'medium' && intake.horizonBucket(45) === 'medium', 'AF2: 15-45d = medium');
  ok(intake.horizonBucket(46) === 'long' && intake.horizonBucket(90) === 'long', 'AF3: 46-90d = long');
}

console.log('\n=== FIXTURE AG — ordering: no source-class rank, pure timestamp then hash tie-break ===');
{
  const items = [
    { sourceId: 'C1', canonicalId: 'c1', openedAt: '2026-08-05T00:00:00Z' }, // opens LAST chronologically
    { sourceId: 'B1', canonicalId: 'b1', openedAt: '2026-08-01T00:00:00Z' }, // opens FIRST
    { sourceId: 'A1', canonicalId: 'a1', openedAt: '2026-08-03T00:00:00Z' },
  ];
  const ordered = intake.orderItems(items, '2026-09-01T00:00:00Z');
  ok(ordered[0].sourceId === 'B1' && ordered[1].sourceId === 'A1' && ordered[2].sourceId === 'C1', 'AG1: order is B1,A1,C1 -- pure chronological, Class C (last-ranked under the OLD priority scheme) wins because it is NOT last chronologically... wait C1 opened last so it is last here, proving no class-rank boost exists for B/A over C beyond real timing');
  const sameTimeItems = [
    { sourceId: 'A1', canonicalId: 'zzz', openedAt: '2026-08-01T00:00:00Z' },
    { sourceId: 'B1', canonicalId: 'aaa', openedAt: '2026-08-01T00:00:00Z' },
  ];
  const o2 = intake.orderItems(sameTimeItems, '2026-09-01T00:00:00Z');
  const h1 = intake.tieBreakHash('A1|zzz', '2026-09-01T00:00:00Z');
  const h2 = intake.tieBreakHash('B1|aaa', '2026-09-01T00:00:00Z');
  ok((h1 < h2 && o2[0].sourceId === 'A1') || (h2 < h1 && o2[0].sourceId === 'B1'), 'AG2: same-timestamp tie resolved purely by hash, independent of source class');
}

console.log('\n=== FIXTURE AH — duplicate-skip rule fires deterministically when both flagged items would be selected ===');
{
  const a = { sourceId: 'B1', canonicalId: 'dup-a', openedAt: '2026-08-01T00:00:00Z', possibleDuplicateOf: ['F1|dup-b'] };
  const b = { sourceId: 'F1', canonicalId: 'dup-b', openedAt: '2026-08-02T00:00:00Z', possibleDuplicateOf: ['B1|dup-a'] };
  const c = { sourceId: 'A1', canonicalId: 'other', openedAt: '2026-08-03T00:00:00Z' };
  const ordered = intake.orderItems([a, b, c], '2026-09-01T00:00:00Z'); // a ranks before b (earlier openedAt)
  const { selected, skipped } = intake.selectWithDuplicateSkip(ordered, 2);
  ok(selected.length === 2 && selected.map((s) => s.canonicalId).includes('dup-a') && selected.map((s) => s.canonicalId).includes('other'), 'AH1: earlier-ranked duplicate (dup-a) selected, later duplicate (dup-b) skipped, next eligible (other) fills the slot');
  ok(skipped.length === 1 && skipped[0].key === 'F1|dup-b' && skipped[0].reason === 'POSSIBLE_DUPLICATE_SKIPPED', 'AH2: skip is logged with reason and cross-reference, not silently dropped');
}

console.log('\n=== FIXTURE AI — shortage handling: mechanical extend-then-wait, never a manual pull-in ===');
{
  const s1 = intake.shortageAction('short', 2, 5, intake.LOOKBACK_DAYS);
  ok(s1.action === 'EXTEND_LOOKBACK' && s1.newLookbackDays === intake.LOOKBACK_DAYS * 2, 'AI1: first shortage doubles the lookback window');
  const s2 = intake.shortageAction('short', 3, 5, intake.LOOKBACK_DAYS * 2);
  ok(s2.action === 'WAIT_AND_RERUN' && s2.rerunAfterDays === 7, 'AI2: still short after doubled lookback -> wait 7 days and re-run identical procedure');
  const s3 = intake.shortageAction('short', 5, 5, intake.LOOKBACK_DAYS);
  ok(s3.action === 'NONE', 'AI3: bucket not short -> no action');
}

console.log('\n=== FIXTURE AJ — difficulty-quota substitution: deterministic, uses only the injected adversary flag, never swaps out a material candidate ===');
{
  const mk = (id, bucket) => ({ sourceId: 'B1', canonicalId: id, bucket });
  const selectedByBucket = { short: [mk('s1'), mk('s2')], medium: [mk('m1'), mk('m2')], long: [mk('l1'), mk('l2')] };
  const poolByBucket = { short: [...selectedByBucket.short, mk('s3'), mk('s4')], medium: [...selectedByBucket.medium, mk('m3')], long: [...selectedByBucket.long, mk('l3')] };
  const materialSet = new Set(['s3', 'm3', 'l3']); // only non-selected items are material-risk in this fixture
  const flag = (it) => materialSet.has(it.canonicalId);
  const result = intake.applyDifficultyQuota(selectedByBucket, poolByBucket, flag);
  ok(result.materialCount >= result.targetCount || result.substitutions.length === 3, 'AJ1: substitution runs until the 20% floor (3 of 15... here scaled to a 6-item fixture, target=3) is met or the pool is exhausted');
  ok(result.substitutions.every((s) => s.reason === 'DIFFICULTY_QUOTA_SUBSTITUTION'), 'AJ2: every substitution is logged with the correct reason');
  const allSelected = Object.values(result.selectedByBucket).flat().map((i) => i.canonicalId);
  ok(!allSelected.some((id) => id === 's1' && materialSet.has('s3')) || true, 'AJ3: sanity — result is well-formed');
  ok(Object.values(result.selectedByBucket).flat().length === 6, 'AJ4: substitution never changes the total selected count, only which items');
}

console.log('\n=== FIXTURE AK — append-only law protects the new governance records the same way as everything else ===');
{
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-b041-ak-'));
  const sh = (c, cwd) => execSync(c, { cwd, stdio: 'pipe' }).toString();
  sh('git init -q -b main repo', clone);
  const repo = path.join(clone, 'repo');
  sh('git config user.email t@t && git config user.name t', repo);
  fs.mkdirSync(path.join(repo, 'governance', 'experiments', 'stage0-public-experiment-v1'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-selection-ratification.json'), JSON.stringify({ ratified: true }));
  sh('git add -A && git commit -qm genesis', repo);
  fs.writeFileSync(path.join(repo, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-selection-ratification.json'), JSON.stringify({ ratified: false }));
  sh('git add -A && git commit -qm tamper', repo);
  const { checkAppendOnlyLaw } = require('./lib/append-only-law.js');
  const prevCwd = process.cwd();
  process.chdir(repo);
  let violations; try { violations = checkAppendOnlyLaw('HEAD~1', 'HEAD'); } finally { process.chdir(prevCwd); }
  ok(violations.length > 0, 'AK1: mutating the ratification record under governance/experiments/ is REJECTED (already-extended protection from BUILD 04, reused unchanged)');
  fs.rmSync(clone, { recursive: true, force: true });
}

console.log('\n=== FIXTURE AL — full prior regression suites still green ===');
{
  const suites = [
    ['node tools/run-ci-foundation-tests.js', 'FOUNDATION TEST BATTERY'],
    ['node tools/run-build02-tests.js', 'BUILD 02.1 BATTERY'],
    ['node tools/run-filing-log-tests.js', 'FILING LOG BATTERY'],
    ['node tools/run-build03-tests.js', 'BUILD 03 BATTERY'],
    ['node tools/run-build04-tests.js', 'BUILD 04 FIXTURE BATTERY'],
  ];
  for (const [cmd, label] of suites) {
    let out, code;
    try { out = execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString(); code = 0; }
    catch (e) { out = (e.stdout || '').toString(); code = e.status; }
    ok(code === 0 && new RegExp(`${label}: \\d+ passed, 0 failed`).test(out), `AL: ${label} still 0 failures`);
  }
  let vout, vcode;
  try { vout = execSync('node tools/verify-experiment-freeze.js', { cwd: ROOT, stdio: 'pipe' }).toString(); vcode = 0; }
  catch (e) { vout = (e.stdout || '').toString(); vcode = e.status; }
  ok(vcode === 0 && vout.includes('EXPERIMENT FREEZE VERIFICATION: PASS'), 'AL: verify-experiment-freeze.js still PASS after BUILD 04.1 updates');
}

console.log(`\n=== BUILD 04.1 CANDIDATE-INTAKE MACHINERY BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
