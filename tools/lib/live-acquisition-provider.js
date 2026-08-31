// FCC STAGE 0 — LIVE ACQUISITION PROVIDER (§1.5 adapters -> candidate-intake pipeline).
//
// Produces the `adapters` object runIntake() consumes: collectRawPool(),
// aiLintPass(), adversaryFlag. Every pool item carries ONLY source-native
// facts (canonical ID, published timestamps, published resolution date where
// the source publishes one, entity identifier) mapped per the frozen §1.5
// definitions. Nothing is inferred from prose; where a source publishes no
// fixed resolution date the field is null and the frozen Step-3 filter
// rejects the item on its own terms.
//
// DISCLOSED OPERATIONALIZATIONS (owner-ratification items, surfaced in every summary):
//   - qualificationStanceShaped: Doctrine B1 defines the class ("a falsifiable
//     would/would-not-qualify judgment about a protocol, asset, venue, or
//     structure ... resolved by a pre-registered observable"). The v0.1
//     mechanical reading is not machine-recorded in this repo, so this provider
//     applies the narrowest literal one: item has a source-published resolution
//     observable AND names a protocol/asset/venue/structure identifier.
//   - adversaryFlag: the AI Standing Adversary is a separate frozen mechanism
//     this pipeline must never reimplement -> always false here, disclosed.
//   - aiLintPass: the frozen LINT applies "once drafted" (Step 3 item 6);
//     no candidate is drafted at intake -> true (pipeline default), disclosed.
//   - A1 spaces / A2 governorIds: the frozen registry says `space_in: [<frozen
//     space list>]` / `by governorId` but neither list is machine-recorded.
//     Absent a ratified scope addendum these sources contribute ZERO with
//     reason SCOPE_ADDENDUM_REQUIRED — never an unscoped global query.
//
// CREDENTIALS: TALLY_API_KEY is read by the A2 adapter at call time only. This
// module never copies, logs, or serializes it; request plans are not retained.
'use strict';
const { ADAPTERS, READINESS, windowBounds, liveFetch, classifyTransportFailure, loadRegistryAddenda } = require('./acquisition-adapters.js');

const MAX_PAGES_PER_SOURCE = 50; // runaway guard; hitting it is reported, never silent
const FEDERATION_RE = /\b(GFOF|Galactic Federation|Dossier|Federation Capital|FCC)\b/i;

function toIso(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return new Date((ts < 1e12 ? ts * 1000 : ts)).toISOString();
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

function shape(resolutionDate, assetId) { return !!(resolutionDate && assetId); }

function mapItem(sourceId, a, ctx) {
  const opened = toIso(a.sourceTimestamp);
  let resolutionDate = null, assetId = null, title = a.title || a.message || null;
  switch (sourceId) {
    case 'A1': resolutionDate = toIso(a.sourceEnd); assetId = a.space || null; break;            // published `end`
    case 'A2': resolutionDate = toIso(a.sourceEnd); assetId = ctx.governorId || null; break;      // published voting-period end
    case 'B1': assetId = null; break;                                                             // filings publish no fixed future resolution date
    case 'F1': assetId = ctx.cik ? `CIK${ctx.cik}` : null; break;                                 // issuer-scoped filings; same rule
    case 'B2': assetId = null; break;                                                             // press releases / actions: no fixed future date
    case 'C2': case 'C1': assetId = null; break;                                                  // feed posts: no source-published fixed date field
    case 'D1': assetId = ctx.path || 'l2beat/l2beat'; break;                                      // stage-change commits: no fixed future date
    case 'D2': assetId = String(a.canonicalId).split('@')[0]; break;                              // TVL datapoints: no future date
    case 'E1': assetId = 'ethereum/execution-specs'; break;                                       // spec commits: fork timing lives in content, never inferred here
    default: break;
  }
  return {
    sourceId, canonicalId: String(a.canonicalId), openedAt: opened, resolutionDate, assetId, title,
    keywords: words(title),
    qualificationStanceShaped: shape(resolutionDate, assetId),
    subjectTouchesFederation: FEDERATION_RE.test(title || ''),
    acquisition: { sourceTimestampRaw: a.sourceTimestamp, sourceEndRaw: a.sourceEnd == null ? null : a.sourceEnd },
  };
}

async function walk(adapter, firstReq, ctx, fetchFn, stats) {
  const items = [];
  let req = firstReq, pages = 0;
  while (req && pages < MAX_PAGES_PER_SOURCE) {
    const res = await fetchFn(req);
    pages++;
    if (!res.ok) { stats.failure = classifyTransportFailure(res.err, null); return items; }
    if (res.statusCode >= 400) { stats.failure = classifyTransportFailure(null, { ...res, bodySample: (res.body || '').slice(0, 300) }); return items; }
    const parsed = adapter.parse(res.body);
    if (!parsed.ok) { stats.failure = { state: READINESS.SOURCE_INTERFACE_DRIFT, detail: parsed.detail }; return items; }
    items.push(...parsed.items);
    req = adapter.nextRequest ? adapter.nextRequest(req, parsed, ctx, res.headers) : null;
  }
  stats.pages = pages;
  if (req && pages >= MAX_PAGES_PER_SOURCE) stats.truncated = `page cap ${MAX_PAGES_PER_SOURCE} reached — exhaustion NOT proven`;
  return items;
}

// ── build the live provider (async: acquisition happens in collectRawPool) ──
function buildLiveProvider({ repoRoot, fetchFn = liveFetch, env = process.env, nowMs } = {}) {
  const addenda = loadRegistryAddenda(repoRoot);
  const window = windowBounds(nowMs);
  const stats = {}; const pool = [];
  const scope = addenda.scopes || {}; // future ratified scope addendum: { A1: { spaces: [] }, A2: { governorIds: [] } }
  let collected = false;

  async function collect() {
    // A1
    stats.A1 = { rawItems: 0 };
    if (!scope.A1 || !Array.isArray(scope.A1.spaces) || !scope.A1.spaces.length) stats.A1.zeroReason = 'SCOPE_ADDENDUM_REQUIRED: frozen `space_in` list not machine-recorded; unscoped global query refused';
    else { const its = await walk(ADAPTERS.A1, ADAPTERS.A1.buildRequest({ window, skip: 0, spaces: scope.A1.spaces }), { window, spaces: scope.A1.spaces }, fetchFn, stats.A1); its.forEach((a) => pool.push(mapItem('A1', a, {}))); stats.A1.rawItems = its.length; }
    // A2
    stats.A2 = { rawItems: 0 };
    if (!env.TALLY_API_KEY) stats.A2.failure = { state: READINESS.CREDENTIAL_REQUIRED, detail: 'TALLY_API_KEY absent' };
    else if (!scope.A2 || !Array.isArray(scope.A2.governorIds) || !scope.A2.governorIds.length) stats.A2.zeroReason = 'SCOPE_ADDENDUM_REQUIRED: frozen governorId list not machine-recorded';
    else for (const g of scope.A2.governorIds) { const its = await walk(ADAPTERS.A2, ADAPTERS.A2.buildRequest({ governorId: g }), { governorId: g }, fetchFn, stats.A2); its.forEach((a) => pool.push(mapItem('A2', a, { governorId: g }))); stats.A2.rawItems += its.length; }
    // B1
    stats.B1 = { rawItems: 0 };
    { const its = await walk(ADAPTERS.B1, ADAPTERS.B1.buildRequest({ window, from: 0 }), { window }, fetchFn, stats.B1); its.forEach((a) => pool.push(mapItem('B1', a, {}))); stats.B1.rawItems = its.length; }
    // B2 enforcement index (downgraded tier), press-seq enumeration bounded by rows found
    stats.B2 = { rawItems: 0 };
    { const its = await walk({ parse: (b) => ADAPTERS.B2.parseEnforcement(b), nextRequest: (req, parsed) => (parsed.items.length ? ADAPTERS.B2.nextEnforcementRequest(req) : null) }, ADAPTERS.B2.buildEnforcementRequest(), {}, fetchFn, stats.B2);
      const inWindow = its.filter((a) => { const ms = Date.parse(a.sourceTimestamp); return !Number.isNaN(ms) && ms >= window.startSec * 1000 && ms <= window.endSec * 1000; });
      inWindow.forEach((a) => pool.push(mapItem('B2', a, {}))); stats.B2.rawItems = inWindow.length; stats.B2.rowsScanned = its.length; }
    // C1/C2 confirm-or-zero
    for (const id of ['C1', 'C2']) {
      stats[id] = { rawItems: 0 };
      const conf = ADAPTERS[id].confirmAcquisition({ registryAddendum: addenda.confirmations.length ? { confirmations: addenda.confirmations } : null });
      if (!conf.confirmed) { stats[id].zeroReason = 'CONDITIONAL_ZERO_CONTRIBUTION (no ratified confirmed surface)'; continue; }
      const res = await fetchFn({ url: conf.feedUrl, method: 'GET', headers: {} });
      if (!res.ok || res.statusCode >= 400) { stats[id].failure = classifyTransportFailure(res.err, res.ok ? res : null); stats[id].zeroReason = 'confirmed feed unreachable this run — zero contribution (lawful fallback)'; continue; }
      const parsed = ADAPTERS[id].parseFeed(res.body);
      if (!parsed.ok) { stats[id].failure = { state: READINESS.SOURCE_INTERFACE_DRIFT, detail: parsed.detail }; continue; }
      const inWindow = parsed.items.filter((a) => { const ms = Date.parse(a.sourceTimestamp); return !Number.isNaN(ms) && ms >= window.startSec * 1000 && ms <= window.endSec * 1000; });
      inWindow.forEach((a) => pool.push(mapItem(id, a, {}))); stats[id].rawItems = inWindow.length;
    }
    // D1 / E1 (GitHub REST), D2
    for (const id of ['D1', 'E1']) { stats[id] = { rawItems: 0 }; const its = await walk(ADAPTERS[id], ADAPTERS[id].buildRequest({ window, page: 1 }), { window }, fetchFn, stats[id]); its.forEach((a) => pool.push(mapItem(id, a, {}))); stats[id].rawItems = its.length; }
    stats.D2 = { rawItems: 0 };
    { const its = await walk(ADAPTERS.D2, ADAPTERS.D2.buildRequest({}), {}, fetchFn, stats.D2); const inWindow = its.filter((a) => a.sourceTimestamp >= window.startSec && a.sourceTimestamp <= window.endSec); inWindow.forEach((a) => pool.push(mapItem('D2', a, {}))); stats.D2.rawItems = inWindow.length; }
    // F1 ratified CIKs only
    stats.F1 = { rawItems: 0, ciks: addenda.f1Ciks.length };
    if (addenda.f1Ciks.length !== 6) stats.F1.zeroReason = 'ratified six-CIK addendum incomplete';
    else for (const e of addenda.f1Ciks) { const its = await walk(ADAPTERS.F1, ADAPTERS.F1.buildRequest({ cik: e.cik }), { cik: e.cik }, fetchFn, stats.F1); const inWindow = its.filter((a) => { const ms = Date.parse(a.sourceTimestamp); return ms >= window.startSec * 1000 && ms <= window.endSec * 1000; }); inWindow.forEach((a) => pool.push(mapItem('F1', a, { cik: e.cik }))); stats.F1.rawItems += inWindow.length; }
    // G1/G2: no code path exists. REGISTRY_SOURCE_IDS in the pipeline also excludes them.
    collected = true;
  }

  return {
    kind: 'LIVE',
    collect,
    collectRawPool() { if (!collected) throw new Error('live provider: collect() must be awaited before collectRawPool()'); return pool.slice(); },
    aiLintPass: () => true,
    adversaryFlag: () => false,
    disclosures: {
      qualificationStanceShaped: 'mechanical reading of Doctrine B1: published resolution observable AND named entity identifier — v0.1 operationalization not machine-recorded; owner ratification item',
      adversaryFlag: 'NOT_APPLIED — AI Standing Adversary is a separate frozen mechanism; materialCount reported as 0',
      aiLintPass: 'NOT_APPLIED_AT_INTAKE — frozen LINT applies once drafted (Step 3 item 6)',
      scope: 'A1 spaces / A2 governorIds require a ratified scope addendum; absent => zero contribution',
    },
    stats, window,
  };
}

// Fixture provider for tests/dry-run proofs — same interface, injected items.
function buildFixtureProvider(items, { adversary = () => false } = {}) {
  return { kind: 'FIXTURE', collect: async () => {}, collectRawPool: () => items.slice(), aiLintPass: () => true, adversaryFlag: adversary, disclosures: {}, stats: { fixture: items.length } };
}

module.exports = { buildLiveProvider, buildFixtureProvider, mapItem, MAX_PAGES_PER_SOURCE };
