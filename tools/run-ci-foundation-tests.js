#!/usr/bin/env node
// FCC BUILD 01 — FOUNDATION TEST RUNNER (npm test entrypoint)
//
// GIT-HISTORY ISOLATION INVARIANT (BUILD 01.2 item 2): every adversarial
// Git-history test runs inside a throwaway CLONE of this repository in a
// temp directory. The caller's actual HEAD, branch, and working-tree state
// are captured before any test runs and re-verified identical after every
// test completes — this run fails loudly if they ever diverge. No fixture
// commit, branch, tag, or FCC-TEST-* object is ever created in the real
// repository by this script.
const { execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { checkAppendOnlyLaw, verifyNdjsonAppend } = require('./lib/append-only-law.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; };
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' }).toString();

// ── Capture caller repo state BEFORE anything runs ──
const REPO_ROOT = process.cwd();
const origHead = sh('git rev-parse HEAD', REPO_ROOT).trim();
const origBranch = sh('git rev-parse --abbrev-ref HEAD', REPO_ROOT).trim();
const origStatus = sh('git status --porcelain', REPO_ROOT).trim();
const origRefs = sh('git for-each-ref --format="%(refname)"', REPO_ROOT).trim();

console.log('=== 1. Frozen document hash verification ===');
try { execSync('node tools/verify-frozen-hashes.js', { stdio: 'inherit' }); ok(true, 'frozen hashes'); }
catch { ok(false, 'frozen hashes'); }

console.log('\n=== 2. Byte preservation (blob-vs-manifest-vs-checkout) ===');
try { execSync('node tools/verify-byte-preservation.js', { stdio: 'inherit' }); ok(true, 'byte preservation'); }
catch { ok(false, 'byte preservation'); }

console.log('\n=== 3. Byte-exact manifest completeness ===');
try { execSync('node tools/verify-byte-manifest-completeness.js', { stdio: 'inherit' }); ok(true, 'manifest completeness'); }
catch { ok(false, 'manifest completeness'); }

console.log('\n=== 4. Schema validation foundation ===');
try { execSync('node tools/verify-schemas.js', { stdio: 'inherit' }); ok(true, 'schema foundation'); }
catch { ok(false, 'schema foundation'); }

console.log('\n=== 5. Secret scan — current tree ===');
try { execSync('node tools/secret-scan.js', { stdio: 'inherit' }); ok(true, 'secret scan (current tree) clean-pass'); }
catch { ok(false, 'secret scan (current tree) clean-pass'); }

console.log('\n=== 6. Secret scan — full reachable history ===');
try { execSync('node tools/secret-scan.js --history', { stdio: 'inherit' }); ok(true, 'secret scan (full history) clean-pass'); }
catch { ok(false, 'secret scan (full history) clean-pass'); }

console.log('\n=== 7. ID uniqueness (clean record) ===');
try { execSync('node tools/verify-id-uniqueness.js', { stdio: 'inherit' }); ok(true, 'id uniqueness clean-pass'); }
catch { ok(false, 'id uniqueness clean-pass'); }

console.log('\n=== 8. Test-namespace quarantine (clean record) ===');
try { execSync('node tools/verify-test-quarantine.js', { stdio: 'inherit' }); ok(true, 'quarantine clean-pass'); }
catch { ok(false, 'quarantine clean-pass'); }

console.log('\n=== 9. Append-only law — adversarial battery (ISOLATED CLONE) ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-adv-test-'));
const clone = path.join(tmp, 'repo');
sh(`git clone -q "${REPO_ROOT}" "${clone}"`);
const cloneBranch = sh('git rev-parse --abbrev-ref HEAD', clone).trim();
if (cloneBranch !== 'main') sh(`git checkout -q -b main`, clone);
sh(`git config user.email adv-test@isolated.local`, clone);
sh(`git config user.name "Isolated Adversarial Test"`, clone);


function withBranch(name, setupFn) {
  sh(`git checkout -q -b ${name}`, clone);
  let v;
  try { v = setupFn(); }
  finally { sh(`git checkout -q main`, clone); sh(`git branch -D ${name} -q`, clone); }
  return v;
}
function w(p, content) { fs.mkdirSync(path.dirname(path.join(clone, p)), { recursive: true }); fs.writeFileSync(path.join(clone, p), content); }
function commit(msg) { sh(`git add -A && git commit -q -m "${msg}"`, clone); }
function checkRange(base, head) { return checkAppendOnlyLaw.toString ? require('./lib/append-only-law.js').checkAppendOnlyLaw(base, head) : []; }
// checkAppendOnlyLaw uses `git` relative to CWD — run it with cwd=clone via a small wrapper:
const checkerScriptPath = path.join(tmp, 'checker.js');
fs.writeFileSync(checkerScriptPath, `
const { checkAppendOnlyLaw } = require(${JSON.stringify(path.join(REPO_ROOT, 'tools/lib/append-only-law.js'))});
const [,, base, head] = process.argv;
console.log(JSON.stringify(checkAppendOnlyLaw(base, head)));
`);
function checkInClone(base, head) {
  const out = execSync(`node "${checkerScriptPath}" "${base}" "${head}"`, { cwd: clone, encoding: 'utf8' });
  return JSON.parse(out.trim());
}

// -- immutable artifacts: locked.json --
w('record/instruments/FCC-TEST-000001/locked.json', '{"fixture":"a"}\n'); commit('fixture: locked.json');
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-locked-modify', () => { w('record/instruments/FCC-TEST-000001/locked.json', '{"fixture":"TAMPERED"}\n'); commit('attack'); return checkInClone(base, 'adv-locked-modify'); });
  ok(v.length > 0, 'immutable: modifying existing locked.json REJECTED');
  v = withBranch('adv-locked-delete', () => { sh('git rm -q record/instruments/FCC-TEST-000001/locked.json', clone); commit('attack'); return checkInClone(base, 'adv-locked-delete'); });
  ok(v.length > 0, 'immutable: deleting existing locked.json REJECTED');
}

// -- immutable: annex --
w('record/instruments/FCC-TEST-000001/annex-01.json', '{"annex":"a"}\n'); commit('fixture: annex');
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-annex-modify', () => { w('record/instruments/FCC-TEST-000001/annex-01.json', '{"annex":"TAMPERED"}\n'); commit('attack'); return checkInClone(base, 'adv-annex-modify'); });
  ok(v.length > 0, 'immutable: modifying existing annex REJECTED');
  v = withBranch('adv-annex-delete', () => { sh('git rm -q record/instruments/FCC-TEST-000001/annex-01.json', clone); commit('attack'); return checkInClone(base, 'adv-annex-delete'); });
  ok(v.length > 0, 'immutable: deleting existing annex REJECTED');
}

// -- immutable: OTS proof --
w('record/instruments/FCC-TEST-000001/proof.ots', Buffer.from([0,0x4f,0x54,0x53]).toString('binary')); commit('fixture: ots');
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-ots-modify', () => { w('record/instruments/FCC-TEST-000001/proof.ots', 'TAMPERED'); commit('attack'); return checkInClone(base, 'adv-ots-modify'); });
  ok(v.length > 0, 'immutable: modifying existing OTS proof REJECTED');
  v = withBranch('adv-ots-delete', () => { sh('git rm -q record/instruments/FCC-TEST-000001/proof.ots', clone); commit('attack'); return checkInClone(base, 'adv-ots-delete'); });
  ok(v.length > 0, 'immutable: deleting existing OTS proof REJECTED');
}

// -- NDJSON append-only law, all 6 required scenarios --
w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n{"line":2}\n'); commit('fixture: ndjson base');
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-ndjson-append1', () => { w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n{"line":2}\n{"line":3}\n'); commit('legit: one-line append'); return checkInClone(base, 'adv-ndjson-append1'); });
  ok(v.length === 0, 'ndjson: legitimate ONE-LINE append ALLOWED');

  v = withBranch('adv-ndjson-appendN', () => { w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n{"line":2}\n{"line":3}\n{"line":4}\n'); commit('legit: multi-line append'); return checkInClone(base, 'adv-ndjson-appendN'); });
  ok(v.length === 0, 'ndjson: legitimate MULTI-LINE append ALLOWED');

  v = withBranch('adv-ndjson-rewrite', () => { w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n{"line":"REWRITTEN"}\n'); commit('attack: rewrite old line'); return checkInClone(base, 'adv-ndjson-rewrite'); });
  ok(v.length > 0, 'ndjson: OLD-LINE REWRITE REJECTED');

  v = withBranch('adv-ndjson-insert', () => { w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n{"line":"INSERTED"}\n{"line":2}\n'); commit('attack: insert between old lines'); return checkInClone(base, 'adv-ndjson-insert'); });
  ok(v.length > 0, 'ndjson: INSERTION BETWEEN OLD LINES REJECTED');

  v = withBranch('adv-ndjson-truncate', () => { w('record/filing-log/FCC-TEST-log.ndjson', '{"line":1}\n'); commit('attack: truncate'); return checkInClone(base, 'adv-ndjson-truncate'); });
  ok(v.length > 0, 'ndjson: TRUNCATION REJECTED');

  v = withBranch('adv-ndjson-delete', () => { sh('git rm -q record/filing-log/FCC-TEST-log.ndjson', clone); commit('attack: delete file'); return checkInClone(base, 'adv-ndjson-delete'); });
  ok(v.length > 0, 'ndjson: FILE DELETION REJECTED');
}

// -- pure addition of a new record remains allowed --
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-pure-append', () => { w('record/instruments/FCC-TEST-000002/locked.json', '{"fixture":"new"}\n'); commit('legit: new record addition'); return checkInClone(base, 'adv-pure-append'); });
  ok(v.length === 0, 'addition: pure addition of a NEW record ALLOWED');
}

// -- new key version can be added without touching the old one --
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-key-add', () => { w('governance/keys/key-v1.pub.pem', '-----BEGIN PUBLIC KEY-----\nFIXTURE\n-----END PUBLIC KEY-----\n'); commit('legit: new key version'); return checkInClone(base, 'adv-key-add'); });
  ok(v.length === 0, 'addition: new key version without touching old key ALLOWED');
}

// -- frozen governance document modification rejected --
{
  let base = sh('git rev-parse HEAD', clone).trim();
  let v = withBranch('adv-frozen-modify', () => { fs.appendFileSync(path.join(clone, 'governance/frozen/FCC_CAPITAL_DOCTRINE_V0_1_1.md'), '\nTAMPERED\n'); commit('attack: modify frozen doc'); return checkInClone(base, 'adv-frozen-modify'); });
  ok(v.length > 0, 'immutable: modifying a frozen governance document REJECTED');
}

// -- manifest completeness adversarial: unregistered byte-exact artifact --
{
  w('record/instruments/FCC-TEST-000003/locked.json', '{"unregistered":true}\n');
  commit('fixture: unregistered locked.json for completeness test');
  let out = 0;
  try { sh('node ' + JSON.stringify(path.join(REPO_ROOT, 'tools/verify-byte-manifest-completeness.js')), clone); }
  catch (e) { out = e.status || 1; }
  ok(out !== 0, 'manifest completeness: unregistered byte-exact artifact is DETECTED (CI would fail)');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n=== 10. BUILD 02 — canonicalization + lock-candidate pipeline battery ===');
try { execSync('node tools/run-build02-tests.js', { stdio: 'inherit' }); ok(true, 'BUILD 02 fixture battery (A-F + duplicate-id + quarantine)'); }
catch { ok(false, 'BUILD 02 fixture battery (A-F + duplicate-id + quarantine)'); }

console.log('\n=== 11. Filing Log foundation battery ===');
try { execSync('node tools/run-filing-log-tests.js', { stdio: 'inherit' }); ok(true, 'Filing Log battery (A-K incl. concurrency/collision)'); }
catch { ok(false, 'Filing Log battery (A-K incl. concurrency/collision)'); }

console.log('\n=== 12. Epoch 2 execution infrastructure (pinned, no network) ===');
try { execSync('node tools/run-epoch2-execution-infrastructure-tests.js', { stdio: 'inherit' }); ok(true, 'Epoch 2 schema/selection/write-once/completion battery'); }
catch { ok(false, 'Epoch 2 schema/selection/write-once/completion battery'); }

console.log('\n=== 13. Epoch 2 C1-C3 rerun persistence and gate (no network) ===');
try { execSync('node tools/run-epoch2-shortage-result-tests.js', { stdio: 'inherit' }); execSync('node tools/run-epoch2-rerun-integration-tests.js', { stdio: 'inherit' }); ok(true, 'Epoch 2 rerun success/shortage/write-once/gate battery'); }
catch { ok(false, 'Epoch 2 rerun success/shortage/write-once/gate battery'); }

console.log('\n=== 14. GIT HISTORY / WORKTREE IMMUTABILITY PROOF (caller repo) ===');
const newHead = sh('git rev-parse HEAD', REPO_ROOT).trim();
const newBranch = sh('git rev-parse --abbrev-ref HEAD', REPO_ROOT).trim();
const newStatus = sh('git status --porcelain', REPO_ROOT).trim();
const newRefs = sh('git for-each-ref --format="%(refname)"', REPO_ROOT).trim();
ok(newHead === origHead, `caller HEAD unchanged (${origHead.slice(0,8)})`);
ok(newBranch === origBranch, `caller branch unchanged (${origBranch})`);
ok(newStatus === origStatus, 'caller working-tree status unchanged');
ok(newRefs === origRefs, 'caller ref list unchanged (no stray branches/tags left behind)');

console.log(`\n=== FOUNDATION TEST BATTERY: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
