#!/usr/bin/env node
// FCC STAGE 0 — REGISTRY ADDENDUM + CUTOFF DISPOSITION TESTS (additive).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ADAPTERS, loadRegistryAddenda, READINESS } = require('./lib/acquisition-adapters.js');
const { computeCutoffFromRepo } = require('./lib/intake-cutoff.js');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };

// ── real-repo addenda load and bind exactly as ratified ─────────────────
const add = loadRegistryAddenda(ROOT);
ok(add.confirmations.some((c) => c.source === 'C2' && c.confirmed === true && c.feedUrl === 'https://blog.kraken.com/feed'), 'A1: C2 ratification loads with exactly the pinned feed URL');
ok(add.confirmations.some((c) => c.source === 'C1' && c.confirmed === false), 'A2: C1 remains explicitly unconfirmed in the addendum');
{
  const c2 = ADAPTERS.C2.confirmAcquisition({ registryAddendum: { confirmations: add.confirmations } });
  ok(c2.confirmed === true && c2.feedUrl === 'https://blog.kraken.com/feed', 'A3: C2 adapter confirms ONLY via the ratified addendum surface');
  const c1 = ADAPTERS.C1.confirmAcquisition({ registryAddendum: { confirmations: add.confirmations } });
  ok(c1.confirmed !== true && c1.contribution === 'ZERO', 'A4: C1 stays zero-contribution — no cross-source leak');
}
ok(add.f1Ciks.length === 6 && add.f1Ciks.every((e) => /^\d{10}$/.test(e.cik) && /sec\.gov/.test(e.sec_surface)), 'A5: F1 addendum carries exactly six 10-digit CIKs, each pinned to a sec.gov surface');
ok(['IBIT', 'FBTC', 'GBTC', 'HODL', 'ARKB', 'BITB'].every((t) => add.f1Ciks.some((e) => e.ticker === t)), 'A6: all six ratified tickers present');
{
  let allBuild = true;
  for (const e of add.f1Ciks) { try { ADAPTERS.F1.buildRequest({ cik: e.cik }); } catch (err) { allBuild = false; } }
  ok(allBuild, 'A7: every ratified CIK is accepted by the F1 mechanism (no guessing path exercised)');
  let threw = false; try { ADAPTERS.F1.buildRequest({ cik: 'IBIT' }); } catch (err) { threw = /never guessed/.test(err.message); }
  ok(threw, 'A8: non-numeric input still refused — the guess-guard is intact');
}

// ── malformed addenda are ignored entirely ──────────────────────────────
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fcc-add-'));
  const dir = path.join(d, 'governance', 'experiments', 'stage0-public-experiment-v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source-registry-addendum-001.json'), JSON.stringify({ artifact_class: 'SOMETHING_ELSE', confirmations: [{ source: 'C2', confirmed: true, feedUrl: 'https://evil.example/feed' }] }));
  fs.writeFileSync(path.join(dir, 'f1-cik-addendum-001.json'), JSON.stringify({ artifact_class: 'SOURCE_REGISTRY_ADDENDUM', issuer_ciks: [{ ticker: 'X', cik: '123', sec_surface: 'https://example.com' }] }));
  fs.writeFileSync(path.join(dir, 'source-registry-addendum-999.json'), '{not json');
  const bad = loadRegistryAddenda(d);
  ok(bad.confirmations.length === 0 && bad.f1Ciks.length === 0, 'B1: wrong artifact_class, short CIKs, non-sec surfaces, and broken JSON are all ignored');
  fs.writeFileSync(path.join(dir, 'source-registry-addendum-002.json'), JSON.stringify({ artifact_class: 'SOURCE_REGISTRY_ADDENDUM', confirmations: [{ source: 'C2', confirmed: true, feedUrl: 'http://insecure.example/feed' }] }));
  ok(loadRegistryAddenda(d).confirmations.length === 0, 'B2: non-https feed URLs are rejected');
}

// ── cutoff disposition invariants ───────────────────────────────────────
{
  const draftPath = path.join(ROOT, 'tools', 'templates', 'intake-blocked-2026-08-31T000000Z.draft.json');
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const real = computeCutoffFromRepo(ROOT, Date.parse('2026-08-30T12:00:00Z'));
  ok(draft.cutoff_timestamp === real.cutoffTimestamp, 'C1: draft INTAKE_BLOCKED event carries EXACTLY the frozen computed cutoff — never an invented one');
  ok(draft.status === 'INTAKE_BLOCKED' && /_DRAFT_NOTICE/.test(Object.keys(draft).join(',')), 'C2: draft is explicitly marked prepared-not-recorded');
  ok(!fs.existsSync(path.join(ROOT, 'governance', 'gates', 'intake-blocked-2026-08-31T000000Z.json')), 'C3: nothing is prematurely recorded under governance/gates/');
  ok(real.reached === false && real.authorized === false, 'C4: before the cutoff instant the formula still refuses authorization');
  const after = computeCutoffFromRepo(ROOT, Date.parse('2026-08-31T00:00:00Z'));
  ok(after.reached === true, 'C5: the formula, and only the formula, flips at exactly 2026-08-31T00:00:00Z');
}

console.log(`\nADDENDUM + DISPOSITION SUITE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
