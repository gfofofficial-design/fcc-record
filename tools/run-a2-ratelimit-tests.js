#!/usr/bin/env node
// A2 TALLY RATE-LIMIT / RESUME — tests A–R (no network; injected fetch + fake clock).
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { execSync } = require('child_process');
const D = require('./diagnose-a1a2-scope.js');
const resume = require('./lib/discovery-resume.js');
const ROOT = path.join(__dirname, '..');
const SLATE = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const slateBefore = sha(SLATE);
const govBefore = execSync('git status --porcelain governance/', { cwd: ROOT }).toString();
let passed = 0, failed = 0; const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };
const res = (statusCode, body, headers = {}) => ({ ok: true, statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

let fakeNow = 1e12; const sleeps = [];
D.setTiming({ sleep: async (ms) => { sleeps.push(ms); fakeNow += ms; }, now: () => fakeNow });
const tmpRoot = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-rl-')); execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m pin', { cwd: d }); return d; };
const KEY = 'test-only-placeholder-key';

// Tally world fixture: 3 orgs (one doctrine-excluded), governors with totals, proposals per governor
const orgs = [{ id: '1', name: 'Alpha', slug: 'alpha', governorIds: ['eip155:1:0x' + '1'.repeat(40)], proposalsCount: 300 }, { id: '2', name: 'Beta', slug: 'beta', governorIds: ['eip155:10:0x' + '2'.repeat(40), 'eip155:10:0x' + '3'.repeat(40)], proposalsCount: 200 }, { id: '3', name: 'Dossier Labs', slug: 'dossier', governorIds: ['eip155:1:0x' + '9'.repeat(40)], proposalsCount: 999 }];
const totals = { '1': 300, '2': 150, '3': 50 };
function world({ failAt = null, failStatus = 429, failHeaders = {}, failCount = Infinity } = {}) {
  let inFlight = 0, maxInFlight = 0, calls = 0, fails = 0;
  const fetch = async (req) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); calls++;
    try {
      if (req.headers['Api-Key'] !== KEY) return res(401, {});
      const b = JSON.parse(req.body);
      if (failAt && failAt(b, calls) && fails < failCount) { fails++; return res(failStatus, { errors: [{ message: 'x' }] }, failHeaders); }
      if (/organizations\(/.test(b.query)) { const after = b.variables.input && b.variables.input.page ? b.variables.input.page.afterCursor : null; return res(200, { data: { organizations: { nodes: after ? [orgs[2]] : orgs.slice(0, 2), pageInfo: { lastCursor: after ? null : 'c1' } } } }); }
      if (/governor\(/.test(b.query)) { const id = b.variables.input.id; const k = id.slice(-40)[0]; return res(200, { data: { governor: { id, name: 'G' + k, chainId: id.split(':').slice(0, 2).join(':'), isIndexing: true, proposalStats: { total: totals[k], active: 0 } } } }); }
      return res(422, { errors: [{ message: 'validation' }] });
    } finally { inFlight--; }
  };
  return { fetch, stats: () => ({ maxInFlight, calls }) };
}

(async () => {
  process.env.TALLY_API_KEY = KEY;
  // A/B — serialization + pacing
  { const w = world(); D.setFetch(w.fetch); sleeps.length = 0; D.setResumeRoot(tmpRoot());
    const [a, b] = await Promise.all([D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY }), D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY })]);
    ok(!a.error && !b.error && w.stats().maxInFlight === 1, 'A: concurrent Tally calls are serialized — never more than one in flight');
    ok(sleeps.some((ms) => ms > 0 && ms <= D.TALLY_MIN_INTERVAL_MS) && D.tallyLog.some((e) => e.kind === 'pace'), `B: a pacing gap (<= ${D.TALLY_MIN_INTERVAL_MS}ms) is enforced between consecutive Tally requests`); }
  // C — Retry-After seconds honored
  { sleeps.length = 0; const w = world({ failAt: (b, n) => n === 1, failHeaders: { 'retry-after': '7' }, failCount: 1 }); D.setFetch(w.fetch);
    const r = await D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY });
    ok(!r.error && sleeps.includes(7000), 'C: Retry-After: 7 => waited exactly 7000ms then succeeded'); }
  // D — Retry-After HTTP-date honored (capped)
  { sleeps.length = 0; const target = fakeNow + 20000; const date = new Date(target).toUTCString(); const w = world({ failAt: (b, n) => n === 1, failHeaders: { 'retry-after': date }, failCount: 1 }); D.setFetch(w.fetch);
    const r = await D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY });
    // the pacing gap runs first and the date has 1s granularity, so the wait is (target - now-at-parse) within [~17.9s, 20s]
    ok(!r.error && sleeps.some((ms) => ms >= 17000 && ms <= 20000) && !D.TALLY_BACKOFF_MS.some((b) => sleeps.includes(b)), 'D: Retry-After HTTP-date => waited until that instant (not the backoff ladder)');
    ok(D.parseRetryAfter('99999', fakeNow) === D.RETRY_AFTER_MAX_MS && D.parseRetryAfter('garbage', fakeNow) === null, `D2: Retry-After capped at ${D.RETRY_AFTER_MAX_MS}ms; unparseable header falls back to the ladder`); }
  // E — no header => deterministic ladder
  { sleeps.length = 0; const w = world({ failAt: (b, n) => n <= 3, failCount: 3 }); D.setFetch(w.fetch);
    const r = await D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY });
    const waits = sleeps.filter((ms) => D.TALLY_BACKOFF_MS.includes(ms));
    ok(!r.error && JSON.stringify(waits.slice(0, 3)) === JSON.stringify([1000, 2000, 4000]), 'E: three bare 429s => 1s -> 2s -> 4s, no jitter'); }
  // F — retry ceiling terminates honestly
  { sleeps.length = 0; const w = world({ failAt: () => true }); D.setFetch(w.fetch);
    const r = await D.tallyGql('query{organizations(input:{}){nodes{... on Organization{id}}}}', {}, { 'Api-Key': KEY });
    ok(r.error && r.error.state === D.DIAG_RATE_LIMITED && /5 bounded retries/.test(r.error.detail), `F: persistent 429 => ${D.DIAG_RATE_LIMITED} after exactly ${D.TALLY_MAX_RETRIES} retries, distinct from FAIL/CREDENTIAL/drift`);
    ok(sleeps.filter((ms) => D.TALLY_BACKOFF_MS.includes(ms)).length === D.TALLY_MAX_RETRIES, 'F2: the ladder is walked exactly once to the ceiling'); }
  // G/H — other statuses unchanged
  { D.setFetch(async () => res(401, {})); const g = await D.tallyGql('q', {}, {}); ok(g.error && g.error.state === 'CREDENTIAL_REQUIRED', 'G: 401 remains credential failure');
    D.setFetch(async () => res(422, { errors: [] })); const h = await D.tallyGql('q', {}, {}); ok(h.error && h.error.state === 'SOURCE_INTERFACE_DRIFT', 'H: 422 remains interface drift'); }
  // I/J/K — full a2Universe with resume: no key anywhere, pins present
  { const root = tmpRoot(); D.setResumeRoot(root); const w = world(); D.setFetch(w.fetch);
    const u = await D.a2Universe();
    ok(!u.error && u.govs.length === 3 && u.govs[0].proposalStats.total === 300, 'I0: paced universe completes with the same ordering as before');
    const rf = fs.readFileSync(resume.resumePath(root), 'utf8');
    ok(!rf.includes(KEY) && !/api-?key|authorization/i.test(rf), 'I/J: resume state contains neither the key nor any header');
    ok(!JSON.stringify(u).includes(KEY) && !JSON.stringify(D.tallyLog).includes(KEY), 'I2: key never appears in results or transport log');
    const st = JSON.parse(rf);
    ok(st.pins.publicHead && st.pins.N === 25 && st.pins.ACTIVITY_DAYS === 90 && st.pins.cutoff === '2026-08-31T00:00:00.000Z' && st.pins.ruleTag === D.RULE_TAG, 'K: resume pins public HEAD, N, 90d, cutoff, and rule tag');
    ok(st.not_governance_evidence === true && /LOCAL_ONLY/.test(st.artifact_class), 'K2: resume state is labeled operational, not governance evidence');
    // L — changed pins reject resume
    st.pins.N = 30; fs.writeFileSync(resume.resumePath(root), JSON.stringify(st));
    const r2 = await D.a2Universe(); ok(r2.error && r2.error.state === 'RESUME_REFUSED' && /pins differ: N/.test(r2.error.detail), 'L: changed pin (N) => resume refused, nothing silently continued');
    let threw = false; try { resume.save(root, st.pins, { 'Api-Key': 'x' }); } catch (e) { threw = /forbidden key/.test(e.message); } ok(threw, 'J2: store refuses any state carrying a header-like key'); }
  // M — interrupted run (rate-limit ceiling mid-enumeration) then resume => same governor order
  { const root = tmpRoot(); D.setResumeRoot(root);
    const w1 = world({ failAt: (b) => /governor\(/.test(b.query) }); D.setFetch(w1.fetch);
    const first = await D.a2Universe();
    ok(first.error && first.error.state === D.DIAG_RATE_LIMITED && first.resumable === true, 'M1: run interrupted by rate limit during governor phase, checkpoint saved');
    const w2 = world(); D.setFetch(w2.fetch);
    const resumed = await D.a2Universe();
    D.setResumeRoot(tmpRoot()); const straight = await D.a2Universe();
    ok(!resumed.error && resumed.resumedFrom === 'govs' && JSON.stringify(resumed.govs.map((g) => g.id)) === JSON.stringify(straight.govs.map((g) => g.id)), 'M: resumed run yields the identical governor order as an uninterrupted run');
    ok(w2.stats().calls < w1.stats().calls + 10 && !resumed.govs.some((g) => /9{40}/.test(g.id)), 'M2: resume skips completed organization pages; doctrine exclusion still applied'); }
  // N/O/P/Q/R
  ok(D.N === 25, 'N: N=25 unchanged'); ok(D.ACTIVITY_DAYS === 90, 'O: 90-day activity unchanged');
  { const src = fs.readFileSync(path.join(__dirname, 'diagnose-a1a2-scope.js'), 'utf8').replace(/\/\/.*$/gm, '');
    ok(!/writeFileSync|appendFileSync|createWriteStream/.test(src), 'P1: the diagnostic itself still has no write calls (resume I/O lives in the path-guarded store)');
    const storeSrc = fs.readFileSync(path.join(__dirname, 'lib', 'discovery-resume.js'), 'utf8');
    ok(/LOCAL_DIR = '\.fcc-local'/.test(storeSrc) && /refused: target outside/.test(storeSrc) && /\.fcc-local\//.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')), 'P2: store writes only under .fcc-local/, which is gitignored');
    ok(execSync('git status --porcelain governance/', { cwd: ROOT }).toString() === govBefore, 'P3: no governance/slate/addenda path changed during this suite');
    const headSrc = execSync('git show HEAD:tools/diagnose-a1a2-scope.js', { cwd: ROOT }).toString();
    const grab = (s) => { const i = s.indexOf('async function a1Universe'); const j = s.indexOf('// ── A2 universe'); return s.slice(i, j); };
    ok(grab(headSrc) === grab(fs.readFileSync(path.join(__dirname, 'diagnose-a1a2-scope.js'), 'utf8')), 'Q: Snapshot (A1) universe code is byte-identical to the committed HEAD version'); }
  ok(sha(SLATE) === slateBefore, 'R: candidate-slate hash unchanged');
  delete process.env.TALLY_API_KEY;
  console.log(`\nA2 RATE-LIMIT / RESUME SUITE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
