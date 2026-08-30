#!/usr/bin/env node
// FCC STAGE 0 — ACQUISITION ADAPTER READINESS VERIFIER.
//
// READINESS_PROBE_ONLY / NOT_CANDIDATE_INTAKE.
// Every network request this tool makes is a readiness probe of a ratified
// §1.5 acquisition surface. Nothing retrieved here enters candidate selection,
// ranking, eligibility, the candidate slate, or any published pool. The tool
// never writes candidate-slate.json and never invokes the intake pipeline.
//
// Per-source states (frozen vocabulary for this gate):
//   READY_LIVE_VERIFIED · READY_IMPLEMENTED_NOT_LIVE_VERIFIED ·
//   CONDITIONAL_ZERO_CONTRIBUTION · CREDENTIAL_REQUIRED ·
//   SOURCE_INTERFACE_DRIFT · NETWORK_BLOCKED · FAIL
//
// Aggregate INTAKE_READINESS fails closed: READY only when every
// non-conditional source is READY_LIVE_VERIFIED, or is in the exact state the
// frozen methodology permits for lawful intake (C1/C2 conditional-zero).
'use strict';
const fs = require('fs');
const path = require('path');
const { ADAPTERS, READINESS, windowBounds, liveFetch, classifyTransportFailure, loadRegistryAddenda } = require('./lib/acquisition-adapters.js');

const ROOT = path.join(__dirname, '..');
const FIX = (f) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'acquisition', f), 'utf8');
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const args = process.argv.slice(2);
const WRITE_EVIDENCE = args.includes('--write-evidence');
const SKIP_LIVE = args.includes('--fixtures-only');

let failures = 0;
const results = [];
function record(id, name, state, detail, extra = {}) {
  results.push({ source: id, name, state, detail, ...extra });
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(`${pad(id, 4)} ${pad(state, 38)} ${detail}`);
}

// ── fixture determinism per adapter ─────────────────────────────────────
function fixtureCheck(id, parseFn, body, expectIds) {
  const p1 = parseFn(body); const p2 = parseFn(body);
  if (!p1.ok || !deepEq(p1, p2)) return { ok: false, why: p1.ok ? 'non-deterministic parse' : `fixture drift: ${p1.detail}` };
  const ids = p1.items.map((i) => i.canonicalId);
  if (!deepEq(ids, expectIds)) return { ok: false, why: `canonical-ID extraction mismatch: ${JSON.stringify(ids)}` };
  if (!p1.items.every((i) => i.sourceTimestamp !== undefined && i.sourceTimestamp !== null)) return { ok: false, why: 'missing source-native timestamp' };
  return { ok: true, items: p1.items.length, parsed: p1 };
}

async function probeLive(adapter, req) {
  const res = await liveFetch(req);
  if (!res.ok) return { cls: classifyTransportFailure(res.err, null) };
  if (res.statusCode >= 400 || (res.headers && res.headers['x-deny-reason'])) return { cls: classifyTransportFailure(null, { ...res, bodySample: (res.body || '').slice(0, 300) }), res };
  return { res };
}

(async () => {
  console.log('=== FCC STAGE 0 — ACQUISITION READINESS (READINESS_PROBE_ONLY / NOT_CANDIDATE_INTAKE) ===');
  const window = windowBounds();
  console.log(`lookback window (frozen 21d): ${new Date(window.startSec * 1000).toISOString()} .. ${new Date(window.endSec * 1000).toISOString()}\n`);

  // A1 Snapshot ───────────────────────────────────────────────────────────
  {
    const fx = fixtureCheck('A1', (b) => ADAPTERS.A1.parse(b), FIX('a1-snapshot.json'), ['0xfixture01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0xfixture02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    // pagination semantics: skip advances by page size; exhaustion below page size
    const req0 = ADAPTERS.A1.buildRequest({ window, skip: 0 });
    const pagOk = fx.ok && ADAPTERS.A1.nextRequest(req0, { exhausted: false }, { window }).pageState.skip === 100 && ADAPTERS.A1.nextRequest(req0, { exhausted: true }, { window }) === null;
    if (!fx.ok || !pagOk) { failures++; record('A1', ADAPTERS.A1.name, READINESS.FAIL, fx.ok ? 'pagination semantics broken' : fx.why); }
    else if (SKIP_LIVE) record('A1', ADAPTERS.A1.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run');
    else {
      const p = await probeLive(ADAPTERS.A1, ADAPTERS.A1.probe({ window }));
      if (p.cls) record('A1', ADAPTERS.A1.name, p.cls.state, `probe: ${p.cls.detail}`, { surface: ADAPTERS.A1.surface });
      else {
        const parsed = ADAPTERS.A1.parse(p.res.body);
        record('A1', ADAPTERS.A1.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}, ${parsed.items.length} item(s) in window, ids+timestamps extracted` : parsed.detail, { surface: ADAPTERS.A1.surface, http: p.res.statusCode, itemCount: parsed.ok ? parsed.items.length : null });
      }
    }
  }

  // A2 Cactus/Tally ───────────────────────────────────────────────────────
  {
    const fx = fixtureCheck('A2', (b) => ADAPTERS.A2.parse(b), FIX('a2-tally.json'), ['77']);
    if (!fx.ok) { failures++; record('A2', ADAPTERS.A2.name, READINESS.FAIL, fx.why); }
    else if (!ADAPTERS.A2.hasCredential()) record('A2', ADAPTERS.A2.name, READINESS.CREDENTIAL_REQUIRED, 'fixture parse deterministic; TALLY_API_KEY absent in this environment — live verification honestly not claimed', { surface: ADAPTERS.A2.surface });
    else if (SKIP_LIVE) record('A2', ADAPTERS.A2.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run');
    else {
      const p = await probeLive(ADAPTERS.A2, ADAPTERS.A2.probe({}));
      if (p.cls) record('A2', ADAPTERS.A2.name, p.cls.state, `probe: ${p.cls.detail}`, { surface: ADAPTERS.A2.surface });
      else { const parsed = ADAPTERS.A2.parse(p.res.body); record('A2', ADAPTERS.A2.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}` : parsed.detail, { surface: ADAPTERS.A2.surface }); }
    }
  }

  // B1 EDGAR full-text ───────────────────────────────────────────────────
  {
    const fx = fixtureCheck('B1', (b) => ADAPTERS.B1.parse(b), FIX('b1-edgar.json'), ['0001234567-26-000111', '0007654321-26-000222']);
    const req0 = ADAPTERS.B1.buildRequest({ window, from: 0 });
    const pagOk = fx.ok && ADAPTERS.B1.nextRequest(req0, { exhausted: false }, { window }).pageState.from === 100 && ADAPTERS.B1.nextRequest(req0, { exhausted: true }, { window }) === null;
    if (!fx.ok || !pagOk) { failures++; record('B1', ADAPTERS.B1.name, READINESS.FAIL, fx.ok ? 'pagination semantics broken' : fx.why); }
    else if (SKIP_LIVE) record('B1', ADAPTERS.B1.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run');
    else {
      const p = await probeLive(ADAPTERS.B1, ADAPTERS.B1.probe({ window }));
      if (p.cls) record('B1', ADAPTERS.B1.name, p.cls.state, `probe: ${p.cls.detail}`, { surface: ADAPTERS.B1.surface });
      else { const parsed = ADAPTERS.B1.parse(p.res.body); record('B1', ADAPTERS.B1.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}, ${parsed.items.length} hit(s), accession+filingDate extracted` : parsed.detail, { surface: ADAPTERS.B1.surface, http: p.res.statusCode }); }
    }
  }

  // B2 CFTC (downgraded, fragile-by-design) ──────────────────────────────
  {
    const fxP = ADAPTERS.B2.parsePress(FIX('b2-press.html'), { seq: 9999, yy: 26 });
    const fxE = ADAPTERS.B2.parseEnforcement(FIX('b2-enforcement-live.html'));
    const okFx = fxP.ok && fxP.exists && fxP.items[0].canonicalId === '9999-26' && fxE.ok && fxE.items.length === 2 && fxE.items[0].canonicalId === '9289-26';
    if (!okFx) { failures++; record('B2', ADAPTERS.B2.name, READINESS.FAIL, `fixture: press=${fxP.ok && fxP.exists} enf=${fxE.ok}`); }
    else if (SKIP_LIVE) record('B2', ADAPTERS.B2.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run (fragile tier, per frozen §1.5)');
    else {
      const p = await probeLive(ADAPTERS.B2, ADAPTERS.B2.probe());
      if (p.cls) record('B2', ADAPTERS.B2.name, p.cls.state, `probe: ${p.cls.detail} (fragile downgraded tier; drift must be surfaced, never substituted)`, { surface: ADAPTERS.B2.enforcementSurface });
      else { const parsed = ADAPTERS.B2.parseEnforcement(p.res.body); record('B2', ADAPTERS.B2.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}, fixed-structure index parsed (${parsed.items.length} rows)` : `LIVE STRUCTURE DRIFT: ${parsed.detail}`, { surface: ADAPTERS.B2.enforcementSurface }); }
    }
  }

  // C1/C2 conditional exchanges — read the RATIFIED addenda, never a guess ──
  const addenda = loadRegistryAddenda(ROOT);
  for (const id of ['C1', 'C2']) {
    const a = ADAPTERS[id];
    const fx = a.parseFeed(FIX('c-feed.xml'));
    if (!fx.ok || fx.items[0].canonicalId !== 'https://fixture.example/post/123') { failures++; record(id, a.name, READINESS.FAIL, 'feed-parser fixture failed'); continue; }
    const conf = a.confirmAcquisition({ registryAddendum: addenda.confirmations.length ? { confirmations: addenda.confirmations } : null });
    if (!conf.confirmed) { record(id, a.name, conf.state, conf.reason, { confirmed: false, contribution: 'ZERO' }); continue; }
    if (SKIP_LIVE) { record(id, a.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, `ratified surface ${conf.feedUrl}; fixtures-only run`, { confirmed: true }); continue; }
    const p = await probeLive(a, { url: conf.feedUrl, method: 'GET', headers: {} });
    if (p.cls) record(id, a.name, p.cls.state, `ratified surface ${conf.feedUrl}; probe: ${p.cls.detail} (zero-contribution fallback stays lawful at execution time)`, { confirmed: true, surface: conf.feedUrl });
    else {
      const parsed = a.parseFeed(p.res.body);
      record(id, a.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `ratified feed live: HTTP ${p.res.statusCode}, ${parsed.items.length} dated item(s), guid+pubDate extracted` : parsed.detail, { confirmed: true, surface: conf.feedUrl });
    }
  }

  // D1 L2BEAT / E1 Ethereum (GitHub REST primary) ────────────────────────
  for (const id of ['D1', 'E1']) {
    const a = ADAPTERS[id];
    const fx = fixtureCheck(id, (b) => a.parse(b), FIX('github-commits.json'), ['f1x7u4ec0mm17aaaaaaaaaaaaaaaaaaaaaaaaaaa', 'f1x7u4ec0mm17bbbbbbbbbbbbbbbbbbbbbbbbbbb']);
    const linkNext = a.nextRequest({ pageState: { page: 1 } }, {}, {}, { link: '<https://api.github.com/x?page=2>; rel="next"' });
    const pagOk = fx.ok && linkNext && linkNext.url.includes('page=2') && a.nextRequest({ pageState: { page: 1 } }, {}, {}, {}) === null;
    if (!fx.ok || !pagOk) { failures++; record(id, a.name, READINESS.FAIL, fx.ok ? 'Link-header pagination broken' : fx.why); continue; }
    if (SKIP_LIVE) { record(id, a.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run'); continue; }
    const p = await probeLive(a, a.probe({ window }));
    if (p.cls) record(id, a.name, p.cls.state, `probe: ${p.cls.detail}`, { surface: `api.github.com/repos/${a.repo}` });
    else {
      const parsed = a.parse(p.res.body);
      record(id, a.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}, ${parsed.items.length} commit(s) in window, sha+committer.date extracted, Link pagination ${p.res.headers.link ? 'present' : 'single-page'}` : parsed.detail, { surface: `api.github.com/repos/${a.repo}`, http: p.res.statusCode, itemCount: parsed.ok ? parsed.items.length : null });
    }
  }

  // D2 DefiLlama ─────────────────────────────────────────────────────────
  {
    const fx = fixtureCheck('D2', (b) => ADAPTERS.D2.parse(b), FIX('d2-llama.json'), ['chain-total@1756000000', 'chain-total@1756086400']);
    if (!fx.ok) { failures++; record('D2', ADAPTERS.D2.name, READINESS.FAIL, fx.why); }
    else if (SKIP_LIVE) record('D2', ADAPTERS.D2.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run');
    else {
      const p = await probeLive(ADAPTERS.D2, ADAPTERS.D2.probe());
      if (p.cls) record('D2', ADAPTERS.D2.name, p.cls.state, `probe: ${p.cls.detail}`, { surface: ADAPTERS.D2.surface });
      else { const parsed = ADAPTERS.D2.parse(p.res.body); record('D2', ADAPTERS.D2.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, parsed.ok ? `live: HTTP ${p.res.statusCode}, per-datapoint timestamps present` : parsed.detail, { surface: ADAPTERS.D2.surface }); }
    }
  }

  // F1 EDGAR named CIKs ──────────────────────────────────────────────────
  {
    const fx = fixtureCheck('F1', (b) => ADAPTERS.F1.parse(b), FIX('f1-submissions.json'), ['0001111111-26-000001', '0001111111-26-000002']);
    let guardOk = false; try { ADAPTERS.F1.buildRequest({ cik: 'not-a-cik' }); } catch (e) { guardOk = /never guessed/.test(e.message); }
    const ratifiedCiks = addenda.f1Ciks;
    if (!fx.ok || !guardOk) { failures++; record('F1', ADAPTERS.F1.name, READINESS.FAIL, fx.ok ? 'CIK guess-guard missing' : fx.why); }
    else if (SKIP_LIVE) record('F1', ADAPTERS.F1.name, READINESS.READY_IMPLEMENTED_NOT_LIVE_VERIFIED, 'fixtures-only run; NOTE: the six ratified issuers\' numeric CIKs are not machine-recorded in this repo — owner addendum required before intake');
    else {
      const probeCik = ratifiedCiks.length ? ratifiedCiks[0].cik : null;
      const p = await probeLive(ADAPTERS.F1, ADAPTERS.F1.probe({ cik: probeCik || undefined }));
      const note = ratifiedCiks.length === 6
        ? ` (ratified addendum present: ${ratifiedCiks.map((e) => e.ticker).join(',')}; probe CIK ${probeCik})`
        : ' (RATIFIED CIK ADDENDUM INCOMPLETE OR ABSENT — owner addendum required before intake)';
      if (p.cls) record('F1', ADAPTERS.F1.name, p.cls.state, `probe: ${p.cls.detail}${note}`, { surface: 'data.sec.gov/submissions' });
      else { const parsed = ADAPTERS.F1.parse(p.res.body); record('F1', ADAPTERS.F1.name, parsed.ok ? READINESS.READY_LIVE_VERIFIED : READINESS.SOURCE_INTERFACE_DRIFT, (parsed.ok ? `live: HTTP ${p.res.statusCode}, accession+filingDate arrays extracted` : parsed.detail) + note, { surface: 'data.sec.gov/submissions' }); }
    }
  }

  // G1/G2 benchmark-only ─────────────────────────────────────────────────
  record('G1', 'Polymarket', 'BENCHMARK_ONLY_EXCLUDED', 'no candidate-layer adapter exists by design — must never generate or resolve candidates');
  record('G2', 'Kalshi', 'BENCHMARK_ONLY_EXCLUDED', 'no candidate-layer adapter exists by design — must never generate or resolve candidates');

  // ── aggregate: fail closed ─────────────────────────────────────────────
  const required = ['A1', 'A2', 'B1', 'B2', 'D1', 'D2', 'E1', 'F1'];
  // C1/C2 never gate the aggregate: the frozen rule's confirm-or-zero fallback
  // makes zero contribution lawful at execution time even if a ratified feed
  // is unreachable or drifted then. Their implementation failures still count
  // via `failures` above.
  const allLive = required.every((id) => { const r = results.find((x) => x.source === id); return r && r.state === READINESS.READY_LIVE_VERIFIED; });
  const ready = failures === 0 && allLive;
  console.log(`\nAGGREGATE INTAKE_READINESS: ${ready ? 'READY' : 'BLOCKED'} (fail-closed: every non-conditional source must be READY_LIVE_VERIFIED; C1/C2 follow the frozen confirm-or-zero rule and never gate this aggregate)`);
  if (!ready) {
    const blockers = required.map((id) => results.find((x) => x.source === id)).filter((r) => r && r.state !== READINESS.READY_LIVE_VERIFIED).map((r) => `${r.source}=${r.state}`);
    console.log(`BLOCKERS: ${blockers.join(' · ')}`);
  }

  if (WRITE_EVIDENCE) {
    const evidence = {
      artifact_class: 'ACQUISITION_READINESS_EVIDENCE', not_a_capital_instrument: true,
      classification: 'READINESS_PROBE_ONLY / NOT_CANDIDATE_INTAKE',
      recorded_at: new Date().toISOString(),
      lookback_window: { start: new Date(window.startSec * 1000).toISOString(), end: new Date(window.endSec * 1000).toISOString() },
      note: 'Endpoint/interface readiness metadata only. No market-derived candidate content is persisted here; item counts and HTTP statuses are the only probe outputs retained.',
      results, aggregate: ready ? 'READY' : 'BLOCKED',
    };
    const out = path.join(ROOT, 'governance', 'evidence', `acquisition-readiness-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
    console.log(`evidence written (write-once addition): ${path.relative(ROOT, out)}`);
  }
  process.exit(failures === 0 ? 0 : 1); // implementation failures fail the tool; live states are report content
})();
