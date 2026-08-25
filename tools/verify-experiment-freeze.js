#!/usr/bin/env node
// BUILD 04 — MECHANICAL VERIFICATION OF THE STAGE 0 EXPERIMENT FREEZE ARTIFACT.
// Run from repo root. Verifies structure only -- this script never sends
// anything, never touches the witness pipeline, never mints an identifier.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'governance', 'experiments', 'stage0-public-experiment-v1');
let fail = false;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail = true; };

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

// ── 1. Schema compilation + validation ──────────────────────────────────
const freezeSchema = loadJson(path.join(ROOT, 'governance', 'schemas', 'v1', 'experiment-freeze.schema.json'));
const slateSchema = loadJson(path.join(ROOT, 'governance', 'schemas', 'v1', 'candidate-slate.schema.json'));
const validateFreeze = ajv.compile(freezeSchema);
const validateSlate = ajv.compile(slateSchema);
ok(true, 'experiment-freeze.schema.json compiles');
ok(true, 'candidate-slate.schema.json compiles');

const freeze = loadJson(path.join(DIR, 'experiment-freeze.json'));
const slate = loadJson(path.join(DIR, 'candidate-slate.json'));
ok(validateFreeze(freeze), 'experiment-freeze.json validates against schema' + (validateFreeze.errors ? ': ' + JSON.stringify(validateFreeze.errors) : ''));
ok(validateSlate(slate), 'candidate-slate.json validates against schema' + (validateSlate.errors ? ': ' + JSON.stringify(validateSlate.errors) : ''));

// ── 2. Hash cross-references ────────────────────────────────────────────
const specPath = path.join(DIR, freeze.controlling_spec.path);
ok(fs.existsSync(specPath), `controlling_spec.path exists: ${freeze.controlling_spec.path}`);
if (fs.existsSync(specPath)) ok(sha256(specPath) === freeze.controlling_spec.sha256, 'controlling_spec.sha256 matches actual file bytes');
const slatePath = path.join(DIR, freeze.candidate_slate_ref.path);
ok(fs.existsSync(slatePath), 'candidate_slate_ref.path exists');
if (fs.existsSync(slatePath)) ok(sha256(slatePath) === freeze.candidate_slate_ref.sha256, 'candidate_slate_ref.sha256 matches actual candidate-slate.json bytes');

// Spec hash must match the value ratified in the BUILD 04 authorization chain.
const EXPECTED_SPEC_SHA256 = 'ef9dab7654e48ec18867706168ea640e46910814923193674fb847160ca89ec6';
ok(freeze.controlling_spec.sha256 === EXPECTED_SPEC_SHA256, 'controlling_spec.sha256 matches the ratified v0.2 spec hash');

// ── 3. Instrument count / horizon distribution ──────────────────────────
ok(freeze.instrument_plan.total_count === 15, 'instrument_plan.total_count === 15');
const hd = freeze.instrument_plan.horizon_distribution;
ok(hd.short.count === 5 && hd.medium.count === 5 && hd.long.count === 5, 'horizon distribution is exactly 5/5/5');
ok(slate.slots.length === 15, 'candidate-slate.json has exactly 15 slots');
const byBucket = { short: 0, medium: 0, long: 0 };
for (const s of slate.slots) byBucket[s.horizon_bucket] = (byBucket[s.horizon_bucket] || 0) + 1;
ok(byBucket.short === 5 && byBucket.medium === 5 && byBucket.long === 5, 'slate slots distribute exactly 5/5/5 across buckets');

// ── 4. Thresholds match the ratified authorization exactly ─────────────
const t = freeze.thresholds;
ok(t.minimum_success.unique_substantive_external_challengers_gte === 5 && t.minimum_success.qualifying_returning_external_challengers_gte === 2, 'minimum success thresholds match ratified values (>=5, >=2)');
ok(t.strong_success.unique_substantive_external_challengers_gte === 10 && t.strong_success.qualifying_returning_external_challengers_gte === 4 && t.strong_success.instrument_coverage_pct_gte === 25, 'strong success thresholds match ratified values (>=10, >=4, >=25%)');
ok(freeze.kill_pivot_rule.day === 45 && freeze.kill_pivot_rule.early_success_permitted === false, 'day-45 kill rule present, early success structurally disallowed');
ok(freeze.primary_metric.name === 'EXTERNAL_CHALLENGER_DEPTH' && freeze.primary_metric.is_absolute_count_not_rate === true, 'primary metric is EXTERNAL_CHALLENGER_DEPTH, an absolute count, not a rate');
ok(freeze.accuracy_non_load_bearing === true, 'accuracy explicitly non-load-bearing');

// ── 5. Privacy prohibition ───────────────────────────────────────────────
const prohibited = freeze.privacy_rules.prohibited_methods;
for (const m of ['fingerprinting', 'cross_site_profiling', 'covert_identity_correlation', 'invasive_identity_collection']) {
  ok(prohibited.includes(m), `privacy_rules.prohibited_methods includes ${m}`);
}
ok(freeze.privacy_rules.authoritative_evidence_source === 'challenge_behavior', 'challenge behavior is the authoritative evidence source, not analytics');

// ── 6. Affiliation two-case timing rule present ─────────────────────────
const aff = freeze.affiliation_rules.timing_cases;
ok(aff.new_affiliation_during_experiment.exclusion_applies === 'prospective_from_actual_start_date', 'new-affiliation case is prospective-only');
ok(aff.previously_existing_discovered_later.correction_required === 'retroactive_to_true_affiliation_start', 'pre-existing-discovered-later case requires retroactive correction');
ok(aff.previously_existing_discovered_later.historical_counts_removed_silently === false, 'historical counts may never be silently removed');
ok(aff.previously_existing_discovered_later.correction_publicly_recorded === true, 'the correction must be publicly recorded');

// ── 7. Freeze-before-Instrument-#1 invariant: no FCC-I-* identifier anywhere ──
const allFiles = fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile());
let foundInstrumentId = false;
for (const f of allFiles) {
  const content = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (/FCC-I-\d{6}/.test(content)) foundInstrumentId = true;
}
ok(!foundInstrumentId, 'no FCC-I-* identifier appears anywhere in the freeze directory');
ok(freeze.instrument_id === null && freeze.not_a_capital_instrument === true, 'freeze artifact explicitly declares itself not a Capital Instrument, instrument_id null');

// ── 8. No witness-pipeline coupling ─────────────────────────────────────
// Scope: the JSON artifacts this build generates, not the imported spec
// prose (which legitimately discusses BUILD 03 by name as prior context).
const WITNESS_MODULES = ['lock-run-orchestrator', 'witness-transports', 'witness-classifier', 'lock-run-journal', 'ots-wrapper'];
const GENERATED_JSON_FILES = allFiles.filter((f) => f.endsWith('.json'));
let witnessCoupling = false;
for (const f of GENERATED_JSON_FILES) {
  const content = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const m of WITNESS_MODULES) if (content.includes(m)) witnessCoupling = true;
}
ok(!witnessCoupling, 'generated freeze/slate JSON artifacts contain no reference to any BUILD 03 witness-pipeline module');
ok(freeze.witness_publication_required === false, 'freeze artifact explicitly declares witness_publication_required: false');

// ── 9. Candidate-selection methodology honesty ──────────────────────────
ok(['RATIFIED_AND_APPLIED', 'RATIFIED_AWAITING_CUTOFF', 'AWAITING_OWNER_RESEARCH_DECISION'].includes(freeze.candidate_selection_methodology.status), 'candidate_selection_methodology.status is a declared, non-fabricated value');
if (freeze.candidate_selection_methodology.status === 'RATIFIED_AWAITING_CUTOFF') {
  const methodPath = path.join(DIR, freeze.candidate_selection_methodology.mechanical_procedure_text.document);
  ok(fs.existsSync(methodPath), 'ratified methodology document exists in the freeze directory');
  if (fs.existsSync(methodPath)) ok(sha256(methodPath) === freeze.candidate_selection_methodology.mechanical_procedure_text.sha256, 'ratified methodology document hash matches its recorded sha256');
  const EXPECTED_METHOD_SHA256 = '751953212fa1f17d0041fc6f3d36c570dae66d25c62d4ac16ed4f9849aaf5927';
  ok(freeze.candidate_selection_methodology.mechanical_procedure_text.sha256 === EXPECTED_METHOD_SHA256, 'methodology hash matches the final ratified (C-3-corrected) value');
  ok(Array.isArray(freeze.candidate_selection_methodology.named_source_list) && freeze.candidate_selection_methodology.named_source_list.length === 12, 'named source list recorded with exactly 12 entries (10 generating + 2 benchmark-only)');
  ok(freeze.freeze_status !== 'VALID', 'freeze_status is NOT VALID while intake has not actually run, even though the methodology itself is ratified');
  const cutoff = require('./lib/intake-cutoff.js').computeCutoffFromRepo(ROOT);
  ok(cutoff.authorized === false, 'live cutoff computation confirms intake is NOT currently authorized (AD-3 unverified) -- freeze correctly stays BLOCKED, not VALID');
  const slate = loadJson(path.join(DIR, 'candidate-slate.json'));
  ok(slate.slots.every((s) => s.status === 'AWAITING_CANDIDATE_SELECTION' && s.subject === null), 'candidate slate remains 100% honest placeholder -- ratifying the methodology did not itself populate any slot');
}

// ── 10. No fabricated dates ──────────────────────────────────────────────
ok(freeze.experiment_dates.start_utc === null && freeze.experiment_dates.end_utc === null, 'no calendar dates invented -- both remain null pending launch-time freeze');
ok(freeze.experiment_dates.status === 'PENDING_FROZEN_IMMEDIATELY_BEFORE_LAUNCH', 'experiment_dates.status honestly reports PENDING');

// ── 11. Frozen governing documents unaffected ───────────────────────────
try {
  require(path.join(ROOT, 'tools', 'verify-frozen-hashes.js'));
  ok(true, 'frozen document hashes re-verified (delegated to verify-frozen-hashes.js)');
} catch (e) {
  ok(false, 'frozen document hash verification failed: ' + e.message);
}

console.log(`\n=== EXPERIMENT FREEZE VERIFICATION: ${fail ? 'FAIL' : 'PASS'} ===`);
process.exit(fail ? 1 : 0);
