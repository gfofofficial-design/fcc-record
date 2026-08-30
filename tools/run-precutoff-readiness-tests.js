#!/usr/bin/env node
// FCC STAGE 0 — PRE-CUTOFF READINESS TEST SUITE (additive).
// Proves the CI guard's post-cutoff branches BEFORE the cutoff arrives, and
// the adapters' deterministic failure behavior. No network access here.
'use strict';
const { guardDecision } = require('./ci-intake-guard.js');
const { ADAPTERS, READINESS, windowBounds, classifyTransportFailure } = require('./lib/acquisition-adapters.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

// ── CI guard: all three cases, pure ─────────────────────────────────────
ok(guardDecision({ authorized: false, runnerExit: 2 }).pass === true, 'G1: Case A pass — pre-cutoff runner refusal (exit 2) is the required state');
ok(guardDecision({ authorized: false, runnerExit: 0 }).pass === false, 'G2: Case A fail-closed — pre-cutoff runner NOT refusing fails the build');
ok(guardDecision({ authorized: false, runnerExit: 1 }).pass === false, 'G3: Case A fail-closed — pre-cutoff unexpected error fails the build');
{
  const b = guardDecision({ authorized: true, runnerExit: null, slateShaNow: 'S', frozenSlateSha: 'S', slatePopulated: false, authRecordPresent: false });
  ok(b.pass === true && b.caseId === 'B', 'G4: Case B pass — after cutoff, untouched slate is a PASS and intake is never executed by CI');
}
ok(guardDecision({ authorized: true, runnerExit: null, slateShaNow: 'X', frozenSlateSha: 'S', slatePopulated: true, authRecordPresent: false }).pass === false, 'G5: Case C fail-closed — populated slate without an execution-authorization record fails');
ok(guardDecision({ authorized: true, runnerExit: null, slateShaNow: 'X', frozenSlateSha: 'S', slatePopulated: true, authRecordPresent: true }).pass === true, 'G6: Case C pass — populated slate is lawful only under an explicit authorization record');
ok(guardDecision({ authorized: true, runnerExit: null, slateShaNow: 'S', frozenSlateSha: 'S', slatePopulated: false, authRecordPresent: true }).caseId === 'B', 'G7: an authorization record alone never makes CI execute anything — untouched slate stays Case B');

// ── deterministic failure classification ────────────────────────────────
ok(classifyTransportFailure({ code: 'ENOTFOUND' }).state === READINESS.NETWORK_BLOCKED, 'F1: DNS refusal classifies NETWORK_BLOCKED');
ok(classifyTransportFailure({ code: 'ETIMEDOUT' }).state === READINESS.NETWORK_BLOCKED, 'F2: timeout classifies NETWORK_BLOCKED');
ok(classifyTransportFailure(null, { statusCode: 401, headers: {} }).state === READINESS.CREDENTIAL_REQUIRED, 'F3a: 401 (authentication challenge) classifies CREDENTIAL_REQUIRED');
ok(classifyTransportFailure(null, { statusCode: 403, headers: { 'www-authenticate': 'Basic' } }).state === READINESS.CREDENTIAL_REQUIRED, 'F3b: 403 WITH an authentication challenge classifies CREDENTIAL_REQUIRED');
ok(classifyTransportFailure(null, { statusCode: 403, headers: {} }).state === READINESS.NETWORK_BLOCKED, 'F3c: bare 403 is an access restriction, NEVER proof of a credential requirement (B2 adjudication)');
ok(classifyTransportFailure(null, { statusCode: 404, headers: {} }).state === READINESS.SOURCE_INTERFACE_DRIFT, 'F4: 404 on a ratified surface classifies SOURCE_INTERFACE_DRIFT');
ok(classifyTransportFailure(null, { statusCode: 200, headers: { 'x-deny-reason': 'host_not_allowed' } }).state === READINESS.NETWORK_BLOCKED, 'F5: egress-proxy denial header classifies NETWORK_BLOCKED');

// ── adapter drift is surfaced, never silently absorbed ──────────────────
ok(ADAPTERS.A1.parse('{"data":{}}').drift === true, 'D1: Snapshot shape change surfaces drift');
ok(ADAPTERS.B1.parse('{"unexpected":1}').drift === true, 'D2: EDGAR shape change surfaces drift');
ok(ADAPTERS.B2.parseEnforcement('<html><p>redesigned page</p></html>').drift === true, 'D3: CFTC enforcement redesign surfaces SOURCE_INTERFACE_DRIFT (frozen: never substitute another discovery method)');
ok(ADAPTERS.B2.parsePress('<html><h1>x</h1>no dateline</html>', { seq: 1, yy: 26 }).drift === true, 'D4: CFTC press page without fixed dateline structure surfaces drift');
ok(ADAPTERS.D2.parse('{"nope":true}').drift === true, 'D5: DefiLlama shape change surfaces drift');

// ── conditional and no-guessing guards ──────────────────────────────────
ok(ADAPTERS.C1.confirmAcquisition({}).contribution === 'ZERO', 'C1a: Coinbase with no ratified addendum contributes ZERO — exactly as frozen');
ok(ADAPTERS.C2.confirmAcquisition({ registryAddendum: { confirmations: [{ source: 'C2', confirmed: true, feedUrl: 'https://example.test/feed' }] } }).confirmed === true, 'C1b: an explicit ratified addendum is the ONLY path to a confirmed surface');
ok(ADAPTERS.C1.confirmAcquisition({ registryAddendum: { confirmations: [{ source: 'C2', confirmed: true, feedUrl: 'https://example.test/feed' }] } }).contribution === 'ZERO', 'C1c: another source\'s confirmation never leaks across (C1 stays ZERO)');
{
  let threw = false; try { ADAPTERS.F1.buildRequest({ cik: 'BlackRock' }); } catch (e) { threw = /never guessed/.test(e.message); }
  ok(threw, 'C2a: F1 refuses non-numeric CIKs — issuer CIKs are never guessed');
}
{
  let state = null; try { ADAPTERS.A2.buildRequest({ governorId: 'x' }); } catch (e) { state = e.state; }
  const expect = process.env.TALLY_API_KEY ? null : READINESS.CREDENTIAL_REQUIRED;
  ok(process.env.TALLY_API_KEY ? state === null : state === expect, 'C3a: A2 without TALLY_API_KEY fails as CREDENTIAL_REQUIRED, never fabricates a request');
}

// ── §1.5 general-rule invariants on fixtures ────────────────────────────
const fs = require('fs'); const path = require('path');
const FIX = (f) => fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'acquisition', f), 'utf8');
{
  const a1 = ADAPTERS.A1.parse(FIX('a1-snapshot.json'));
  ok(a1.ok && a1.items.every((i) => typeof i.sourceTimestamp === 'number'), 'S1: A1 timestamps are the source\'s own created field, verbatim');
  const gh = ADAPTERS.E1.parse(FIX('github-commits.json'));
  ok(gh.ok && gh.items[0].canonicalId.length === 40, 'S2: E1 canonical ID is the immutable commit SHA');
  const w = windowBounds(Date.parse('2026-08-29T00:00:00Z'));
  ok(w.endSec - w.startSec === 21 * 86400, 'S3: lookback window is exactly the frozen 21 days');
}

console.log(`\nPRE-CUTOFF READINESS SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
