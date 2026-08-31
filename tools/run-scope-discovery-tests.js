#!/usr/bin/env node
// A1/A2 SCOPE DISCOVERY — structural tests (no network): rule mechanics, frozen
// bucket arithmetic for vote-end resolution dates, and no-write guarantees.
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const intake = require('./lib/candidate-intake.js');
const { mapItem } = require('./lib/live-acquisition-provider.js');
const ROOT = path.join(__dirname, '..');
const SLATE = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1', 'candidate-slate.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before = sha(SLATE);
let passed = 0, failed = 0; const ok = (c, l) => { if (c) { passed++; console.log('PASS ' + l); } else { failed++; console.error('FAIL ' + l); } };
const src = fs.readFileSync(path.join(__dirname, 'diagnose-a1a2-scope.js'), 'utf8');
ok(/N = 25/.test(src) && /ACTIVITY_DAYS = 90/.test(src), 'R1: rule constants N=25 and 90d activity are fixed in code, not arguments');
ok(/Polymarket\|Kalshi/.test(src) && /GFOF\|Galactic Federation\|Dossier\|Federation Capital\|FCC/.test(src), 'R2: doctrine + benchmark exclusions are in the mechanical filter');
ok(!/writeFileSync|memory_write|addendum-002\.json['"]\)/.test(src.replace(/\/\/.*$/gm, '').replace(/_DRAFT_NOTICE[^\n]*/g, '')), 'R3: tool contains no write call — stdout only');
{ const uses = (src.match(/TALLY_API_KEY/g) || []).length;
  const allowed = (src.match(/!process\.env\.TALLY_API_KEY\b/g) || []).length + (src.match(/'Api-Key': process\.env\.TALLY_API_KEY\b/g) || []).length + (src.match(/TALLY_API_KEY absent/g) || []).length;
  ok(uses === allowed && uses > 0, 'R4: every TALLY_API_KEY reference is a presence check, the request header, or the absence message — never printed or serialized'); }
// frozen horizon arithmetic for governance vote-end dates
const CUT = '2026-08-31T00:00:00.000Z'; const d = (days) => new Date(Date.parse(CUT) + days * 86400000).toISOString();
const mk = (end) => mapItem('A1', { canonicalId: 'x' + end, sourceTimestamp: Date.parse(CUT) / 1000 - 86400, sourceEnd: Date.parse(end) / 1000, space: 's.eth', title: 't' }, {});
ok(intake.checkEligibility(mk(d(6)), { cutoffTimestamp: CUT, aiLintPass: true }).eligible && intake.horizonBucket(6) === 'short', 'H1: a vote ending 6d after cutoff is eligible and SHORT');
ok(!intake.checkEligibility(mk(d(2)), { cutoffTimestamp: CUT, aiLintPass: true }).eligible, 'H2: a vote ending 2d after cutoff fails MIN_FILING_LAG=3 — frozen, not relaxed');
ok(!intake.checkEligibility(mk(d(-1)), { cutoffTimestamp: CUT, aiLintPass: true }).eligible, 'H3: a vote that already ended is ineligible');
ok(intake.horizonBucket(20) === 'medium' && intake.horizonBucket(50) === 'long', 'H4: MEDIUM needs a vote still open 15–45d after cutoff; LONG 46–90d — structural constraint on vote-end dates');
ok(intake.shortageAction('long', 0, 5, 42).action === 'WAIT_AND_RERUN', 'H5: after the 42d extension the frozen next action is WAIT_AND_RERUN (7d), nothing else');
ok(sha(SLATE) === before, 'W1: slate untouched by this suite');
console.log(`\nSCOPE DISCOVERY SUITE: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
