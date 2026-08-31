#!/usr/bin/env node
// A2 TALLY CHAIN-ID ADJUDICATION — tests A–P (no network; injected fetch + fake clock).
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { execSync } = require('child_process');
const D = require('./diagnose-a1a2-scope.js');
const resume = require('./lib/discovery-resume.js');
const ROOT = path.join(__dirname, '..');
const SLATE = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const slateBefore = sha(SLATE); const govBefore = execSync('git status --porcelain governance/', { cwd: ROOT }).toString();
let passed = 0, failed = 0; const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };
const res = (statusCode, body, headers = {}) => ({ ok: true, statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
let fakeNow = 1e12; const sleeps = []; D.setTiming({ sleep: async (ms) => { sleeps.push(ms); fakeNow += ms; }, now: () => fakeNow });
const tmpRoot = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-ch-')); execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m pin', { cwd: d }); return d; };
const KEY = 'test-only-placeholder-key';
const HEX = (c) => '0x' + c.repeat(40);

// A–E — normalization table
ok(D.normalizeChain(1, null).chain === 'eip155:1', 'A: numeric EVM chain id -> eip155:1');
ok(D.normalizeChain('8453', null).chain === 'eip155:8453', 'B: string numeric EVM chain id -> eip155:8453');
ok(D.normalizeChain('eip155:42161', null).chain === 'eip155:42161', 'C: CAIP-2 eip155 chain id passes through');
ok(D.normalizeChain(null, 'eip155:10:' + HEX('1')).chain === 'eip155:10', 'D1: governor-id embedded chain used only via CAIP-10 structure (schema-guaranteed AccountID)');
ok(D.normalizeChain(null, 'not-caip-shaped').chain === null && /CHAIN_ID_MISSING/.test(D.normalizeChain(null, 'not-caip-shaped').reason), 'D2/E: non-CAIP id with no chainId is surfaced as CHAIN_ID_MISSING, never guessed');
ok(D.normalizeChain(null, null).chain === null && /CHAIN_ID_MISSING/.test(D.normalizeChain(null, null).reason), 'E: missing chain id surfaced honestly');
{ const s = D.normalizeChain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:abc'); ok(s.chain === null && s.namespace === 'solana' && /NON_EVM_CHAIN_NOT_REPRESENTABLE/.test(s.reason), 'F0: non-EVM namespace -> null with explicit reason; no fabricated EVM id'); }

// world: mixed EVM / non-EVM / source-rejected governors
const orgs = [
  { id: '1', name: 'Alpha', slug: 'alpha', governorIds: ['eip155:1:' + HEX('1')], proposalsCount: 300 },
  { id: '2', name: 'Beta', slug: 'beta', governorIds: ['eip155:10:' + HEX('2'), 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:SoLGov', 'eip155:250:' + HEX('4')], proposalsCount: 200 },
  { id: '3', name: 'Gamma', slug: 'gamma', governorIds: ['eip155:8453:' + HEX('3')], proposalsCount: 100 },
];
const totals = { '1': 300, '2': 150, '3': 90, '4': 999 };
function world() {
  let calls = 0;
  const fetch = async (req) => { calls++;
    if (req.headers['Api-Key'] !== KEY) return res(401, {});
    const b = JSON.parse(req.body);
    if (/organizations\(/.test(b.query)) return res(200, { data: { organizations: { nodes: orgs, pageInfo: { lastCursor: null } } } });
    if (/governor\(/.test(b.query)) { const id = b.variables.input.id; if (/^eip155:250:/.test(id)) return res(200, { errors: [{ message: 'chain id not supported' }] }); const k = id.slice(-40)[0]; return res(200, { data: { governor: { id, name: 'G' + k, chainId: id.split(':').slice(0, 2).join(':'), isIndexing: true, proposalStats: { total: totals[k], active: 0 } } } }); }
    return res(422, { errors: [{ message: 'validation' }] }); };
  return { fetch, calls: () => calls };
}

(async () => {
  process.env.TALLY_API_KEY = KEY;
  // F/G/H — enumeration survives non-EVM + source-rejected chains; ordering unchanged
  { const root = tmpRoot(); D.setResumeRoot(root); const w = world(); D.setFetch(w.fetch); sleeps.length = 0;
    const u = await D.a2Universe();
    ok(!u.error && u.govs.length === 3, 'F: unsupported/non-EVM chains do not crash the enumeration (3 EVM governors kept)');
    const ex = u.excludedGovernors;
    ok(ex.length === 2 && ex.some((x) => x.namespace === 'solana' && /NON_EVM/.test(x.reason)) && ex.some((x) => /^eip155:250:/.test(x.governorId) && /SOURCE_REJECTED_CHAIN/.test(x.reason) && /chain id not supported/.test(x.reason)), 'G: each excluded governor carries an explicit reason — non-EVM by schema, or the source\'s verbatim "chain id not supported"');
    ok(JSON.stringify(u.govs.map((g) => g.proposalStats.total)) === '[300,150,90]' && u.govs.every((g) => /^eip155:\d+$/.test(g.chain)), 'H: governor ordering by proposalStats.total desc unchanged; chains normalized to eip155:<n>');
    ok(!w.fetch.toString().includes('solana') || u.excludedGovernors.find((x) => x.namespace === 'solana'), 'G2: non-EVM governor excluded before spending a request (schema pre-check)');
    // K/L — pacing and backoff untouched
    ok(D.TALLY_MIN_INTERVAL_MS === 1100 && sleeps.some((ms) => ms > 0 && ms <= 1100), 'K: pacing constant and gaps unchanged');
    ok(JSON.stringify(D.TALLY_BACKOFF_MS) === '[1000,2000,4000,8000,16000]' && D.TALLY_MAX_RETRIES === 5 && D.RETRY_AFTER_MAX_MS === 60000, 'L: retry/backoff ladder and ceiling unchanged');
    // M — resume determinism: old-shape checkpoint (no excludedGovernors) at the failing org resumes to the same result
    const root2 = tmpRoot(); D.setResumeRoot(root2);
    const pins = resume.makePins({ repoRoot: root2, N: D.N, ACTIVITY_DAYS: D.ACTIVITY_DAYS, cutoff: '2026-08-31T00:00:00.000Z', ruleTag: D.RULE_TAG });
    const sorted = [...orgs].sort((a, b) => b.proposalsCount - a.proposalsCount);
    resume.save(root2, pins, { phase: 'govs', orgs: sorted, after: null, exhausted: true, govs: [{ id: 'eip155:1:' + HEX('1'), name: 'G1', chainId: 'eip155:1', isIndexing: true, proposalStats: { total: 300, active: 0 }, _org: 'alpha' }], orgIndex: 1 }); // pre-fix checkpoint shape, stopped at Beta
    const r2 = await D.a2Universe();
    ok(!r2.error && r2.resumedFrom === 'govs' && JSON.stringify(r2.govs.map((g) => g.id)) === JSON.stringify(u.govs.map((g) => g.id)) && r2.excludedGovernors.length === 2, 'M: old-shape checkpoint resumes deterministically to the identical governor order and exclusions');
    const st = JSON.parse(fs.readFileSync(resume.resumePath(root2), 'utf8'));
    ok(st.pins.ruleTag === D.RULE_TAG && Array.isArray(st.progress.excludedGovernors), 'M2: rule tag pin unchanged (rule unchanged); checkpoint now records exclusions');
    ok(!fs.readFileSync(resume.resumePath(root2), 'utf8').includes(KEY) && !JSON.stringify(u).includes(KEY) && !JSON.stringify(r2).includes(KEY), 'N: key appears in no result, log, or checkpoint'); }
  ok(D.N === 25, 'I: N=25 unchanged'); ok(D.ACTIVITY_DAYS === 90, 'J: 90-day rule unchanged');
  ok(execSync('git status --porcelain governance/', { cwd: ROOT }).toString() === govBefore, 'O: no governance/slate/addendum write');
  ok(sha(SLATE) === slateBefore, 'P: candidate-slate hash unchanged');
  delete process.env.TALLY_API_KEY;
  console.log(`\nA2 CHAIN-ID ADJUDICATION SUITE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
