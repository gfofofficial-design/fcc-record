#!/usr/bin/env node
// Filing Log acceptance battery — fixtures A-K, isolated FCC-TEST-* only,
// never touching the real public record/filing-log.ndjson.
const { openFiling, abandonFiling, verifyInstrumentIdAuthority, computeNextIds, assertWorkPermitted } = require('./filing-log.js');
const { verifyEventChain, ZERO_ROOT } = require('./lib/event-hash.js');
const { prepareLockRun } = require('./lock-run.js');
const fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };

let seq = 0;
const testUlid = () => { seq++; return '01TEST0000' + String(seq).padStart(16, '0'); };

console.log('=== FIXTURE A: first reservation ===');
let log = [];
{
  const e1 = openFiling({ subject: 'test subject A', rationale: 'test rationale A', existingEvents: log, eventIdGenerator: testUlid });
  ok(e1.filing_id === 'FCC-F-000001' && e1.payload.instrument_id === 'FCC-I-000001', 'first public-intent entry reserves FCC-F-000001 / FCC-I-000001');
  ok(e1.prev_event_sha256 === ZERO_ROOT, 'chain roots at 64 zeroes');
  log.push(e1);
}

console.log('\n=== FIXTURE B: sequential reservation ===');
{
  const e2 = openFiling({ subject: 'test subject B', rationale: 'test rationale B', existingEvents: log, eventIdGenerator: testUlid });
  ok(e2.filing_id === 'FCC-F-000002' && e2.payload.instrument_id === 'FCC-I-000002', 'next valid reservation is FCC-F-000002 / FCC-I-000002');
  log.push(e2);
}

console.log('\n=== FIXTURE C: duplicate attempt ===');
{
  // Simulate a malformed duplicate by hand-constructing an event that
  // reuses FCC-I-000002 and checking the authority lookup rejects it.
  const dupeLog = [...log, { ...log[1], event_id: testUlid(), prev_event_sha256: log[1].event_sha256 }];
  // recompute its hash properly so we're testing DUPLICATE detection, not a broken chain
  const { buildEvent } = require('./lib/event-hash.js');
  const dupe = buildEvent({ event_id: testUlid(), type: 'filing-opened', at: new Date().toISOString(), filing_id: 'FCC-F-000003', payload: { subject: 's', rationale: 'r', instrument_id: 'FCC-I-000002' } }, log[log.length - 1].event_sha256);
  const withDupe = [...log, dupe];
  const result = verifyInstrumentIdAuthority('FCC-I-000002', withDupe);
  ok(!result.authoritative && /DUPLICATE/.test(result.reason), 'duplicate instrument_id across two filing-opened events REJECTED');
}

console.log('\n=== FIXTURE D: gap persistence ===');
{
  const abandonEvent = abandonFiling({ filingId: 'FCC-F-000002', abandonmentReason: 'test abandonment reason', existingEvents: log, eventIdGenerator: testUlid });
  log.push(abandonEvent);
  const e3 = openFiling({ subject: 'test subject C', rationale: 'test rationale C', existingEvents: log, eventIdGenerator: testUlid });
  ok(e3.payload.instrument_id === 'FCC-I-000003', 'FCC-I-000002 abandoned -> next reservation is FCC-I-000003, not recycled');
  log.push(e3);
  const lookup2 = verifyInstrumentIdAuthority('FCC-I-000002', log);
  ok(!lookup2.authoritative && /ABANDONED/.test(lookup2.reason), 'FCC-I-000002 remains permanently visible but is not authority-eligible');
}

console.log('\n=== FIXTURE E: append-only abandonment ===');
{
  const originalOpenBytes = JSON.stringify(log[1]); // the FCC-F-000002 filing-opened event, untouched
  ok(originalOpenBytes.includes('FCC-I-000002') && !originalOpenBytes.includes('abandonment_reason'), 'original registration event bytes unchanged (no abandonment_reason merged into it)');
  ok(log.some(e => e.type === 'filing-abandoned' && e.filing_id === 'FCC-F-000002'), 'abandonment is a separate, newly appended event');
}

console.log('\n=== FIXTURE F: chain tamper ===');
{
  const tampered = JSON.parse(JSON.stringify(log));
  tampered[0].payload.subject = 'TAMPERED SUBJECT';
  const result = verifyEventChain(tampered, ZERO_ROOT);
  ok(!result.ok && result.brokenAtIndex === 0, 'mutating an earlier event breaks downstream chain verification');
  const clean = verifyEventChain(log, ZERO_ROOT);
  ok(clean.ok, 'untampered chain verifies cleanly');
}

console.log('\n=== FIXTURE G: truncation ===');
{
  // Reuse the proven BUILD 01.2 append-only law directly against a real
  // filing-log.ndjson file admitted into an isolated clone.
  const { execSync } = require('child_process');
  const os = require('os');
  function sh(cmd, cwd) { return execSync(cmd, { cwd, stdio: 'pipe' }).toString(); }
  const REPO_ROOT = path.resolve(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-filinglog-test-'));
  const clone = path.join(tmp, 'repo');
  sh(`git clone -q "${REPO_ROOT}" "${clone}"`);
  sh('git config user.email t@t && git config user.name T', clone);
  const ndjsonLines = log.slice(0, 2).map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(clone, 'record/filing-log.ndjson'), ndjsonLines);
  sh('git add -A && git commit -q -m "fixture: two filing-log events"', clone);
  const base = sh('git rev-parse HEAD', clone).trim();
  sh('git checkout -q -b attack-truncate', clone);
  fs.writeFileSync(path.join(clone, 'record/filing-log.ndjson'), log.slice(0, 1).map(e => JSON.stringify(e)).join('\n') + '\n');
  sh('git add -A && git commit -q -m "attack: truncate filing log"', clone);
  const checkerScript = path.join(tmp, 'checker.js');
  fs.writeFileSync(checkerScript, `
    const { checkAppendOnlyLaw } = require(${JSON.stringify(path.join(REPO_ROOT, 'tools/lib/append-only-law.js'))});
    console.log(JSON.stringify(checkAppendOnlyLaw(${JSON.stringify(base)}, 'attack-truncate')));
  `);
  const violations = JSON.parse(sh(`node "${checkerScript}"`, clone));
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(violations.length > 0, 'removing prior NDJSON bytes from filing-log.ndjson is REJECTED by the append-only guard');
}

console.log('\n=== FIXTURE H: unauthorized/local ID ===');
{
  const result = verifyInstrumentIdAuthority('FCC-I-000099', log);
  ok(!result.authoritative && /NOT FOUND/.test(result.reason), 'valid-format id not present in the authoritative log FAILS authority verification');
}

console.log('\n=== FIXTURE I: abandoned ID rejected for production eligibility ===');
{
  const result = verifyInstrumentIdAuthority('FCC-I-000002', log);
  ok(!result.authoritative, 'authority lookup finds the id but production-eligibility verification REJECTS it (abandoned)');
}

console.log('\n=== FIXTURE J: PRELOCK dependency ===');
{
  const { validatePrelockPackage } = require('./prelock.js');
  const semantic = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/fixtureA-prelock.json'), 'utf8'));
  const pre = validatePrelockPackage(semantic);
  ok(!('instrument_id' in pre.semantic_body), 'PRELOCK has no authoritative id — none minted by PRELOCK itself');

  const verified = verifyInstrumentIdAuthority('FCC-I-000001', log);
  ok(verified.authoritative === true, 'a verified Filing Log id (FCC-I-000001) is confirmed authoritative');
  const run = prepareLockRun({ prelockSemanticBody: pre.semantic_body, authoritativeInstrumentId: 'FCC-I-000001' });
  ok(run.instrument_id === 'FCC-I-000001', 'that verified id can be supplied to Lock Run preparation, which never mints its own');
}

console.log('\n=== FIXTURE K: concurrency/collision ===');
{
  // Self-contained chain, independent of the shared `log` fixture state
  // above, so this test's own realistic append/rebase sequence can be
  // verified for real by the now-strict openFiling() rather than hand-waved.
  const kBase = [];
  const proposalA = openFiling({ subject: 'concurrent A', rationale: 'concurrent A', existingEvents: kBase, eventIdGenerator: testUlid });
  const proposalB = openFiling({ subject: 'concurrent B', rationale: 'concurrent B', existingEvents: kBase, eventIdGenerator: testUlid });
  ok(proposalA.payload.instrument_id === proposalB.payload.instrument_id, 'both proposals computed the SAME next id from the same base (the collision this fixture tests)');

  // Git's own serialized merge history to the single protected `main`
  // branch is the coordination primitive: only ONE proposal can actually
  // become the next line in the authoritative, independently-observable
  // record/filing-log.ndjson (whichever merges first). Simulate: A merges
  // first — this genuinely verifies, since proposalA.prev_event_sha256
  // correctly roots at kBase's tip (ZERO_ROOT).
  const kAfterA = [...kBase, proposalA];

  // B must rebase and recompute against the REAL new tip — this is a
  // fresh openFiling() call against kAfterA, itself now re-verified by the
  // tightened authority-base check, exactly as a real rebase would be.
  const proposalBRebased = openFiling({ subject: 'concurrent B', rationale: 'concurrent B', existingEvents: kAfterA, eventIdGenerator: testUlid });
  ok(proposalBRebased.payload.instrument_id !== proposalA.payload.instrument_id, 'the loser recomputes against the new tip and gets a DIFFERENT id — no duplicate, no overwrite');
  ok(verifyEventChain([...kAfterA, proposalBRebased], ZERO_ROOT).ok, 'the resulting rebased chain is fully valid end to end');

  // Confirm the safety net: if B's STALE (unrebased) proposal were somehow
  // force-appended anyway (discipline violated, bypassing openFiling()'s
  // own authority-base check), the resulting log has a real duplicate id,
  // which CI ID-uniqueness enforcement independently detects.
  const staleAppendedAnyway = [...kAfterA, proposalB]; // NOTE: proposalB's own hash chain would itself now be broken here too (its prev_event_sha256 no longer matches kAfterA's real tip) — a second, independent line of defense beyond ID uniqueness.
  const dupeIds = staleAppendedAnyway.filter(e => e.type === 'filing-opened').map(e => e.payload.instrument_id);
  const hasDupe = dupeIds.length !== new Set(dupeIds).size;
  ok(hasDupe, 'if the stale proposal were force-appended anyway, CI ID-uniqueness enforcement would detect the resulting duplicate');
  ok(!verifyEventChain(staleAppendedAnyway, ZERO_ROOT).ok, 'AND the force-appended stale proposal independently breaks hash-chain verification — two defenses, not one');
}

console.log('\n=== FIXTURE L: broken base chain ===');
{
  const tamperedBase = JSON.parse(JSON.stringify(log));
  tamperedBase[0].payload.subject = 'TAMPERED';
  let threw = false;
  try { openFiling({ subject: 's', rationale: 'r', existingEvents: tamperedBase, eventIdGenerator: testUlid }); }
  catch (e) { threw = /BROKEN AUTHORITY BASE/.test(e.message); }
  ok(threw, 'openFiling() HARD FAILS before proposing any ID when the supplied base chain is tampered');
}

console.log('\n=== FIXTURE M: duplicate base ID ===');
{
  // Build an internally hash-VALID chain (each link's own hash is correct)
  // that nonetheless contains a duplicate instrument_id across two
  // filing-opened events -- a corrupt authority base despite a clean chain.
  const { buildEvent } = require('./lib/event-hash.js');
  const dupBase = [];
  const ev1 = buildEvent({ event_id: testUlid(), type: 'filing-opened', at: new Date().toISOString(), filing_id: 'FCC-F-000001', payload: { subject: 's1', rationale: 'r1', instrument_id: 'FCC-I-000001' } }, require('./lib/event-hash.js').ZERO_ROOT);
  dupBase.push(ev1);
  const ev2 = buildEvent({ event_id: testUlid(), type: 'filing-opened', at: new Date().toISOString(), filing_id: 'FCC-F-000002', payload: { subject: 's2', rationale: 'r2', instrument_id: 'FCC-I-000001' } }, ev1.event_sha256);
  dupBase.push(ev2);
  let threw = false;
  try { openFiling({ subject: 's3', rationale: 'r3', existingEvents: dupBase, eventIdGenerator: testUlid }); }
  catch (e) { threw = /DUPLICATE instrument_id/.test(e.message); }
  ok(threw, 'openFiling() refuses to mint the next ID when the base contains a duplicate instrument_id, despite a hash-valid chain');
}

console.log('\n=== WORK-BEGIN BOUNDARY GATE (ratified procedure, mechanically tested) ===');
{
  let threw = false;
  try { assertWorkPermitted('FCC-F-000099', log); } catch (e) { threw = /WORK-BEGIN BOUNDARY VIOLATION/.test(e.message); }
  ok(threw, 'assessment-specific work is REFUSED for an unregistered filing_id');
  const permitted = assertWorkPermitted('FCC-F-000001', log);
  ok(permitted === true, 'assessment-specific work is PERMITTED once registration is independently present in the verified chain');
}

console.log(`\n=== FILING LOG BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
