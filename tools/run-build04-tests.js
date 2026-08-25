#!/usr/bin/env node
// BUILD 04 — FIXTURE BATTERY. Proves the Experiment Freeze artifact is
// mechanically enforced, not merely documented.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { checkAppendOnlyLaw } = require('./lib/append-only-law.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };

const ROOT = path.join(__dirname, '..');
const FREEZE_DIR_REL = 'governance/experiments/stage0-public-experiment-v1';
const FREEZE_DIR = path.join(ROOT, FREEZE_DIR_REL);

console.log('=== FIXTURE Q — append-only law now protects governance/experiments/ (AD-E3) ===');
{
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-build04-q-'));
  const sh = (c, cwd) => execSync(c, { cwd, stdio: 'pipe' }).toString();
  sh('git init -q -b main repo', clone);
  const repo = path.join(clone, 'repo');
  sh('git config user.email t@t && git config user.name t', repo);
  fs.mkdirSync(path.join(repo, FREEZE_DIR_REL), { recursive: true });
  fs.writeFileSync(path.join(repo, FREEZE_DIR_REL, 'experiment-freeze.json'), JSON.stringify({ freeze_status: 'BLOCKED' }));
  sh('git add -A && git commit -qm genesis', repo);
  // legitimate ADDITION of a new file (a distinct real-world candidate list once ratified) must be allowed
  fs.writeFileSync(path.join(repo, FREEZE_DIR_REL, 'new-annex.json'), JSON.stringify({ ok: true }));
  sh('git add -A && git commit -qm "add annex"', repo);
  const prevCwd = process.cwd();
  process.chdir(repo);
  let additionViolations; try { additionViolations = checkAppendOnlyLaw('HEAD~1', 'HEAD'); } finally { process.chdir(prevCwd); }
  ok(additionViolations.length === 0, 'Q1: adding a NEW file under governance/experiments/ is permitted (pure addition)');
  // MUTATION of the already-committed freeze file must be rejected
  fs.writeFileSync(path.join(repo, FREEZE_DIR_REL, 'experiment-freeze.json'), JSON.stringify({ freeze_status: 'VALID' }));
  sh('git add -A && git commit -qm tamper', repo);
  process.chdir(repo);
  let mutationViolations; try { mutationViolations = checkAppendOnlyLaw('HEAD~1', 'HEAD'); } finally { process.chdir(prevCwd); }
  ok(mutationViolations.length > 0 && mutationViolations.some((v) => v.includes('experiment-freeze.json') && v.includes('MODIFY')), 'Q2: mutating the committed freeze artifact is REJECTED by the append-only guard');
  fs.rmSync(clone, { recursive: true, force: true });
}

console.log('\n=== FIXTURE R — verify-experiment-freeze.js runs clean against the real artifact ===');
{
  let out, code;
  try { out = execSync('node tools/verify-experiment-freeze.js', { cwd: ROOT, stdio: 'pipe' }).toString(); code = 0; }
  catch (e) { out = (e.stdout || '').toString(); code = e.status; }
  ok(code === 0, 'R1: verify-experiment-freeze.js exits 0');
  ok(out.includes('EXPERIMENT FREEZE VERIFICATION: PASS'), 'R2: verifier reports PASS');
  ok(!/FAIL /.test(out), 'R3: zero FAIL lines in verifier output');
}

console.log('\n=== FIXTURE S — the freeze artifact never mints or references an FCC-I-* identifier ===');
{
  const files = fs.readdirSync(FREEZE_DIR).filter((f) => fs.statSync(path.join(FREEZE_DIR, f)).isFile());
  let found = false;
  for (const f of files) if (/FCC-I-\d{6}/.test(fs.readFileSync(path.join(FREEZE_DIR, f), 'utf8'))) found = true;
  ok(!found, 'S1: no FCC-I-* pattern anywhere in the delivered freeze directory');
  const freeze = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'experiment-freeze.json'), 'utf8'));
  ok(freeze.instrument_id === null, 'S2: instrument_id is explicitly null');
}

console.log('\n=== FIXTURE T — candidate slate honesty: no fabricated real-world claims ===');
{
  const slate = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'candidate-slate.json'), 'utf8'));
  ok(slate.slots.length === 15, 'T1: exactly 15 slots');
  const allPlaceholder = slate.slots.every((s) => s.status === 'AWAITING_CANDIDATE_SELECTION' && s.subject === null && s.primary_source === null && s.evaluation_procedure === null);
  ok(allPlaceholder, 'T2: every slot is an honest placeholder -- zero fabricated subjects, sources, or evaluation procedures');
  ok(slate.fabrication_prohibited === true, 'T3: slate self-declares fabrication_prohibited');
}

console.log('\n=== FIXTURE U — no calendar dates invented ===');
{
  const freeze = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'experiment-freeze.json'), 'utf8'));
  ok(freeze.experiment_dates.start_utc === null && freeze.experiment_dates.end_utc === null, 'U1: both dates remain null');
  ok(freeze.experiment_dates.status === 'PENDING_FROZEN_IMMEDIATELY_BEFORE_LAUNCH', 'U2: status honestly reports PENDING, not FROZEN');
}

console.log('\n=== FIXTURE V — full prior regression suites still green after this build ===');
{
  const suites = [
    ['node tools/run-ci-foundation-tests.js', 'FOUNDATION TEST BATTERY'],
    ['node tools/run-build02-tests.js', 'BUILD 02.1 BATTERY'],
    ['node tools/run-filing-log-tests.js', 'FILING LOG BATTERY'],
    ['node tools/run-build03-tests.js', 'BUILD 03 BATTERY'],
  ];
  for (const [cmd, label] of suites) {
    let out, code;
    try { out = execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString(); code = 0; }
    catch (e) { out = (e.stdout || '').toString(); code = e.status; }
    ok(code === 0 && new RegExp(`${label}: \\d+ passed, 0 failed`).test(out), `V: ${label} still 0 failures`);
  }
}

console.log(`\n=== BUILD 04 FIXTURE BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
