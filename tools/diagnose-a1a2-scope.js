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

// ── TALLY TRANSPORT: serialized, paced, 429-aware (Snapshot leg untouched) ─
// Tally documents a "fairly low" free-tier rate limit without a number, so the
// pacing is conservative and deterministic: one request in flight at a time,
// a fixed minimum gap between requests, and on HTTP 429 either the server's
// Retry-After (seconds or HTTP-date, capped) or the fixed backoff ladder
// 1s -> 2s -> 4s -> 8s -> 16s with a frozen retry ceiling. No jitter: every
// wait is auditable from the response alone.
const TALLY_MIN_INTERVAL_MS = 1100;
const TALLY_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
const TALLY_MAX_RETRIES = TALLY_BACKOFF_MS.length;
const RETRY_AFTER_MAX_MS = 60000;
const DIAG_RATE_LIMITED = 'RATE_LIMITED'; // diagnostic transport condition for this no-write tool only — not a readiness/governance state
let sleepFn = (ms) => new Promise((r) => setTimeout(r, ms));
let nowFn = () => Date.now();
function setTiming({ sleep, now } = {}) { if (sleep) sleepFn = sleep; if (now) nowFn = now; }
let tallyChain = Promise.resolve();
let tallyLastAt = -Infinity;
const tallyLog = [];
function parseRetryAfter(h, now) {
  if (h == null) return null;
  const s = String(h).trim();
  if (/^\d+$/.test(s)) return Math.min(parseInt(s, 10) * 1000, RETRY_AFTER_MAX_MS);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return Math.min(Math.max(0, t - now), RETRY_AFTER_MAX_MS);
  return null;
}
function tallyGql(query, variables, headers) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const gap = TALLY_MIN_INTERVAL_MS - (nowFn() - tallyLastAt);
      if (gap > 0) { tallyLog.push({ kind: 'pace', ms: gap }); await sleepFn(gap); }
      tallyLastAt = nowFn();
      const res = await fetchFn({ url: ADAPTERS.A2.surface, method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query, variables }) });
      if (res.ok && res.statusCode === 429) {
        if (attempt >= TALLY_MAX_RETRIES) return { error: { state: DIAG_RATE_LIMITED, detail: `HTTP 429 persisted through ${TALLY_MAX_RETRIES} bounded retries — stopping honestly; rerun later (resume state is saved)` } };
        const ra = parseRetryAfter(res.headers && res.headers['retry-after'], nowFn());
        const wait = ra != null ? ra : TALLY_BACKOFF_MS[attempt];
        tallyLog.push({ kind: '429', attempt, wait, source: ra != null ? 'retry-after' : 'backoff' });
        await sleepFn(wait);
        continue;
      }
      if (!res.ok) return { error: classifyTransportFailure(res.err, null) };
      if (res.statusCode >= 400) return { error: classifyTransportFailure(null, { ...res, bodySample: (res.body || '').slice(0, 300) }) };
      let j; try { j = JSON.parse(res.body); } catch (e) { return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'non-JSON' } }; }
      if (j.errors) return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: j.errors.map((e) => e.message).join('; ') } };
      return { data: j.data };
    }
  };
  const p = tallyChain.then(run, run); // strict serialization: one Tally request at a time
  tallyChain = p.catch(() => {});
  return p;
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
// ── A2 TIMESTAMP NORMALIZATION (fix, 2026-09-01) ─────────────────────────
// Tally's published API reference defines `Timestamp` as an RFC3339 STRING.
// Comparing that string against numeric epoch seconds coerces to NaN and is
// always false — which silently dropped every A2 proposal in the Epoch 1
// diagnostic. All A2 time comparisons now go through tsToSec(): RFC3339 ->
// epoch seconds; numeric seconds pass through; numeric milliseconds (>1e12)
// are scaled; anything unparseable returns null and the item is reported,
// never silently counted or dropped.
function tsToSec(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1e12 ? Math.floor(v / 1000) : v) : null;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return tsToSec(Number(v));
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}
const TALLY_PAGE = 20;
const ORG_MAX_PAGES = 400; // 8,000 organizations; hitting it is disclosed
// ── A2 CHAIN IDENTIFIER NORMALIZATION (adjudicated 2026-08-31) ──────────
// Tally's published schema: ChainID is CAIP-2 ("eip155:1"); AccountID (governor
// ids) is CAIP-10 ("eip155:1:0x..."). The addendum schema FCC already ratified
// accepts only `eip155:<n>:0x<40 hex>` governorIds. Normalization therefore maps
// ONLY source-supported EVM forms to `eip155:<n>` and never fabricates an EVM id:
//   - "eip155:<n>"            -> "eip155:<n>"
//   - 137 / "137"             -> "eip155:137" (bare numerics are EVM-only by definition)
//   - governor id prefix      -> used only because AccountID is schema-guaranteed CAIP-10
//   - any other namespace     -> null + explicit reason (excluded transparently, never dropped silently)
// Governors the source itself rejects with "chain id not supported" are recorded
// with that verbatim source message and the enumeration continues.
function normalizeChain(chainIdField, governorId) {
  const evm = (n) => ({ chain: `eip155:${n}`, namespace: 'eip155' });
  if (typeof chainIdField === 'string' && /^eip155:\d+$/.test(chainIdField)) return evm(chainIdField.split(':')[1]);
  if (typeof chainIdField === 'number' && Number.isInteger(chainIdField) && chainIdField > 0) return evm(chainIdField);
  if (typeof chainIdField === 'string' && /^\d+$/.test(chainIdField)) return evm(chainIdField);
  if (typeof chainIdField === 'string' && /^[a-z0-9-]+:[^:]+$/.test(chainIdField)) return { chain: null, namespace: chainIdField.split(':')[0], reason: `NON_EVM_CHAIN_NOT_REPRESENTABLE: source chainId "${chainIdField}" is outside the ratified eip155 addendum schema` };
  const m = typeof governorId === 'string' ? /^([a-z0-9-]+):([^:]+):(.+)$/.exec(governorId) : null;
  if (m) {
    if (m[1] === 'eip155' && /^\d+$/.test(m[2])) return evm(m[2]);
    return { chain: null, namespace: m[1], reason: `NON_EVM_CHAIN_NOT_REPRESENTABLE: governor id namespace "${m[1]}" is outside the ratified eip155 addendum schema` };
  }
  return { chain: null, namespace: null, reason: 'CHAIN_ID_MISSING: source provided no chainId and the governor id is not CAIP-10 shaped' };
}
const SOURCE_CHAIN_REJECT_RE = /chain id not supported/i;

const RULE_TAG = 'a2-rule: organizations(id asc) -> governors by proposalStats.total desc, exact org-count bound, N=25, 90d';
const resume = require('./lib/discovery-resume.js');
let resumeRoot = require('path').join(__dirname, '..');
function setResumeRoot(p) { resumeRoot = p; }
async function a2Universe({ useResume = true } = {}) {
  if (!process.env.TALLY_API_KEY) return { error: { state: 'CREDENTIAL_REQUIRED', detail: 'TALLY_API_KEY absent (session-only; never printed)' } };
  const hdr = { 'Api-Key': process.env.TALLY_API_KEY }; // per-call only; never enters resume state
  const pins = resume.makePins({ repoRoot: resumeRoot, N, ACTIVITY_DAYS, cutoff: CUTOFF, ruleTag: RULE_TAG });
  let prog = { phase: 'orgs', orgs: [], after: null, exhausted: false, govs: [], orgIndex: 0, excludedGovernors: [] };
  let resumedFrom = null;
  if (useResume) {
    const r = resume.load(resumeRoot, pins);
    if (r.found && !r.ok) return { error: { state: 'RESUME_REFUSED', detail: r.reason + ' — delete .fcc-local/ to start fresh' } };
    if (r.found && r.ok) { prog = r.progress; resumedFrom = prog.phase; if (!Array.isArray(prog.excludedGovernors)) prog.excludedGovernors = []; } // older checkpoints lack the field; the enumeration state itself is compatible
  }
  const checkpoint = () => { if (useResume) resume.save(resumeRoot, pins, prog); };
  // Phase 1: Tally-native global enumeration, deterministic id order, limit 20 (hard max)
  if (prog.phase === 'orgs') {
    for (let page = Math.floor(prog.orgs.length / TALLY_PAGE); page < ORG_MAX_PAGES; page++) {
      const r = await tallyGql(`query($input:OrganizationsInput){ organizations(input:$input){ nodes{ ... on Organization { id name slug governorIds proposalsCount hasActiveProposals } } pageInfo{ lastCursor } } }`, { input: { sort: { isDescending: false, sortBy: 'id' }, page: prog.after ? { afterCursor: prog.after, limit: TALLY_PAGE } : { limit: TALLY_PAGE } } }, hdr);
      if (r.error) { checkpoint(); return { error: r.error, partial: prog.orgs, resumable: useResume }; }
      const nodes = (r.data.organizations && r.data.organizations.nodes) || [];
      for (const o of nodes) if (typeof o.id === 'undefined' || !Array.isArray(o.governorIds) || typeof o.proposalsCount !== 'number') return { error: { state: 'SOURCE_INTERFACE_DRIFT', detail: 'organization node missing id/governorIds/proposalsCount' } };
      prog.orgs.push(...nodes.map((o) => ({ id: o.id, name: o.name, slug: o.slug, governorIds: o.governorIds, proposalsCount: o.proposalsCount })));
      prog.after = r.data.organizations.pageInfo && r.data.organizations.pageInfo.lastCursor;
      if (!prog.after || nodes.length < TALLY_PAGE) { prog.exhausted = true; break; }
      checkpoint();
    }
    prog.orgs.sort((a, b) => (b.proposalsCount - a.proposalsCount) || String(a.id).localeCompare(String(b.id)));
    prog.phase = 'govs'; prog.orgIndex = 0; prog.govs = []; checkpoint();
  }
  // Phase 2: exact top-N governor selection using the organization aggregate as a bound
  if (prog.phase === 'govs') {
    for (let i = prog.orgIndex; i < prog.orgs.length; i++) {
      const o = prog.orgs[i];
      if (!EXCLUDE_RE.test(`${o.id} ${o.name} ${o.slug}`)) {
        for (const gid of o.governorIds) {
          if (prog.govs.some((g) => g.id === gid) || prog.excludedGovernors.some((x) => x.governorId === gid)) continue; // idempotent on resume
          const pre = normalizeChain(null, gid);
          if (!pre.chain) { prog.excludedGovernors.push({ governorId: gid, organization: o.slug, namespace: pre.namespace, reason: pre.reason }); continue; } // non-EVM: excluded transparently, no request spent
          const g = await tallyGql(`query($input:GovernorInput!){ governor(input:$input){ id name chainId isIndexing proposalStats{ total active } } }`, { input: { id: gid } }, hdr);
          if (g.error && g.error.state === 'SOURCE_INTERFACE_DRIFT' && SOURCE_CHAIN_REJECT_RE.test(g.error.detail)) {
            prog.excludedGovernors.push({ governorId: gid, organization: o.slug, namespace: pre.namespace, reason: `SOURCE_REJECTED_CHAIN: Tally answered "${g.error.detail}" for this governor id` });
            checkpoint(); continue; // the source itself declines this chain — recorded verbatim, enumeration continues
          }
          if (g.error) { prog.orgIndex = i; checkpoint(); return { error: g.error, partial: prog.govs, resumable: useResume }; }
          if (g.data.governor) {
            const nc = normalizeChain(g.data.governor.chainId, g.data.governor.id);
            if (!nc.chain) { prog.excludedGovernors.push({ governorId: gid, organization: o.slug, namespace: nc.namespace, reason: nc.reason }); checkpoint(); continue; }
            prog.govs.push({ ...g.data.governor, chain: nc.chain, _org: o.slug });
          }
        }
      }
      prog.govs.sort((a, b) => (b.proposalStats.total - a.proposalStats.total) || String(a.id).localeCompare(String(b.id)));
      prog.orgIndex = i + 1; checkpoint();
      const nth = prog.govs[N - 1] ? prog.govs[N - 1].proposalStats.total : -1;
      const next = prog.orgs[i + 1];
      if (prog.govs.length >= N && (!next || next.proposalsCount < nth)) break;
    }
    prog.phase = 'done'; checkpoint();
  }
  // No header object in the result: callers rebuild it from env at call time.
  return { govs: prog.govs, excludedGovernors: prog.excludedGovernors, exhausted: prog.exhausted, resumedFrom, note: prog.exhausted ? null : `organization enumeration capped at ${ORG_MAX_PAGES} pages; top-N not proven global` };
}
async function a2ProposalsCreatedBetween(governorId, fromSec, toSec) {
  const hdr = { 'Api-Key': process.env.TALLY_API_KEY }; // env-read at call time; never retained or returned
  const out = []; const unparseable = []; let after = null;
  for (let page = 0; page < 50; page++) {
    const r = await tallyGql(`query($input:ProposalsInput!){ proposals(input:$input){ nodes{ ... on Proposal { id onchainId block{ timestamp } end{ ... on Block { timestamp } ... on BlocklessTimestamp { timestamp } } metadata{ title } } } pageInfo{ lastCursor } } }`, { input: { filters: { governorId }, sort: { isDescending: true, sortBy: 'id' }, page: after ? { afterCursor: after, limit: TALLY_PAGE } : { limit: TALLY_PAGE } } }, hdr);
    if (r.error) return { error: r.error, items: out, unparseable };
    const nodes = (r.data.proposals && r.data.proposals.nodes) || [];
    let olderSeen = false;
    for (const p of nodes) {
      const created = p.block && p.block.timestamp;
      if (created == null) continue;
      const createdSec = tsToSec(created);
      if (createdSec == null) { unparseable.push({ id: p.id, onchainId: p.onchainId, rawTimestamp: created }); continue; }
      p._createdSec = createdSec; // normalized once; every later comparison uses seconds
      if (createdSec >= fromSec && createdSec <= toSec) out.push(p); else if (createdSec < fromSec) olderSeen = true;
    }
    after = r.data.proposals.pageInfo && r.data.proposals.pageInfo.lastCursor;
    if (!after || nodes.length < TALLY_PAGE || olderSeen) break; // newest-first: stop once older than the window
  }
  return { items: out, unparseable };
}

// ── frozen eligibility/bucket diagnostic, in memory ─────────────────────
function diagnose(pool, lookbackDays = 21) {
  const { pool: dedup, merges } = intake.dedupExactId(pool);
  const { flags } = intake.flagPossibleDuplicates(dedup);
  const reasons = {}; const buckets = { short: 0, medium: 0, long: 0 }; let dated = 0;
  for (const it of dedup) {
    if (it.resolutionDate) dated++;
    const e = intake.checkEligibility(it, { cutoffTimestamp: CUTOFF, aiLintPass: true });
    if (!e.eligible) { reasons[e.reason] = (reasons[e.reason] || 0) + 1; continue; }
    buckets[intake.horizonBucket(e.daysToResolution)]++;
  }
  return { raw: pool.length, afterExactDedup: dedup.length, exactMerges: merges.length, possibleDuplicateFlags: flags.length, withSourceNativeResolutionDate: dated, eligibleBuckets: buckets, rejectedByReason: reasons, shortage: Object.fromEntries(['short', 'medium', 'long'].map((b) => [b, intake.shortageAction(b, buckets[b], 5, lookbackDays).action])) }; // FIX: lookback passed through (was hardcoded 21 for the 42d block)
}

module.exports = { tsToSec, normalizeChain, SOURCE_CHAIN_REJECT_RE, setFetch, setTiming, setResumeRoot, gql, tallyGql, tallyLog, parseRetryAfter, parseRankingPage, a1Universe, a1ProposalsCreatedBetween, a2Universe, a2ProposalsCreatedBetween, diagnose, N, ACTIVITY_DAYS, EXCLUDE_RE, RANKING_PAGE, TALLY_PAGE, TALLY_MIN_INTERVAL_MS, TALLY_BACKOFF_MS, TALLY_MAX_RETRIES, RETRY_AFTER_MAX_MS, DIAG_RATE_LIMITED, RULE_TAG };

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
  if (u2.error) { report.A2 = { state: u2.error.state, detail: u2.error.detail, resumable: !!u2.resumable, tallyTransportLog: tallyLog.slice(-10) }; }
  else {
    const included = []; const fetchedInactive = [];
    report.A2.excludedGovernors = u2.excludedGovernors; report.A2.universeExhausted = u2.exhausted; if (u2.note) report.A2.note = u2.note; if (u2.resumedFrom) report.A2.resumedFromPhase = u2.resumedFrom; report.A2.pacing = { minIntervalMs: TALLY_MIN_INTERVAL_MS, backoffMs: TALLY_BACKOFF_MS, maxRetries: TALLY_MAX_RETRIES, retryAfterCapMs: RETRY_AFTER_MAX_MS, rateLimitEvents: tallyLog.filter((e) => e.kind === '429').length };
    for (const g of u2.govs.filter((g) => !EXCLUDE_RE.test(`${g.id} ${g.name}`))) {
      if (included.length >= N) break;
      const act = await a2ProposalsCreatedBetween(g.id, nowSec - ACTIVITY_DAYS * 86400, nowSec);
      if (act.error) { report.A2.error = act.error; break; }
      if (act.unparseable && act.unparseable.length) report.A2.unparseableTimestamps = (report.A2.unparseableTimestamps || []).concat(act.unparseable.map((u) => ({ governorId: g.id, ...u })));
      if (act.items.length < 1) { fetchedInactive.push({ governorId: g.id, name: g.name, organization: g._org, chain: g.chain, proposalsTotal: g.proposalStats.total, proposals90d: 0 }); continue; } // FIX: previously silent
      const p21 = act.items.filter((p) => p._createdSec >= win(21).fromSec).length;
      const p42 = act.items.filter((p) => p._createdSec >= win(42).fromSec).length;
      included.push({ governorId: g.id, name: g.name, organization: g._org, chain: g.chain, proposalsTotal: g.proposalStats.total, proposals90d: act.items.length, proposals21d: p21, proposals42d: p42, _items: act.items });
    }
    report.A2.included = included.map(({ _items, ...x }) => x);
    report.A2.fetchedInactive = fetchedInactive; // governors fetched with zero window activity — now printed, never silently skipped
    report.A2.timestampNormalization = 'RFC3339 string -> epoch seconds via tsToSec() (fix 2026-09-01)';
    report._a2Items = included.flatMap((g) => g._items.map((p) => ({ ...p, _gov: g.governorId })));
  }

  // diagnostics at 21d and 42d (frozen lookback + frozen extension)
  for (const days of [21, 42]) {
    const w = win(days);
    const pool = [];
    for (const p of report._a1Items || []) if (p.created >= w.fromSec) pool.push(mapItem('A1', { canonicalId: p.id, sourceTimestamp: p.created, sourceEnd: p.end, space: p.space && p.space.id, title: p.title }, {}));
    for (const p of report._a2Items || []) if (p._createdSec >= w.fromSec) pool.push(mapItem('A2', { canonicalId: p.onchainId || p.id, sourceTimestamp: p._createdSec, sourceEnd: tsToSec(p.end && p.end.timestamp), title: p.metadata && p.metadata.title }, { governorId: p._gov }));
    report[days === 21 ? 'diagnostic21' : 'diagnostic42'] = diagnose(pool, days);
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
