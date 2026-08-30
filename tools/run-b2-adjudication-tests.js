#!/usr/bin/env node
// FCC STAGE 0 — B2 CFTC ACCESS/INTERFACE ADJUDICATION TESTS (additive).
// Locks in the adjudicated findings: a bare 403 is an access restriction, not
// a credential requirement; the B2 transport identifies itself with a standard
// User-Agent on the canonical frozen surfaces; the enforcement parser extracts
// the methodology's canonical press-release ID from the live fixed structure;
// and structure changes still surface as drift.
'use strict';
const fs = require('fs');
const path = require('path');
const { ADAPTERS, READINESS, classifyTransportFailure } = require('./lib/acquisition-adapters.js');

const FIX = (f) => fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'acquisition', f), 'utf8');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

// ── adjudicated classification semantics ────────────────────────────────
ok(classifyTransportFailure(null, { statusCode: 403, headers: {} }).state === READINESS.NETWORK_BLOCKED, 'S1: bare 403 => NETWORK_BLOCKED (access restriction), never CREDENTIAL_REQUIRED');
ok(/no credential is required/.test(classifyTransportFailure(null, { statusCode: 403, headers: {} }).detail), 'S2: bare-403 detail states the adjudicated finding explicitly');
ok(classifyTransportFailure(null, { statusCode: 401, headers: {} }).state === READINESS.CREDENTIAL_REQUIRED, 'S3: 401 challenge => CREDENTIAL_REQUIRED');
ok(classifyTransportFailure(null, { statusCode: 403, headers: { 'www-authenticate': 'Bearer' } }).state === READINESS.CREDENTIAL_REQUIRED, 'S4: 403 with WWW-Authenticate => CREDENTIAL_REQUIRED');
ok(classifyTransportFailure(null, { statusCode: 403, headers: {}, bodySample: 'API rate limit exceeded' }).state === READINESS.NETWORK_BLOCKED, 'S5: rate-limit 403 classification unchanged');

// ── transport correction: same frozen surfaces, honest identification ───
{
  const req = ADAPTERS.B2.buildEnforcementRequest();
  ok(req.url === 'https://www.cftc.gov/LawRegulation/EnforcementActions/index.htm', 'T1: enforcement request targets the canonical URL of the same frozen index page');
  ok(/FCC-Stage0-readiness/.test(req.headers['user-agent']) && /^Mozilla\/5\.0 \(compatible;/.test(req.headers['user-agent']), 'T2: standard-compliant, self-identifying User-Agent (no missing-UA request, no identity spoofing)');
  ok(req.headers.accept === 'text/html', 'T3: ordinary Accept header present');
  const p2 = ADAPTERS.B2.nextEnforcementRequest(req);
  ok(p2.url.endsWith('?page=1') && ADAPTERS.B2.nextEnforcementRequest(p2).url.endsWith('?page=2'), 'T4: pagination walks the page\'s own ?page=N mechanism');
  const pr = ADAPTERS.B2.buildPressRequest({ seq: 9289, yy: 26 });
  ok(pr.url === 'https://www.cftc.gov/PressRoom/PressReleases/9289-26' && /FCC-Stage0-readiness/.test(pr.headers['user-agent']), 'T5: press-release surface pattern unchanged; UA applied there too');
}

// ── live-structure parsing implements the frozen canonical-ID rule ──────
{
  const live = ADAPTERS.B2.parseEnforcement(FIX('b2-enforcement-live.html'));
  ok(live.ok && live.items.length === 2, 'P1: live-structure fixture parses the two press-release-backed rows');
  ok(live.items[0].canonicalId === '9289-26' && live.items[1].canonicalId === '9285-26', 'P2: canonical ID is the press-release number, verbatim from the row\'s own link (frozen §1.5 rule)');
  ok(live.items[0].sourceTimestamp === '08/28/2026', 'P3: timestamp is the row\'s own date cell, verbatim');
  const again = ADAPTERS.B2.parseEnforcement(FIX('b2-enforcement-live.html'));
  ok(JSON.stringify(live) === JSON.stringify(again), 'P4: parse is deterministic');
  ok(!live.items.some((i) => /FR-2026/.test(i.canonicalId)), 'P5: rows without a canonical press-release identifier are deterministically skipped, never guessed');
}

// ── drift is still surfaced, never absorbed ─────────────────────────────
ok(ADAPTERS.B2.parseEnforcement(FIX('b2-enforcement.html')).drift === true, 'D1: a table whose rows lack the canonical identifier surfaces drift (old blind-guess fixture now correctly drifts)');
ok(ADAPTERS.B2.parseEnforcement('<html><p>redesigned</p></html>').drift === true, 'D2: tableless redesign surfaces drift');
ok(ADAPTERS.B2.parsePress('<html><h1>x</h1>no dateline</html>', { seq: 1, yy: 26 }).drift === true, 'D3: press page without the fixed h1+dateline structure surfaces drift');
{
  const pr = ADAPTERS.B2.parsePress(FIX('b2-press.html'), { seq: 9999, yy: 26 });
  ok(pr.ok && pr.exists && pr.items[0].canonicalId === '9999-26', 'D4: press parser behavior unchanged by this adjudication');
}

console.log(`\nB2 ADJUDICATION SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
