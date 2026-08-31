#!/usr/bin/env node
// FCC STAGE 0 — A1/A2 SCOPE DISCOVERY + SHORTAGE DIAGNOSTIC (NO-WRITE).
//
// Applies the PRE-REGISTERED neutral scope rule (below, fixed 2026-08-31T02:17Z
// before any A1/A2 data was examined) mechanically against the live frozen
// acquisition interfaces, counts proposals per included space/governor at the
// frozen 21-day lookback and the frozen 42-day shortage extension, runs the
// frozen eligibility/bucket steps IN MEMORY, and prints a DRAFT scope addendum.
//
// WRITES NOTHING. Never touches candidate-slate.json, the production addenda,
// the completion marker, or any governance path. Prints to stdout only.
//
// PRE-REGISTERED RULE (outcome-blind; N and orderings fixed before data):
//   A1: Snapshot's own `ranking` listing (source-native ordering by activity);
//       include the top N=25 spaces that are verified per Snapshot, not
//       hibernated, not flagged, with >=1 proposal created in the trailing 90d.
//       If the source does not expose hibernated/flagged, the rule applies
//       verified + activity only — disclosed in output.
//   A2: Tally's own `governors` listing; sort client-side by the source-native
//       proposalStats.total descending; include the top N=25 with >=1 proposal
//       created in the trailing 90d. Chain recorded from governorId.
//   Exclusions: any entity whose id/name matches Federation/GFOF/Dossier/FCC
//       (Doctrine §B2/§E4); any G1/G2 benchmark entity (Polymarket/Kalshi).
'use strict';
const { ADAPTERS, liveFetch, classifyTransportFailure } = require('./lib/acquisition-adapters.js');
const intake = require('./lib/candidate-intake.js');
const { mapItem } = require('./lib/live-acquisition-provider.js');

const N = 25;
const ACTIVITY_DAYS = 90;
const EXCLUDE_RE = /\b(GFOF|Galactic Federation|Dossier|Federation Capital|FCC|Polymarket|Kalshi)\b/i;
const CUTOFF = '2026-08-31T00:00:00.000Z';
const cutoffMs = Date.parse(CUTOFF);
const argv = process.argv.slice(2);
let fetchFn = liveFetch; // injectable for tests via setFetch(); production is always liveFetch
function setFetch(fn) { fetchFn = fn; }

async function gql(url, query, variables, headers = {}) {
  const res = await fetchFn({ url, method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) return { error: classifyTransportFailure(res.err, null) };
  if (res.statusCode >= 400) return { error: classifyTransportFailure(null, { ...res, bodySample: (res.body || '').slice(0, 300) }) };
  let j; try { j = JSON.parse(res.body); } catch (e) { return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'non-JSON' } }; }
  if (j.errors) return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: j.errors.map((e) => e.message).join('; ') } };
  return { data: j.data };
}

// ── A1 universe via Snapshot's own ranking ──────────────────────────────
// ADJUDICATED 2026-08-31: the deployed hub enforces `ranking.first <= 20`
// (ARG_LIMITS.ranking in apps/hub/src/graphql/helpers.ts) inside checkLimits,
// called OUTSIDE the resolver's try/catch — a larger `first` escapes as HTTP 500.
// The universe is therefore walked in pages of 20 via `skip`. All rule fields
// (verified, hibernated, flagged, proposalsCount, followersCount,
// activeProposals) exist on `Space` (RankingObject.items: [Space!]!).
const RANKING_PAGE = 20;
const RANKING_MAX_SKIP = 400; // 20 pages; hitting it is disclosed, never silent
const RANKING_FULL = `query($first:Int!,$skip:Int!){ ranking(first:$first, skip:$skip){ items { id name verified turbo hibernated flagged proposalsCount followersCount activeProposals } } }`;
const RANKING_MINIMAL = `query($first:Int!,$skip:Int!){ ranking(first:$first, skip:$skip){ items { id name verified proposalsCount followersCount activeProposals } } }`;
function parseRankingPage(data) {
  const items = data && data.ranking && Array.isArray(data.ranking.items) ? data.ranking.items : null;
  if (!items) return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'ranking.items missing/not array' } };
  for (const s of items) if (typeof s.id !== 'string' || typeof s.verified !== 'boolean') return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'ranking item missing id/verified' } };
  return { items };
}
async function a1Universe() {
  let curationFlagsAvailable = true, query = RANKING_FULL;
  const all = [];
  for (let skip = 0; skip < RANKING_MAX_SKIP; skip += RANKING_PAGE) {
    let r = await gql(ADAPTERS.A1.surface, query, { first: RANKING_PAGE, skip });
    if (r.error && r.error.state === 'SOURCE_INTERFACE_DRIFT' && query === RANKING_FULL && skip === 0) {
      // disclosed fallback: source no longer exposes hibernated/flagged -> verified + activity only
      curationFlagsAvailable = false; query = RANKING_MINIMAL;
      r = await gql(ADAPTERS.A1.surface, query, { first: RANKING_PAGE, skip });
    }
    if (r.error) return { error: r.error, partial: all };
    const page = parseRankingPage(r.data);
    if (page.error) return { error: page.error, partial: all };
    all.push(...page.items);
    if (page.items.length < RANKING_PAGE) return { items: all, curationFlagsAvailable, exhausted: true };
  }
  return { items: all, curationFlagsAvailable, exhausted: false, note: `ranking walk capped at skip=${RANKING_MAX_SKIP}; universe beyond this not examined` };
}
async function a1ProposalsCreatedBetween(spaceId, fromSec, toSec) {
  const out = []; let skip = 0;
  for (;;) {
    const r = await gql(ADAPTERS.A1.surface, `query($s:[String]!,$g:Int!,$l:Int!,$skip:Int!){ proposals(first:100, skip:$skip, where:{space_in:$s, created_gte:$g, created_lte:$l}){ id created end title space{id} } }`, { s: [spaceId], g: fromSec, l: toSec, skip });
    if (r.error) return { error: r.error, items: out };
    const arr = r.data.proposals || []; out.push(...arr);
    if (arr.length < 100) break; skip += 100; if (skip > 5000) break;
  }
  return { items: out };
}

// ── A2 universe via Tally's native enumeration ──────────────────────────
// ADJUDICATED 2026-08-31 (apidocs.tally.xyz): `governors` REQUIRES
// filters.organizationId — Tally exposes no global governor list — and
// PageInput.limit has a hard maximum of 20. The Tally-native global
// enumeration is `organizations` (sorted deterministically by `id`), each
// carrying `governorIds` and the source-native aggregate `proposalsCount`.
// The pre-registered rule (sort governors by proposalStats.total desc, top
// N) is implemented EXACTLY: organizations are taken in descending
// proposalsCount until >= N governors are gathered AND the next
// organization's proposalsCount is below the N-th governor's total (an
// organization's count bounds every governor inside it), then governors are
// sorted by their own proposalStats.total. Enumeration caps are disclosed.
const TALLY_PAGE = 20;
const ORG_MAX_PAGES = 400; // 8,000 organizations; hitting it is disclosed
async function a2Universe() {
  if (!process.env.TALLY_API_KEY) return { error: { state: 'CREDENTIAL_REQUIRED', detail: 'TALLY_API_KEY absent (session-only; never printed)' } };
  const hdr = { 'Api-Key': process.env.TALLY_API_KEY };
  const orgs = []; let after = null, exhausted = false;
  for (let page = 0; page < ORG_MAX_PAGES; page++) {
    const r = await gql(ADAPTERS.A2.surface, `query($input:OrganizationsInput){ organizations(input:$input){ nodes{ ... on Organization { id name slug governorIds proposalsCount hasActiveProposals } } pageInfo{ lastCursor } } }`, { input: { sort: { isDescending: false, sortBy: 'id' }, page: after ? { afterCursor: after, limit: TALLY_PAGE } : { limit: TALLY_PAGE } } }, hdr);
    if (r.error) return { error: r.error, partial: orgs };
    const nodes = (r.data.organizations && r.data.organizations.nodes) || [];
    for (const o of nodes) if (typeof o.id === 'undefined' || !Array.isArray(o.governorIds) || typeof o.proposalsCount !== 'number') return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'organization node missing id/governorIds/proposalsCount' } };
    orgs.push(...nodes);
    after = r.data.organizations.pageInfo && r.data.organizations.pageInfo.lastCursor;
    if (!after || nodes.length < TALLY_PAGE) { exhausted = true; break; }
  }
  orgs.sort((a, b) => (b.proposalsCount - a.proposalsCount) || String(a.id).localeCompare(String(b.id)));
  // exact top-N governor selection using the organization aggregate as a bound
  const govs = [];
  for (let i = 0; i < orgs.length; i++) {
    const o = orgs[i];
    if (EXCLUDE_RE.test(`${o.id} ${o.name} ${o.slug}`)) continue;
    for (const gid of o.governorIds) {
      const g = await gql(ADAPTERS.A2.surface, `query($input:GovernorInput!){ governor(input:$input){ id name chainId isIndexing proposalStats{ total active } } }`, { input: { id: gid } }, hdr);
      if (g.error) return { error: g.error, partial: govs };
      if (g.data.governor) govs.push({ ...g.data.governor, _org: o.slug });
    }
    govs.sort((a, b) => (b.proposalStats.total - a.proposalStats.total) || String(a.id).localeCompare(String(b.id)));
    const nth = govs[N - 1] ? govs[N - 1].proposalStats.total : -1;
    const next = orgs[i + 1];
    if (govs.length >= N && (!next || next.proposalsCount < nth)) break;
  }
  return { govs, hdr, exhausted, note: exhausted ? null : `organization enumeration capped at ${ORG_MAX_PAGES} pages; top-N not proven global` };
}
async function a2ProposalsCreatedBetween(governorId, fromSec, toSec, hdr) {
  const out = []; let after = null;
  for (let page = 0; page < 50; page++) {
    const r = await gql(ADAPTERS.A2.surface, `query($input:ProposalsInput!){ proposals(input:$input){ nodes{ ... on Proposal { id onchainId block{ timestamp } end{ ... on Block { timestamp } ... on BlocklessTimestamp { timestamp } } metadata{ title } } } pageInfo{ lastCursor } } }`, { input: { filters: { governorId }, sort: { isDescending: true, sortBy: 'id' }, page: after ? { afterCursor: after, limit: TALLY_PAGE } : { limit: TALLY_PAGE } } }, hdr);
    if (r.error) return { error: r.error, items: out };
    const nodes = (r.data.proposals && r.data.proposals.nodes) || [];
    let olderSeen = false;
    for (const p of nodes) {
      const created = p.block && p.block.timestamp;
      if (created == null) continue;
      if (created >= fromSec && created <= toSec) out.push(p); else if (created < fromSec) olderSeen = true;
    }
    after = r.data.proposals.pageInfo && r.data.proposals.pageInfo.lastCursor;
    if (!after || nodes.length < TALLY_PAGE || olderSeen) break; // newest-first: stop once older than the window
  }
  return { items: out };
}

// ── frozen eligibility/bucket diagnostic, in memory ─────────────────────
function diagnose(pool) {
  const { pool: dedup, merges } = intake.dedupExactId(pool);
  const { flags } = intake.flagPossibleDuplicates(dedup);
  const reasons = {}; const buckets = { short: 0, medium: 0, long: 0 }; let dated = 0;
  for (const it of dedup) {
    if (it.resolutionDate) dated++;
    const e = intake.checkEligibility(it, { cutoffTimestamp: CUTOFF, aiLintPass: true });
    if (!e.eligible) { reasons[e.reason] = (reasons[e.reason] || 0) + 1; continue; }
    buckets[intake.horizonBucket(e.daysToResolution)]++;
  }
  return { raw: pool.length, afterExactDedup: dedup.length, exactMerges: merges.length, possibleDuplicateFlags: flags.length, withSourceNativeResolutionDate: dated, eligibleBuckets: buckets, rejectedByReason: reasons, shortage: Object.fromEntries(['short', 'medium', 'long'].map((b) => [b, intake.shortageAction(b, buckets[b], 5, 21).action])) };
}

module.exports = { setFetch, gql, parseRankingPage, a1Universe, a1ProposalsCreatedBetween, a2Universe, a2ProposalsCreatedBetween, diagnose, N, ACTIVITY_DAYS, EXCLUDE_RE, RANKING_PAGE, TALLY_PAGE };

if (require.main === module) (async () => {
  console.log('=== A1/A2 SCOPE DISCOVERY + SHORTAGE DIAGNOSTIC — NO-WRITE, IN-MEMORY ONLY ===');
  console.log(`cutoff ${CUTOFF}; rule N=${N}; activity window ${ACTIVITY_DAYS}d; run at ${new Date().toISOString()}`);
  const nowSec = Math.floor(cutoffMs / 1000);
  const win = (days) => ({ fromSec: nowSec - days * 86400, toSec: nowSec });
  const report = { rule: 'pre-registered 2026-08-31T02:17Z (see header)', A1: {}, A2: {}, diagnostic21: null, diagnostic42: null };

  // A1
  const u1 = await a1Universe();
  if (u1.error) { report.A1 = { state: u1.error.state, detail: u1.error.detail }; }
  else {
    report.A1.curationFlagsAvailable = u1.curationFlagsAvailable; report.A1.universeExhausted = u1.exhausted; if (u1.note) report.A1.note = u1.note;
    const candidates = u1.items.filter((s) => s.verified === true && !(u1.curationFlagsAvailable && (s.hibernated || s.flagged)) && !EXCLUDE_RE.test(`${s.id} ${s.name}`));
    const included = [], excludedInactive = [];
    for (const s of candidates) {
      if (included.length >= N) break;
      const act = await a1ProposalsCreatedBetween(s.id, nowSec - ACTIVITY_DAYS * 86400, nowSec);
      if (act.error) { report.A1.error = act.error; break; }
      if (act.items.length < 1) { excludedInactive.push(s.id); continue; }
      const p21 = act.items.filter((p) => p.created >= win(21).fromSec).length;
      const p42 = act.items.filter((p) => p.created >= win(42).fromSec).length;
      included.push({ spaceId: s.id, name: s.name, verified: s.verified, proposalsCountAllTime: s.proposalsCount, followers: s.followersCount, activeProposals: s.activeProposals, proposals90d: act.items.length, proposals21d: p21, proposals42d: p42, _items: act.items });
    }
    report.A1.included = included.map(({ _items, ...x }) => x);
    report.A1.excludedInactive = excludedInactive;
    report.A1.excludedByDoctrine = u1.items.filter((s) => EXCLUDE_RE.test(`${s.id} ${s.name}`)).map((s) => s.id);
    report._a1Items = included.flatMap((s) => s._items.map((p) => ({ ...p, _space: s.spaceId })));
  }

  // A2
  const u2 = await a2Universe();
  if (u2.error) { report.A2 = { state: u2.error.state, detail: u2.error.detail }; }
  else {
    const included = [];
    report.A2.universeExhausted = u2.exhausted; if (u2.note) report.A2.note = u2.note;
    for (const g of u2.govs.filter((g) => !EXCLUDE_RE.test(`${g.id} ${g.name}`))) {
      if (included.length >= N) break;
      const act = await a2ProposalsCreatedBetween(g.id, nowSec - ACTIVITY_DAYS * 86400, nowSec, u2.hdr);
      if (act.error) { report.A2.error = act.error; break; }
      if (act.items.length < 1) continue;
      const p21 = act.items.filter((p) => p.block.timestamp >= win(21).fromSec).length;
      const p42 = act.items.filter((p) => p.block.timestamp >= win(42).fromSec).length;
      included.push({ governorId: g.id, name: g.name, organization: g._org, chain: g.chainId || String(g.id).split(':').slice(0, 2).join(':'), proposalsTotal: g.proposalStats.total, proposals90d: act.items.length, proposals21d: p21, proposals42d: p42, _items: act.items });
    }
    report.A2.included = included.map(({ _items, ...x }) => x);
    report._a2Items = included.flatMap((g) => g._items.map((p) => ({ ...p, _gov: g.governorId })));
  }

  // diagnostics at 21d and 42d (frozen lookback + frozen extension)
  for (const days of [21, 42]) {
    const w = win(days);
    const pool = [];
    for (const p of report._a1Items || []) if (p.created >= w.fromSec) pool.push(mapItem('A1', { canonicalId: p.id, sourceTimestamp: p.created, sourceEnd: p.end, space: p.space && p.space.id, title: p.title }, {}));
    for (const p of report._a2Items || []) if (p.block.timestamp >= w.fromSec) pool.push(mapItem('A2', { canonicalId: p.onchainId || p.id, sourceTimestamp: p.block.timestamp, sourceEnd: p.end && p.end.timestamp, title: p.metadata && p.metadata.title }, { governorId: p._gov }));
    report[days === 21 ? 'diagnostic21' : 'diagnostic42'] = diagnose(pool);
  }
  delete report._a1Items; delete report._a2Items;

  report.fifteenAchievableUnderFrozenLaw = report.diagnostic42 ? Object.values(report.diagnostic42.eligibleBuckets).every((c) => c >= 5) : null;
  report.draftScopeAddendum_NOT_RATIFIED = {
    artifact_class: 'SOURCE_REGISTRY_ADDENDUM', _DRAFT_NOTICE: 'DRAFT ONLY — produced mechanically by tools/diagnose-a1a2-scope.js under the pre-registered rule; not ratified; owner must review, then record as governance/experiments/stage0-public-experiment-v1/source-registry-addendum-002.json',
    rule: 'see tool header', generated_at: new Date().toISOString(),
    scopes: { A1: { spaces: (report.A1.included || []).map((s) => s.spaceId) }, A2: { governorIds: (report.A2.included || []).map((g) => g.governorId) } },
  };
  console.log(JSON.stringify(report, null, 2));
  console.log('=== NOTHING WRITTEN — candidate-slate.json, addenda, and gates untouched ===');
})();
