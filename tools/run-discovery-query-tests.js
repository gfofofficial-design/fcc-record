#!/usr/bin/env node
// A1/A2 DISCOVERY QUERY ADJUDICATION — tests A–L (no network; injected fetch).
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const D = require('./diagnose-a1a2-scope.js');
const ROOT = path.join(__dirname, '..');
const SLATE = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before = sha(SLATE);
let passed = 0, failed = 0; const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };
const res = (statusCode, body, headers = {}) => ({ ok: true, statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const space = (i, extra = {}) => ({ id: `space${i}.eth`, name: `Space ${i}`, verified: true, turbo: false, hibernated: false, flagged: false, proposalsCount: 1000 - i, followersCount: 10, activeProposals: 0, ...extra });

(async () => {
  // A — valid current Snapshot universe response parses (two pages of 20, then a short page)
  { const calls = [];
    D.setFetch(async (req) => { const v = JSON.parse(req.body).variables; calls.push(v); const n = v.skip === 0 ? 20 : 5; return res(200, { data: { ranking: { items: Array.from({ length: n }, (_, k) => space(v.skip + k)) } } }); });
    const u = await D.a1Universe();
    ok(!u.error && u.items.length === 25 && u.exhausted === true && u.curationFlagsAvailable === true, 'A: valid ranking response parses across pages to exhaustion');
    ok(calls.every((v) => v.first === 20) && calls[1].skip === 20, 'A2: every ranking request uses first=20 (the hub hard limit) and skip pagination'); }
  // B — unsupported-field fallback is deterministic
  { const run = async () => { let n = 0; D.setFetch(async (req) => { n++; if (/hibernated/.test(req.body)) return res(400, { errors: [{ message: 'Cannot query field "hibernated"' }] }); return res(200, { data: { ranking: { items: Array.from({ length: 3 }, (_, k) => ({ id: `s${k}.eth`, name: 's', verified: true, proposalsCount: 5, followersCount: 1, activeProposals: 0 })) } } }); }); return D.a1Universe(); };
    const r1 = await run(), r2 = await run();
    ok(!r1.error && r1.curationFlagsAvailable === false && r1.items.length === 3 && JSON.stringify(r1) === JSON.stringify(r2), 'B: hibernated/flagged unsupported => disclosed verified+activity fallback, deterministic'); }
  // C — Snapshot schema/server failure surfaced honestly
  { D.setFetch(async () => res(500, 'Unexpected error')); const u = await D.a1Universe(); ok(u.error && u.error.state === 'FAIL' && /500/.test(u.error.detail), 'C1: HTTP 500 surfaced as FAIL with the status, never hidden');
    D.setFetch(async () => res(200, { data: { ranking: { items: [{ nope: 1 }] } } })); const u2 = await D.a1Universe(); ok(u2.error && u2.error.state === 'SOURCE_INTERFACE_DRIFT', 'C2: malformed ranking item surfaced as SOURCE_INTERFACE_DRIFT'); }
  // D/E — valid Tally universe: organizations (paginated, limit 20) -> governors sorted by proposalStats.total, exact bound
  { process.env.TALLY_API_KEY = 'test-only-placeholder'; const seen = [];
    const orgs = [{ id: '1', name: 'Alpha', slug: 'alpha', governorIds: ['eip155:1:0x' + '1'.repeat(40)], proposalsCount: 300 }, { id: '2', name: 'Beta', slug: 'beta', governorIds: ['eip155:10:0x' + '2'.repeat(40), 'eip155:10:0x' + '3'.repeat(40)], proposalsCount: 200 }, { id: '3', name: 'GFOF Federation DAO', slug: 'gfof', governorIds: ['eip155:1:0x' + '9'.repeat(40)], proposalsCount: 999 }];
    const totals = { '1': 300, '2': 150, '3': 50 };
    D.setFetch(async (req) => { const b = JSON.parse(req.body); seen.push(b); if (req.headers['Api-Key'] !== 'test-only-placeholder') return res(401, {});
      if (/organizations\(/.test(b.query)) { const after = b.variables.input.page.afterCursor; return res(200, { data: { organizations: { nodes: after ? [orgs[2]] : orgs.slice(0, 2), pageInfo: { lastCursor: after ? null : 'c1' } } } }); }
      if (/governor\(/.test(b.query)) { const id = b.variables.input.id; const k = id.slice(-40)[0]; return res(200, { data: { governor: { id, name: 'G' + k, chainId: id.split(':').slice(0, 2).join(':'), isIndexing: true, proposalStats: { total: totals[k], active: 0 } } } }); }
      return res(422, { errors: [{ message: 'validation' }] }); });
    const u = await D.a2Universe();
    ok(!u.error && u.govs.length === 3 && u.govs[0].proposalStats.total === 300 && u.govs[1].proposalStats.total === 150, 'D: organizations enumerate (2 pages) -> governors fetched -> sorted by proposalStats.total desc');
    ok(!u.govs.some((g) => /9{40}/.test(g.id)), 'D2: doctrine-excluded organization (GFOF) never has its governors fetched');
    ok(seen.filter((b) => /organizations\(/.test(b.query)).every((b) => b.variables.input.page.limit === 20 && b.variables.input.sort.sortBy === 'id'), 'E: Tally pagination uses limit=20 (hard max) and deterministic id sort');
    const u2 = await D.a2Universe(); ok(JSON.stringify(u.govs) === JSON.stringify(u2.govs), 'E2: universe result is deterministic across runs');
    // F — 422 is schema failure, 401 is credential failure
    D.setFetch(async () => res(422, { errors: [{ message: 'Variable "$input" got invalid value' }] })); const f = await D.a2Universe(); ok(f.error && f.error.state === 'SOURCE_INTERFACE_DRIFT' && !/CREDENTIAL/.test(f.error.state), 'F1: Tally 422 => SOURCE_INTERFACE_DRIFT, never credential failure');
    D.setFetch(async () => res(401, {})); const f2 = await D.a2Universe(); ok(f2.error && f2.error.state === 'CREDENTIAL_REQUIRED', 'F2: 401 remains credential failure');
    delete process.env.TALLY_API_KEY; const f3 = await D.a2Universe(); ok(f3.error && f3.error.state === 'CREDENTIAL_REQUIRED' && !/placeholder/.test(JSON.stringify(f3)), 'F3: absent key => CREDENTIAL_REQUIRED; no key value ever appears in output'); }
  // G/H/I — rule unchanged
  ok(D.N === 25, 'G: N=25 fixed'); ok(D.ACTIVITY_DAYS === 90, 'H: 90-day activity rule fixed');
  ok(['GFOF', 'Dossier', 'FCC', 'Polymarket', 'Kalshi', 'Galactic Federation'].every((w) => D.EXCLUDE_RE.test(w)) && !D.EXCLUDE_RE.test('uniswap arbitrum aave'), 'I: doctrine + benchmark exclusions unchanged, ordinary protocols not excluded');
  // J/K/L — no writes, stdout-only draft, slate unchanged
  const src = fs.readFileSync(path.join(__dirname, 'diagnose-a1a2-scope.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/writeFileSync|appendFileSync|createWriteStream|memory_write/.test(src), 'J: no write calls exist in the diagnostic');
  ok(/draftScopeAddendum_NOT_RATIFIED/.test(src) && /console\.log\(JSON\.stringify\(report/.test(src), 'K: draft addendum is emitted to stdout only');
  ok(sha(SLATE) === before, 'L: candidate-slate hash unchanged');
  console.log(`\nDISCOVERY QUERY ADJUDICATION SUITE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
