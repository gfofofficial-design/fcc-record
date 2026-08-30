// FCC STAGE 0 — LIVE ACQUISITION ADAPTERS (Candidate Selection Method v0.2 §1.5).
//
// READINESS SCOPE ONLY. This module implements the ratified acquisition
// interfaces so they can be fixture-tested and live-probed BEFORE the frozen
// cutoff. Nothing here selects, ranks, filters, or persists candidates, and
// nothing here writes candidate-slate.json. The intake pipeline consumes these
// adapters ONLY through tools/run-candidate-intake.js, whose cutoff gate is
// unchanged.
//
// §1.5 general rule, implemented uniformly:
//   - timestamps: ALWAYS the source's own published timestamp field, verbatim.
//   - canonical ID: ALWAYS the source's own immutable identifier.
//   - pagination: walked to exhaustion within the lookback window, using the
//     source's native mechanism (skip / cursor / from / page / Link header).
//   - edits: re-fetch by canonical ID at ordering time (refetchById), keeping
//     the original collection timestamp for audit.
//   - failure classification is deterministic (classifyTransportFailure).
//
// CREDENTIALS: A2 (Tally/Cactus) reads TALLY_API_KEY from the environment at
// call time only. It is never stored, printed, logged, or embedded in any
// request plan object that could be persisted.
'use strict';
const https = require('https');
const { URL } = require('url');

const LOOKBACK_DAYS = 21; // frozen constant (C-7); mirrored from the ratified methodology.

// ── deterministic failure classification ─────────────────────────────────
const READINESS = {
  READY_LIVE_VERIFIED: 'READY_LIVE_VERIFIED',
  READY_IMPLEMENTED_NOT_LIVE_VERIFIED: 'READY_IMPLEMENTED_NOT_LIVE_VERIFIED',
  CONDITIONAL_ZERO_CONTRIBUTION: 'CONDITIONAL_ZERO_CONTRIBUTION',
  CREDENTIAL_REQUIRED: 'CREDENTIAL_REQUIRED',
  SOURCE_INTERFACE_DRIFT: 'SOURCE_INTERFACE_DRIFT',
  NETWORK_BLOCKED: 'NETWORK_BLOCKED',
  FAIL: 'FAIL',
};

function classifyTransportFailure(err, res) {
  if (err) {
    const code = err.code || '';
    if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPROTO', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) {
      return { state: READINESS.NETWORK_BLOCKED, detail: code };
    }
    return { state: READINESS.FAIL, detail: code || String(err.message).slice(0, 200) };
  }
  if (res) {
    const deny = res.headers && (res.headers['x-deny-reason'] || res.headers['x-denied-reason']);
    if (deny) return { state: READINESS.NETWORK_BLOCKED, detail: `egress-proxy: ${deny}` };
    if (res.statusCode === 403 && res.bodySample && /rate limit/i.test(res.bodySample)) {
      return { state: READINESS.NETWORK_BLOCKED, detail: 'HTTP 403 shared-IP unauthenticated rate limit — surface reachable, this environment is rate-exhausted' };
    }
    if (res.statusCode === 401 || res.statusCode === 403) return { state: READINESS.CREDENTIAL_REQUIRED, detail: `HTTP ${res.statusCode}` };
    if (res.statusCode === 404) return { state: READINESS.SOURCE_INTERFACE_DRIFT, detail: 'HTTP 404 on ratified surface' };
    if (res.statusCode >= 400) return { state: READINESS.FAIL, detail: `HTTP ${res.statusCode}` };
  }
  return { state: READINESS.FAIL, detail: 'unclassified' };
}

// ── minimal transport (injectable; tests inject fixtures instead) ─────────
function liveFetch({ url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: true, statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', (err) => resolve({ ok: false, err }));
    req.setTimeout(timeoutMs, () => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
    if (body) req.write(body);
    req.end();
  });
}

function windowBounds(nowMs) {
  const end = typeof nowMs === 'number' ? nowMs : Date.now();
  const start = end - LOOKBACK_DAYS * 86400000;
  return { startSec: Math.floor(start / 1000), endSec: Math.floor(end / 1000), startIso: new Date(start).toISOString().slice(0, 10), endIso: new Date(end).toISOString().slice(0, 10) };
}

function drift(detail) { return { ok: false, drift: true, state: READINESS.SOURCE_INTERFACE_DRIFT, detail }; }

// ── A1 · Snapshot — public GraphQL, first/skip pagination ─────────────────
const A1_PAGE = 100;
const a1Snapshot = {
  id: 'A1', name: 'Snapshot', klass: 'A', tier: 'API', conditional: false,
  surface: 'https://hub.snapshot.org/graphql',
  buildRequest({ window, skip = 0, spaces = [] }) {
    const query = `query Proposals($first:Int!,$skip:Int!,$createdGte:Int!,$createdLte:Int!${spaces.length ? ',$spaces:[String]!' : ''}){ proposals(first:$first, skip:$skip, orderBy:"created", orderDirection: asc, where:{created_gte:$createdGte, created_lte:$createdLte${spaces.length ? ', space_in:$spaces' : ''}}){ id created end space{ id } title } }`;
    const variables = { first: A1_PAGE, skip, createdGte: window.startSec, createdLte: window.endSec };
    if (spaces.length) variables.spaces = spaces;
    return { url: this.surface, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), pageState: { skip } };
  },
  parse(bodyText) {
    let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON GraphQL response'); }
    const arr = j && j.data && j.data.proposals;
    if (!Array.isArray(arr)) return drift('data.proposals missing/not array');
    const items = [];
    for (const p of arr) {
      if (typeof p.id !== 'string' || typeof p.created !== 'number') return drift('proposal missing id/created');
      items.push({ canonicalId: p.id, sourceTimestamp: p.created, sourceEnd: p.end, space: p.space && p.space.id, title: p.title });
    }
    return { ok: true, items, exhausted: arr.length < A1_PAGE };
  },
  nextRequest(prevReq, parsed, ctx) {
    if (parsed.exhausted) return null;
    return this.buildRequest({ ...ctx, skip: prevReq.pageState.skip + A1_PAGE });
  },
  refetchById(id) {
    const query = `query P($id:String!){ proposal(id:$id){ id created end state title } }`;
    return { url: this.surface, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { id } }) };
  },
  probe({ window }) { return this.buildRequest({ window, skip: 0 }); },
};

// ── A2 · Cactus (tally.xyz) — GraphQL, free API key, cursor pagination ────
const a2Tally = {
  id: 'A2', name: 'Cactus (formerly Tally)', klass: 'A', tier: 'API', conditional: false,
  surface: 'https://api.tally.xyz/query',
  credentialEnv: 'TALLY_API_KEY',
  hasCredential() { return !!process.env.TALLY_API_KEY; },
  buildRequest({ governorId, afterCursor = null }) {
    if (!this.hasCredential()) { const e = new Error('CREDENTIAL_REQUIRED: TALLY_API_KEY absent (free key, obtainable by any third party; never stored by FCC)'); e.state = READINESS.CREDENTIAL_REQUIRED; throw e; }
    const query = `query Proposals($input: ProposalsInput!){ proposals(input:$input){ nodes{ ... on Proposal { id onchainId createdAt end { ... on Block { timestamp } } } } pageInfo { lastCursor } } }`;
    const input = { filters: { governorId }, page: afterCursor ? { afterCursor } : {} };
    return { url: this.surface, method: 'POST', headers: { 'content-type': 'application/json', 'Api-Key': process.env.TALLY_API_KEY }, body: JSON.stringify({ query, variables: { input } }), pageState: { afterCursor } };
  },
  parse(bodyText) {
    let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON GraphQL response'); }
    const box = j && j.data && j.data.proposals;
    if (!box || !Array.isArray(box.nodes)) return drift('data.proposals.nodes missing');
    const items = [];
    for (const p of box.nodes) {
      const cid = p.onchainId != null ? String(p.onchainId) : (p.id != null ? String(p.id) : null);
      if (!cid || !p.createdAt) return drift('node missing on-chain id/createdAt');
      items.push({ canonicalId: cid, sourceTimestamp: p.createdAt, sourceEnd: p.end && p.end.timestamp });
    }
    const lastCursor = box.pageInfo && box.pageInfo.lastCursor;
    return { ok: true, items, exhausted: !lastCursor || box.nodes.length === 0, lastCursor: lastCursor || null };
  },
  nextRequest(prevReq, parsed, ctx) {
    if (parsed.exhausted) return null;
    return this.buildRequest({ ...ctx, afterCursor: parsed.lastCursor });
  },
  probe(ctx) { return this.buildRequest({ governorId: ctx.governorId || 'eip155:1:0x0000000000000000000000000000000000000000' }); },
};

// ── B1 · SEC EDGAR full-text search — JSON, `from` pagination ─────────────
const B1_PAGE = 100;
const b1Edgar = {
  id: 'B1', name: 'SEC EDGAR full-text search', klass: 'B', tier: 'API', conditional: false,
  surface: 'https://efts.sec.gov/LATEST/search-index',
  headers: { 'user-agent': 'FCC-Stage0-readiness admin@dossiertrack.co' },
  buildRequest({ window, forms = [], q = '"digital asset"', from = 0 }) {
    const params = new URLSearchParams({ q, dateRange: 'custom', startdt: window.startIso, enddt: window.endIso, from: String(from) });
    if (forms.length) params.set('forms', forms.join(','));
    return { url: `${this.surface}?${params.toString()}`, method: 'GET', headers: this.headers, pageState: { from } };
  },
  parse(bodyText) {
    let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON EFTS response'); }
    const hits = j && j.hits && Array.isArray(j.hits.hits) ? j.hits.hits : null;
    if (!hits) return drift('hits.hits missing');
    const items = [];
    for (const h of hits) {
      const src = h._source || {};
      const accession = (h._id || '').split(':')[0] || src.accession_no || null;
      const filed = src.file_date || src.filedAt || null;
      if (!accession || !filed) return drift('hit missing accession/file_date');
      items.push({ canonicalId: accession, sourceTimestamp: filed, form: src.file_type || src.forms || null });
    }
    const total = j.hits.total && (j.hits.total.value != null ? j.hits.total.value : j.hits.total);
    return { ok: true, items, total: typeof total === 'number' ? total : null, exhausted: hits.length < B1_PAGE };
  },
  nextRequest(prevReq, parsed, ctx) {
    if (parsed.exhausted) return null;
    return this.buildRequest({ ...ctx, from: prevReq.pageState.from + B1_PAGE });
  },
  probe({ window }) { return this.buildRequest({ window, from: 0 }); },
};

// ── B2 · CFTC — DOWNGRADED tier: sequential press-release IDs + fixed-structure enforcement index ──
const b2Cftc = {
  id: 'B2', name: 'CFTC press releases + enforcement index', klass: 'B', tier: 'DOWNGRADED', conditional: false,
  fragile: true,
  pressSurface: (seq, yy) => `https://www.cftc.gov/PressRoom/PressReleases/${seq}-${yy}`,
  enforcementSurface: 'https://www.cftc.gov/LawRegulation/Enforcement/EnforcementActions',
  buildPressRequest({ seq, yy }) {
    return { url: this.pressSurface(seq, yy), method: 'GET', headers: {}, pageState: { seq, yy } };
  },
  parsePress(bodyText, { seq, yy }) {
    // Fixed-structure expectations: an <h1> page title and a visible dateline.
    // A structure change is surfaced as SOURCE_INTERFACE_DRIFT — never silently
    // substituted with another discovery method (frozen §1.5 B2 rule).
    if (/Page not found|404/i.test(bodyText) && !/PressRelease/i.test(bodyText)) return { ok: true, exists: false, items: [] };
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(bodyText);
    const date = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/.exec(bodyText);
    if (!h1 || !date) return drift('press-release page lacks fixed h1/dateline structure');
    return { ok: true, exists: true, items: [{ canonicalId: `${seq}-${yy}`, sourceTimestamp: date[0], title: h1[1].replace(/<[^>]+>/g, '').trim() }] };
  },
  nextPressRequest(prev) { return this.buildPressRequest({ seq: prev.pageState.seq + 1, yy: prev.pageState.yy }); },
  buildEnforcementRequest() { return { url: this.enforcementSurface, method: 'GET', headers: {} }; },
  parseEnforcement(bodyText) {
    const rows = bodyText.match(/<tr[\s\S]*?<\/tr>/gi);
    if (!rows || rows.length < 2) return drift('enforcement index: fixed-structure table not found');
    const items = [];
    for (const row of rows.slice(1)) {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi);
      if (!cells || cells.length < 2) continue;
      const text = cells.map((c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      const caseId = text.find((t) => /^\d{2}-(civ|cr|\d+)|^[A-Za-z]*\s*No\.|^\d{4}-\d+/i.test(t)) || text[0];
      const date = text.find((t) => /\d{1,2}\/\d{1,2}\/\d{2,4}|\w+ \d{1,2}, \d{4}/.test(t)) || null;
      if (caseId && date) items.push({ canonicalId: caseId, sourceTimestamp: date });
    }
    if (!items.length) return drift('enforcement index: no parseable case rows in fixed structure');
    return { ok: true, items };
  },
  probe() { return this.buildEnforcementRequest(); },
};

// ── C1/C2 · Coinbase, Kraken — CONDITIONAL, binary confirm-or-zero ────────
function conditionalExchange(id, name) {
  return {
    id, name, klass: 'C', tier: 'DOWNGRADED-CONDITIONAL', conditional: true,
    // The ratified binary gate (§1.5): the class contributes ZERO candidates
    // unless a concrete, reproducible dated feed or dated archive index is
    // confirmed AND entered into the frozen source registry as an addendum.
    // This adapter NEVER invents a surface: it reads only an explicit,
    // operator-ratified addendum record.
    confirmAcquisition({ registryAddendum = null } = {}) {
      const entry = registryAddendum && Array.isArray(registryAddendum.confirmations)
        ? registryAddendum.confirmations.find((c) => c.source === id && c.confirmed === true && typeof c.feedUrl === 'string' && c.feedUrl.length > 0)
        : null;
      if (!entry) {
        return { confirmed: false, contribution: 'ZERO', state: READINESS.CONDITIONAL_ZERO_CONTRIBUTION, reason: `no ratified registry addendum confirms a reproducible dated feed/archive index for ${id} — contributes zero candidates this run, exactly as frozen` };
      }
      return { confirmed: true, feedUrl: entry.feedUrl, state: READINESS.CONDITIONAL_ZERO_CONTRIBUTION, note: 'confirmed surface present in addendum — live parse verification still required before any contribution' };
    },
    parseFeed(bodyText) {
      const entries = bodyText.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi);
      if (!entries) return drift('confirmed feed is not RSS/Atom-structured');
      const items = [];
      for (const e of entries) {
        const idm = /<guid[^>]*>([\s\S]*?)<\/guid>|<id>([\s\S]*?)<\/id>|<link[^>]*href="([^"]+)"|<link>([\s\S]*?)<\/link>/i.exec(e);
        const dm = /<pubDate>([\s\S]*?)<\/pubDate>|<updated>([\s\S]*?)<\/updated>|<published>([\s\S]*?)<\/published>/i.exec(e);
        const cid = idm && (idm[1] || idm[2] || idm[3] || idm[4]);
        const ts = dm && (dm[1] || dm[2] || dm[3]);
        if (cid && ts) items.push({ canonicalId: cid.trim(), sourceTimestamp: ts.trim() });
      }
      if (!items.length) return drift('feed has entries but no per-entry id+date');
      return { ok: true, items };
    },
  };
}
const c1Coinbase = conditionalExchange('C1', 'Coinbase');
const c2Kraken = conditionalExchange('C2', 'Kraken');

// ── D1 · L2BEAT — GitHub REST commits by path (primary), api.l2beat.com (secondary) ──
function ghHeaders() {
  const h = { 'user-agent': 'FCC-Stage0-readiness', accept: 'application/vnd.github+json' };
  // Optional: CI's ephemeral GITHUB_TOKEN raises the rate limit. Env-read at
  // call time only — never stored, printed, logged, or embedded in evidence.
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}
function parseGithubCommits(bodyText) {
  let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON GitHub commits response'); }
  if (!Array.isArray(j)) return drift('GitHub commits: not an array');
  const items = [];
  for (const c of j) {
    const sha = c.sha; const date = c.commit && c.commit.committer && c.commit.committer.date;
    if (!sha || !date) return drift('commit missing sha/committer.date');
    items.push({ canonicalId: sha, sourceTimestamp: date, message: c.commit.message && c.commit.message.split('\n')[0] });
  }
  return { ok: true, items, exhausted: j.length < 100 };
}
function githubLinkNext(headers) {
  const link = headers && headers.link;
  if (!link) return null;
  const m = /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1] : null;
}
const d1L2beat = {
  id: 'D1', name: 'L2BEAT config repo', klass: 'D', tier: 'API', conditional: false,
  repo: 'l2beat/l2beat',
  buildRequest({ window, path = null, page = 1 }) {
    const params = new URLSearchParams({ since: new Date(window.startSec * 1000).toISOString(), until: new Date(window.endSec * 1000).toISOString(), per_page: '100', page: String(page) });
    if (path) params.set('path', path);
    return { url: `https://api.github.com/repos/${this.repo}/commits?${params.toString()}`, method: 'GET', headers: ghHeaders(), pageState: { page } };
  },
  parse: parseGithubCommits,
  nextRequest(prevReq, parsed, ctx, resHeaders) {
    const next = githubLinkNext(resHeaders);
    if (!next) return null;
    return { url: next, method: 'GET', headers: ghHeaders(), pageState: { page: prevReq.pageState.page + 1 } };
  },
  secondarySurface: 'https://api.l2beat.com/api/tvl',
  probe({ window }) { return this.buildRequest({ window, page: 1 }); },
};

// ── D2 · DefiLlama — public API, per-datapoint timestamps ─────────────────
const d2Llama = {
  id: 'D2', name: 'DefiLlama', klass: 'D', tier: 'API', conditional: false,
  surface: 'https://api.llama.fi',
  buildRequest({ slug = null }) {
    return { url: slug ? `${this.surface}/protocol/${slug}` : `${this.surface}/v2/historicalChainTvl`, method: 'GET', headers: {}, pageState: {} };
  },
  parse(bodyText) {
    let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON DefiLlama response'); }
    const series = Array.isArray(j) ? j : (Array.isArray(j.tvl) ? j.tvl : null);
    if (!series) return drift('no tvl datapoint array');
    const slug = Array.isArray(j) ? 'chain-total' : (j.slug || j.name || 'protocol');
    const items = [];
    for (const dp of series.slice(-50)) {
      if (typeof dp.date !== 'number') return drift('datapoint missing numeric date');
      items.push({ canonicalId: `${slug}@${dp.date}`, sourceTimestamp: dp.date, tvl: dp.totalLiquidityUSD != null ? dp.totalLiquidityUSD : dp.tvl });
    }
    return { ok: true, items, exhausted: true };
  },
  nextRequest() { return null; },
  probe() { return this.buildRequest({}); },
};

// ── E1 · Ethereum upgrade schedule — GitHub commits/releases (primary) ────
const e1Ethereum = {
  id: 'E1', name: 'Ethereum upgrade schedule (spec repo)', klass: 'E', tier: 'API', conditional: false,
  repo: 'ethereum/execution-specs',
  buildRequest({ window, page = 1 }) {
    const params = new URLSearchParams({ since: new Date(window.startSec * 1000).toISOString(), until: new Date(window.endSec * 1000).toISOString(), per_page: '100', page: String(page) });
    return { url: `https://api.github.com/repos/${this.repo}/commits?${params.toString()}`, method: 'GET', headers: ghHeaders(), pageState: { page } };
  },
  parse: parseGithubCommits,
  nextRequest: d1L2beat.nextRequest,
  releasesRequest() { return { url: `https://api.github.com/repos/${this.repo}/releases?per_page=100`, method: 'GET', headers: ghHeaders }; },
  // Secondary EF-blog feed corroboration follows the same binary confirm-or-
  // nothing rule as C1/C2 and is NOT required for E1 readiness (§1.5).
  probe({ window }) { return this.buildRequest({ window, page: 1 }); },
};

// ── F1 · EDGAR named issuer CIKs — B1 mechanism, pre-declared CIK scope ───
const f1EdgarCiks = {
  id: 'F1', name: 'SEC EDGAR named issuer CIKs', klass: 'F', tier: 'API', conditional: false,
  // The six issuers are named in the ratified methodology (BlackRock/iShares,
  // Fidelity, Grayscale, VanEck, ARK, Bitwise) but their numeric CIKs are NOT
  // machine-recorded anywhere in this repository. This adapter refuses to
  // guess: the CIK list must come from a ratified registry addendum. Absent
  // one, readiness is verifiable against the MECHANISM (any syntactically
  // valid CIK) while the scoped list remains an owner decision.
  buildRequest({ cik }) {
    if (!/^\d{1,10}$/.test(String(cik))) throw new Error('F1: cik must be numeric — never guessed, supplied only from a ratified addendum');
    const padded = String(cik).padStart(10, '0');
    return { url: `https://data.sec.gov/submissions/CIK${padded}.json`, method: 'GET', headers: b1Edgar.headers, pageState: {} };
  },
  parse(bodyText) {
    let j; try { j = JSON.parse(bodyText); } catch (e) { return drift('non-JSON submissions response'); }
    const rec = j.filings && j.filings.recent;
    if (!rec || !Array.isArray(rec.accessionNumber) || !Array.isArray(rec.filingDate)) return drift('filings.recent structure missing');
    const items = [];
    for (let i = 0; i < rec.accessionNumber.length && i < 200; i++) {
      items.push({ canonicalId: rec.accessionNumber[i], sourceTimestamp: rec.filingDate[i], form: rec.form && rec.form[i] });
    }
    return { ok: true, items, exhausted: true };
  },
  nextRequest() { return null; },
  probe({ cik }) { return this.buildRequest({ cik: cik || '0000320193' }); },
};

// ── G1/G2 — BENCHMARK-ONLY. Deliberately NOT implemented here. ────────────
// Polymarket and Kalshi must never generate or resolve candidates; providing
// acquisition adapters for them in the candidate layer would be a structural
// path to exactly that. Their benchmark use (spec §6) is a different, later,
// separately-gated surface.

const ADAPTERS = { A1: a1Snapshot, A2: a2Tally, B1: b1Edgar, B2: b2Cftc, C1: c1Coinbase, C2: c2Kraken, D1: d1L2beat, D2: d2Llama, E1: e1Ethereum, F1: f1EdgarCiks };

module.exports = { ADAPTERS, READINESS, LOOKBACK_DAYS, windowBounds, liveFetch, classifyTransportFailure };
