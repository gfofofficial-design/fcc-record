#!/usr/bin/env node
// APPEND-ONLY CORRECTION MECHANISM — REGRESSION FIXTURES A–H.
// Builds throwaway git repos reproducing the .gitkeep incident shape and
// proves the correction excuses exactly one pinned transition and nothing else.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LAW = path.join(__dirname, 'lib', 'append-only-law.js');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-corr-'));
  const sh = (cmd) => execSync(cmd, { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  sh('git init -q'); sh('git config user.email t@t'); sh('git config user.name t');
  return { d, sh };
}
function write(d, rel, content) {
  const p = path.join(d, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function check(d, base, head) {
  // run the real law in the fixture repo's cwd
  return JSON.parse(execSync(
    `node -e "const l=require('${LAW}');console.log(JSON.stringify(l.checkAppendOnlyLaw('${base}','${head}')))"`,
    { cwd: d }
  ).toString().trim());
}
function correctionRecord({ offending, restorative, paths, before, bad, restored, exact = true }) {
  return JSON.stringify({
    artifact_class: 'APPEND_ONLY_HISTORY_CORRECTION_RECORD',
    record_id: 'append-only-correction-fixture',
    offending_commit: offending, restorative_commit: restorative,
    paths, before_blob_sha1: before, bad_blob_sha1: bad, restored_blob_sha1: restored,
    restoration_is_byte_exact_return: exact,
  });
}

// Build the incident shape: P0 pre (LF) -> P1 bad (empty) -> P2 restore (LF) -> P3 record
function buildIncident({ recordMutator = null } = {}) {
  const { d, sh } = repo();
  const gk = ['record/challenges/.gitkeep', 'record/corrections/.gitkeep', 'record/identities/.gitkeep', 'record/instruments/.gitkeep'];
  gk.forEach((p) => write(d, p, '\n'));
  write(d, 'governance/gates/placeholder.json', '{"x":1}');
  sh('git add -A'); sh('git commit -qm P0');
  const P0 = sh('git rev-parse HEAD');
  gk.forEach((p) => write(d, p, ''));
  sh('git add -A'); sh('git commit -qm P1-bad');
  const P1 = sh('git rev-parse HEAD');
  gk.forEach((p) => write(d, p, '\n'));
  sh('git add -A'); sh('git commit -qm P2-restore');
  const P2 = sh('git rev-parse HEAD');
  const before = sh(`git rev-parse ${P0}:${gk[0]}`);
  const bad = sh(`git rev-parse ${P1}:${gk[0]}`);
  let rec = { offending: P1, restorative: P2, paths: gk, before, bad, restored: before };
  if (recordMutator) rec = recordMutator(rec, { P0, P1, P2 });
  write(d, 'governance/gates/append-only-correction-001.json', correctionRecord(rec));
  sh('git add -A'); sh('git commit -qm P3-record');
  const P3 = sh('git rev-parse HEAD');
  return { d, sh, gk, P0, P1, P2, P3, before, bad };
}

// A — known incident + exact restoration + exact approved record => PASS
{
  const { d, P1, P3 } = buildIncident();
  ok(check(d, P1, P3).length === 0, 'A: incident range with exact pinned record => PASS (violation excused)');
}

// G — missing correction artifact => FAIL (same range, head before the record exists)
{
  const { d, P1, P2 } = buildIncident();
  const v = check(d, P1, P2);
  ok(v.length === 4 && v.every((x) => /immutable artifact/.test(x)), 'G: restoration WITHOUT the record => 4 violations (fail-closed)');
}

// B — same paths changed again later => FAIL
{
  const { d, sh, gk, P3 } = buildIncident();
  write(d, gk[0], 'x\n');
  sh('git add -A'); sh('git commit -qm P4-mutate-again');
  const P4 = sh('git rev-parse HEAD');
  ok(check(d, P3, P4).length === 1, 'B1: modifying a restored path after the restorative commit => FAIL');
  ok(check(d, P3.slice(0, 0) || P3, P4).length === 1, 'B2: (same range restated) the record cannot bless any non-pinned transition');
}

// C — different protected path => FAIL
{
  const { d, sh, P3 } = buildIncident();
  write(d, 'record/challenges/other.gitkeep', '');
  sh('git add -A'); sh('git commit -qm add-other');
  write(d, 'record/challenges/other.gitkeep', 'mutated');
  sh('git add -A'); sh('git commit -qm mutate-other');
  const H2 = sh('git rev-parse HEAD');
  ok(check(d, `${H2}~1`, H2).length === 1, 'C: a different protected path is never excused => FAIL');
}

// D — wrong offending SHA => record ignored => FAIL
{
  const { d, P1, P3 } = buildIncident({ recordMutator: (r, { P0 }) => ({ ...r, offending: P0 }) });
  ok(check(d, P1, P3).length === 4, 'D: record pinned to the wrong offending commit is ignored => FAIL');
}

// E — wrong restorative SHA => record ignored => FAIL
{
  const { d, P1, P3 } = buildIncident({ recordMutator: (r, { P1: p1 }) => ({ ...r, restorative: p1 }) });
  ok(check(d, P1, P3).length === 4, 'E: record pinned to the wrong restorative commit is ignored => FAIL');
}

// F — wrong before/restored blob => record ignored => FAIL (also proves new-content can never be blessed)
{
  const { d, P1, P3, bad } = buildIncident({ recordMutator: (r) => ({ ...r, before: r.bad, restored: r.bad }) });
  ok(check(d, P1, P3).length === 4, 'F1: record whose blobs do not match real history is ignored => FAIL');
  const { d: d2, P1: q1, P3: q3 } = buildIncident({ recordMutator: (r) => ({ ...r, restored: bad }) });
  ok(check(d2, q1, q3).length === 4, 'F2: before != restored (non-byte-exact "restoration") is structurally rejected => FAIL');
}

// H — correction artifact mutation => FAIL
{
  const { d, sh, P3 } = buildIncident();
  write(d, 'governance/gates/append-only-correction-001.json', '{"tampered":true}');
  sh('git add -A'); sh('git commit -qm tamper-record');
  const P5 = sh('git rev-parse HEAD');
  const v = check(d, P3, P5);
  ok(v.length === 1 && /append-only-correction-001/.test(v[0]), 'H: mutating the correction record is itself a violation => FAIL');
}

// Real-repo grounding: the shipped record verifies against actual public history.
// Runs only where that history exists (the real repo / CI checkout); a clean-room
// archive without the public commits skips it — the record simply grounds to
// nothing there, which is the fail-closed behavior fixtures D/E already prove.
{
  const lib = require(LAW);
  let hasHistory = true;
  try { execSync('git cat-file -e ca192cf4fe84353b978d19ddfc44131e1a7bcbe6^{commit}', { stdio: 'ignore' }); }
  catch (e) { hasHistory = false; }
  if (!hasHistory) { console.log('SKIP R1-R3: public incident commits not present in this checkout'); }
  else {
  const recs = lib.loadVerifiedCorrectionRecords('HEAD');
  ok(recs.length === 1 && recs[0].offending_commit === 'ca192cf4fe84353b978d19ddfc44131e1a7bcbe6', 'R1: shipped record loads and grounds against real public history');
  const excused = lib.correctionExcuses(recs, 'record/challenges/.gitkeep', 'ca192cf4fe84353b978d19ddfc44131e1a7bcbe6', 'b66c41814d3883950084a5549c48b8b9a472c19d');
  ok(excused === true, 'R2: the exact public incident range is excused');
  const notExcused = lib.correctionExcuses(recs, 'record/challenges/.gitkeep', 'b66c41814d3883950084a5549c48b8b9a472c19d', 'HEAD');
  ok(notExcused === false, 'R3: any transition not ending at the pinned bad->restored pair is not excused');
  }
}

console.log(`\nAPPEND-ONLY CORRECTION SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
