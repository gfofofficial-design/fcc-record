#!/usr/bin/env node
// BUILD 02.1: proves a REAL lock-run-produced complete body is byte-for-
// byte immutable once admitted into a test permanent-record fixture --
// integration between the actual LOCK RUN output and the BUILD 01.2
// append-only guard. Runs entirely in an isolated clone with a test-format
// instrument id; never touches the real record/.
const { execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { prepareLockRun } = require('./lock-run.js');

function sh(cmd, cwd) { return execSync(cmd, { cwd, stdio: 'pipe' }).toString(); }

const REPO_ROOT = path.resolve(__dirname, '..');
const semantic = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests/fixtures/fixtureA-prelock.json'), 'utf8'));
const run = prepareLockRun({ prelockSemanticBody: semantic, authoritativeInstrumentId: 'FCC-I-000097' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-immut-test-'));
const clone = path.join(tmp, 'repo');
sh(`git clone -q "${REPO_ROOT}" "${clone}"`);
sh('git config user.email t@t && git config user.name T', clone);

const instrumentDir = path.join(clone, 'record/instruments/FCC-I-000097');
fs.mkdirSync(instrumentDir, { recursive: true });
fs.writeFileSync(path.join(instrumentDir, 'locked.json'), run.canonical_bytes);
sh('git add -A && git commit -q -m "fixture: admit real lock-run-produced complete body"', clone);
const base = sh('git rev-parse HEAD', clone).trim();

sh('git checkout -q -b attack', clone);
fs.writeFileSync(path.join(instrumentDir, 'locked.json'), Buffer.concat([run.canonical_bytes, Buffer.from('TAMPERED')]));
sh('git add -A && git commit -q -m "attack: mutate the admitted locked.json"', clone);

const checkerScript = path.join(tmp, 'checker.js');
fs.writeFileSync(checkerScript, `
const { checkAppendOnlyLaw } = require(${JSON.stringify(path.join(REPO_ROOT, 'tools/lib/append-only-law.js'))});
console.log(JSON.stringify(checkAppendOnlyLaw(${JSON.stringify(base)}, 'attack')));
`);
const violations = JSON.parse(sh(`node "${checkerScript}"`, clone));
fs.rmSync(tmp, { recursive: true, force: true });

if (violations.length === 0) { console.error('FAIL: mutation of a real lock-run-produced body was NOT rejected'); process.exit(1); }
console.log('PASS: real lock-run-produced complete body, once admitted, is byte-for-byte immutable — mutation rejected:', violations[0]);
