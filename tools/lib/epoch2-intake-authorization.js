// FCC STAGE 0 — EPOCH 2 (v0.3) INTAKE EXECUTION AUTHORIZATION GATE (REV6).
//
// Layered, fail-closed, append-only:
//   1. evaluateEpoch2GovernancePrerequisites  — UNCONDITIONAL public-byte integrity
//      law. Verifies every governance fact from real bytes + schemas, with NO
//      dependence on an intake-execution-002 record. READY_FOR_OWNER_AUTHORIZATION
//      may only be derived from this passing.
//   2. evaluateEpoch2ExecutionPreconditions   — reuses (1), then adds the final
//      owner-authorization record, supervision, live readiness and single-use checks.
//   3. validateEpoch2CompletionMarker         — a marker EXISTING blocks rerun; only a
//      marker that VALIDATES (bound to selected artifact + lineage) means complete.
//   4. evaluateEpoch2ForProcess               — production/process-bound entry: supervision
//      only via the exact CLI flag + exact owner env marker; readiness only via a
//      machine-produced readiness result. Nothing here executes anything.
//   5. decideEpoch2GuardCase                  — the CI GUARD CASE E2 decision, used by
//      tools/ci-intake-guard.js and tested directly.
// Descriptive fields (cutoff_rule.input_2.value/state) are never read; top-level
// ratified_at is the sole v0.3 temporal input (recorded clarification).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { computeEpoch2CutoffFromRepo, RATIFIED_AT_V2_RE } = require('./intake-cutoff.js');
const { supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE } = require('./intake-authorization.js');
const PROBE = require('./epoch2-readiness-probe.js');

const HEX64 = /^[0-9a-f]{64}$/;
const UTC_SEC_RE = RATIFIED_AT_V2_RE;                       // YYYY-MM-DDTHH:MM:SSZ
const UTC_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/; // cutoff form
const PLACEHOLDER_RE = /TO_BE_SET|TO_BE_PINNED|COMPUTED_BY_FORMULA|PLACEHOLDER|INSERT_FULL_UTC|NOT_YET|NOT COMPUTED|NOT_COMPUTED/i;
// Words that can never appear in any string of a FINAL authority object (R5-2).
const NON_AUTHORITY_RE = /\bDRAFT\b|\bPENDING\b|\bREVOKED\b|\bDENIED\b|\bUNSIGNED\b|\bUNAUTHORIZED\b|\bNOT[_ ]AUTHORIZED\b/i;
// RECORDED Epoch 2 pre-cutoff freeze — exact bytes and the exact public commits it carries
// (commit 66dc2f6 "Record blocked Epoch 2 experiment freeze"). Any other freeze fails before READY.
const RECORDED_FREEZE_SHA = 'f2db0398983e125580a80fadd5e281170d950be9863770b260da78c63cf684fe';
const RECORDED_COMMITS = {
  ratification_v2: '254fd2e82cddf7a84a7e3a8cdff423bd958822e4',
  supersession: 'e986b0e8aee077650c871ec51ba490ebf6c2c607',
  clarification: '2c0cdc39454ce1fad213fae2341e7ff618667e85',
  verified_against_public_main: '96920ebac95d2b48c7470282863e789b893ff00a',
  epoch_1_closure: '35c5ae93d452b8943e0f3cedecbda89aea6ae9c6',
};
// Execution infrastructure reviewed in PR #5 and recorded at its merge commit.
// These are the exact bytes at execution_head. The gate verifies the five named
// components and every additional critical-tooling pin against disk before it can
// return READY_FOR_OWNER_AUTHORIZATION or accept a final 002 (R5-6).
const EXECUTION_INFRASTRUCTURE = Object.freeze({
  selected_slate_schema: { path: 'governance/schemas/v2/candidate-slate.v2.selected.schema.json', sha256: '4e4f08db961fde928188af8f7058b978c82eec44f17f22071f4d0e8f20acbd0d' },
  v2_discovery_runner: { path: 'tools/run-epoch2-candidate-intake.js', sha256: 'cafc66017130589a885b2ae9407b40e700a9ff641dba6e5444d1e638c26379ee' },
  deterministic_selection: { path: 'tools/lib/epoch2-selection.js', sha256: '1804375734d5a76a465d54050d0803adcff288108a6dcbe990352e8c5050ebcd' },
  selected_slate_writer: { path: 'tools/lib/epoch2-selected-slate-writer.js', sha256: '139d94537ceaffbe0567ea2e7de4c4cf3a42dd256810066dbd3030ebac4423ee' },
  completion_marker_writer_verifier: { path: 'tools/lib/epoch2-completion.js', sha256: '990d71f2b6910eaa3403e99a63143b66c29b52718951463dcfabd607acc0a3a5' },
  execution_critical_tooling_hashes: {
    'tools/verify-acquisition-readiness.js': 'd3dcf45406aa3c5deee65865d32201c8e4d76a236d9f04379affb0ae0e33695e',
    'tools/lib/acquisition-adapters.js': '889c4f44753997f798b929e6ebb6ddfc0534be0832326222458a3563ee79ac3e',
    'tools/lib/intake-cutoff.js': 'ba1a56e1cfffbfbffdccaed1162dc37b5b34d1194b7cc54e61f549da19957807',
    'tools/lib/intake-authorization.js': '8ff3173fadf218457734177f3e2eaf92d1bcbe5eca67c037ad064d96dbd445ff',
    'tools/lib/epoch2-readiness-probe.js': '62d0e03fae05fdd0d50be974319162ed9ad7b60199107388260aa186843108bc',
    'tools/lib/intake-final-write.js': '30df101ce371a10e7bee4a69a44055e7dae58efc800a1e30b398e259cc322675',
    'tools/lib/live-acquisition-provider.js': '07c21feaafefd0905a0de08d11e598afe3f698f7dff549e3ae1ec422135e7036',
    'tools/ci-intake-guard.js': 'd44d40895e34c00cd718bf66e76a79e8b2c3c0064a3633cca5b270b81133c22b',
  },
  execution_head: 'a0e3eb2507b91fdbb76faa28169a9cacaa30297c',
});
function executionInfrastructureStatus(infra) {
  const i = infra || EXECUTION_INFRASTRUCTURE; const missing = [];
  for (const k of ['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier']) if (!i[k] || !HEX64.test(i[k].sha256 || '')) missing.push(k);
  if (!i.execution_critical_tooling_hashes || typeof i.execution_critical_tooling_hashes !== 'object' || !Object.values(i.execution_critical_tooling_hashes).length || !Object.values(i.execution_critical_tooling_hashes).every((v) => HEX64.test(v || ''))) missing.push('execution_critical_tooling_hashes');
  if (!/^[0-9a-f]{40}$/.test(i.execution_head || '')) missing.push('execution_head');
  return { complete: missing.length === 0, missing };
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function verifyExecutionInfrastructureFiles(repoRoot, infra = EXECUTION_INFRASTRUCTURE) {
  const problems = [];
  const named = ['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier'];
  const pins = named.map((k) => [infra[k] && infra[k].path, infra[k] && infra[k].sha256, k]);
  for (const [rel, expected, label] of pins) {
    if (typeof rel !== 'string' || !HEX64.test(expected || '')) { problems.push(label + ': pin incomplete'); continue; }
    try { if (sha256(fs.readFileSync(path.join(repoRoot, rel))) !== expected) problems.push(label + ': bytes differ from recorded pin'); }
    catch (e) { problems.push(label + ': pinned file missing'); }
  }
  for (const [rel, expected] of Object.entries(infra.execution_critical_tooling_hashes || {})) {
    if (!HEX64.test(expected || '')) { problems.push(rel + ': critical-tooling pin incomplete'); continue; }
    try { if (sha256(fs.readFileSync(path.join(repoRoot, rel))) !== expected) problems.push(rel + ': bytes differ from recorded pin'); }
    catch (e) { problems.push(rel + ': pinned file missing'); }
  }
  return { valid: problems.length === 0, problems };
}
// Format AND real calendar time: the string must round-trip through Date exactly.
const isRealUtcSec = (s) => UTC_SEC_RE.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().replace(/\.\d{3}Z$/, 'Z') === s;
const isRealUtcMs = (s) => UTC_MS_RE.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString() === s;
const CANONICAL_CUTOFF_RULE_ID = 'EPOCH2_CUTOFF_RULE_CANONICAL_V03';

// Canonical paths (repo-relative). Pins must match these paths AND these bytes.
const EXP_DIR = 'governance/experiments/stage0-public-experiment-v1';
const P = {
  method: `${EXP_DIR}/FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_3.md`,
  spec: `${EXP_DIR}/FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_3.md`,
  ratification: `${EXP_DIR}/candidate-selection-ratification.v2.json`,
  freeze: `${EXP_DIR}/experiment-freeze.v2.json`,
  slate: `${EXP_DIR}/candidate-slate.v2.json`,
  addendum: `${EXP_DIR}/source-registry-addendum-002.json`,
  selected: `${EXP_DIR}/candidate-slate.v2.selected.json`,
  clarification: 'governance/evidence/v03-ratification-input2-clarification-001.json',
  supersession: 'governance/gates/methodology-supersession-001.json',
  epoch1Terminal: 'governance/gates/stage0-epoch1-infeasibility-001.json',
  auth002: 'governance/gates/intake-execution-002.json',
  marker002: 'governance/gates/intake-execution-002.completed.json',
  freezeSchema: 'governance/schemas/v2/experiment-freeze.v2.schema.json',
  slateSchema: 'governance/schemas/v2/candidate-slate.v2.schema.json',
  selectedSchema: 'governance/schemas/v2/candidate-slate.v2.selected.schema.json',
};
// Ratified Epoch 2 controls (Method v0.3 §4A′ / Spec v0.3; owner-confirmed constants).
const EPOCH2_CONTROLS = { total_count: 15, H1_band_max: 7, H2_band_min: 2, H3_non_short_min: 5, S1_class_max: 7, S2_min_classes: 3, S3_governance_vote_max: 7 };
const OWNER_AUTH_STATE = 'OWNER_AUTHORIZED_EXECUTION';
const OWNER_AUTH_SCOPE = 'EXACTLY ONE supervised Epoch 2 candidate-intake execution';

// ---------------------------------------------------------------- schema reuse
// Same validator stack as tools/verify-schemas.js (ajv 2020 + formats); never a weaker copy.
// Recorded schema identities (public bytes at schemas/v2; F-1 naming carried as recorded).
// Freeze/slate input schemas were pinned at commit 2a24e57; the selected-slate
// output schema was reviewed and pinned at the Phase 1 merge execution_head.
// A weakened schema that keeps its identity strings refuses on sha256. The selected-
// slate schema was separately reviewed in PR #5 and is now pinned by exact bytes
// and identity here (RV4-3/RV4-4).
const SCHEMA_IDENTITY = {
  [P.freezeSchema]: { $id: 'https://fcc-record/governance/schemas/v2/experiment-freeze.schema.json', $schema: 'https://json-schema.org/draft/2020-12/schema', sha256: '99f95dcd439360c0d76853df89cedf6a0398be952c6ecbec9ae65a17992c177b' },
  [P.slateSchema]: { $id: 'https://fcc-record/governance/schemas/v2/candidate-slate.schema.json', $schema: 'https://json-schema.org/draft/2020-12/schema', sha256: '362e12266e0ee8a644d4c23399a441e3d4dd89214015f7b463e68f0b36b6112f' },
  [P.selectedSchema]: { $id: 'https://fcc-record/governance/schemas/v2/candidate-slate.v2.selected.schema.json', $schema: 'https://json-schema.org/draft/2020-12/schema', sha256: EXECUTION_INFRASTRUCTURE.selected_slate_schema.sha256 },
};
function freshAjv() { const Ajv2020 = require('ajv/dist/2020'); const addFormats = require('ajv-formats'); const a = new Ajv2020({ strict: false, allErrors: true }); addFormats(a); return a; }
function validateAgainstSchemaFile(repoRoot, schemaRel, doc) {
  const sp = path.join(repoRoot, schemaRel);
  if (!fs.existsSync(sp)) return [`schema missing: ${schemaRel}`];
  const idn = SCHEMA_IDENTITY[schemaRel];
  if (idn && idn.unpinned) return [`schema not recorded/pinned: ${schemaRel} — no file at this path carries authority until it is separately recorded and hash-pinned in this module`];
  const bytes = fs.readFileSync(sp);
  if (idn && sha256(bytes) !== idn.sha256) return [`schema bytes differ from the recorded pin: ${schemaRel}`];
  let schema; try { schema = JSON.parse(bytes.toString('utf8')); } catch (e) { return [`schema unreadable: ${schemaRel}`]; }
  if (idn && (schema.$id !== idn.$id || schema.$schema !== idn.$schema)) return [`schema identity mismatch: ${schemaRel}`];
  let v; try { v = freshAjv().compile(schema); } catch (e) { return [`schema does not compile: ${schemaRel}: ${e.message}`]; }
  if (doc === null || doc === undefined) return ['document missing'];
  return v(doc) ? [] : (v.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

// Fail-closed wrapper: the recorded resolver throws on malformed inputs; a throw
// here becomes an UNDEFINED cutoff (refusal), never an exception path.
function safeCutoff(repoRoot, nowMs) {
  try { return computeEpoch2CutoffFromRepo(repoRoot, nowMs); }
  catch (e) { return { ruleId: 'EPOCH2_CUTOFF_RULE_CANONICAL_V03', defined: false, reached: false, epoch2IntakeAuthorized: false, reason: 'EPOCH 2 CUTOFF UNDEFINED — resolver input unreadable: ' + e.message }; }
}

// ---------------------------------------------------------------- repo reading
function readRepoFacts(repoRoot, infrastructure) {
  const abs = (rel) => path.join(repoRoot, rel);
  const sha = (rel) => { try { return sha256(fs.readFileSync(abs(rel))); } catch (e) { return null; } };
  const json = (rel) => { if (!fs.existsSync(abs(rel))) return { exists: false, doc: null, parseError: null }; try { return { exists: true, doc: JSON.parse(fs.readFileSync(abs(rel), 'utf8')), parseError: null }; } catch (e) { return { exists: true, doc: null, parseError: e.message }; } };
  const gates = abs('governance/gates');
  const gateNames = fs.existsSync(gates) ? fs.readdirSync(gates) : [];
  // Authorization records + EVERY possible Epoch 2 authorization claimant (RV4-7):
  // any JSON in governance/gates whose content claims the Epoch 2 authorization
  // namespace, or whose filename does, is loaded so the evaluator can fail closed on it.
  const authRecords = [];
  // R5-7 boundaries: a claimant is a file whose CONTENT claims the Epoch 2 intake namespace
  // (id 002; epoch 2 + intake gate; canonical scope; canonical marker path) or whose NAME
  // does. A generic GOVERNANCE_EXECUTION_AUTHORIZATION for another gate/epoch is NOT one.
  const NAME_CLAIM = /intake-execution-002|epoch-?2.*intake|intake.*epoch-?2/i;
  for (const n of gateNames.filter((n) => /\.json$/.test(n) && !/\.completed\.json$/.test(n))) {
    const canonical = /^intake-execution-\d{3}\.json$/.test(n);
    const r = json(`governance/gates/${n}`);
    const d = r.doc;
    const contentClaim = !!(d && typeof d === 'object' && (d.authorization_id === 'intake-execution-002' || (d.gate === 'CANDIDATE_INTAKE_EXECUTION' && d.epoch === 2) || (d.scope && (d.scope.what_is_authorized === OWNER_AUTH_SCOPE || d.scope.completion_marker_path === P.marker002))));
    const nameClaim = NAME_CLAIM.test(n);
    const lawfulName = n === 'intake-execution-001.json' || n === 'intake-execution-002.json';
    if (canonical || contentClaim || nameClaim) authRecords.push({ name: n, record: d, parseError: r.parseError, claimant: !lawfulName && (canonical || contentClaim || nameClaim) });
  }
  const expAbs = abs(EXP_DIR);
  const expNames = fs.existsSync(expAbs) ? fs.readdirSync(expAbs) : [];
  const selectedLookalikes = expNames.filter((n) => /selected/i.test(n) && n !== path.basename(P.selected));
  return {
    sha: { method: sha(P.method), spec: sha(P.spec), ratification: sha(P.ratification), freeze: sha(P.freeze), slate: sha(P.slate), clarification: sha(P.clarification), supersession: sha(P.supersession), epoch1Terminal: sha(P.epoch1Terminal), addendum: sha(P.addendum), auth002: sha(P.auth002), selected: sha(P.selected) },
    exists: { method: fs.existsSync(abs(P.method)), spec: fs.existsSync(abs(P.spec)), slate: fs.existsSync(abs(P.slate)), freeze: fs.existsSync(abs(P.freeze)) },
    ratification: json(P.ratification), freeze: json(P.freeze), slate: json(P.slate), supersession: json(P.supersession), clarification: json(P.clarification), epoch1Terminal: json(P.epoch1Terminal), addendum: json(P.addendum), marker: json(P.marker002), selected: json(P.selected),
    freezeSchemaErrors: (d) => validateAgainstSchemaFile(repoRoot, P.freezeSchema, d),
    slateSchemaErrors: (d) => validateAgainstSchemaFile(repoRoot, P.slateSchema, d),
    selectedSchemaErrors: (d) => validateAgainstSchemaFile(repoRoot, P.selectedSchema, d),
    authRecords, selectedLookalikes,
    infrastructure: infrastructure || EXECUTION_INFRASTRUCTURE,
    infrastructureIntegrity: infrastructure ? { valid: true, problems: [] } : verifyExecutionInfrastructureFiles(repoRoot, EXECUTION_INFRASTRUCTURE),
    selectedExists: fs.existsSync(abs(P.selected)),
    blockedRecordsPresent: gateNames.some((n) => /^intake-blocked-.*\.json$/.test(n)),
    markerExists: fs.existsSync(abs(P.marker002)),
  };
}

// ------------------------------------------------ 1. GOVERNANCE PREFLIGHT (pure)
// Inputs are facts about bytes/records; no 002 record is consulted. Every check is
// unconditional. Returns { passed, failures, facts } where facts carries the
// byte-verified hashes downstream layers must reuse (single copy of the law).
function evaluateEpoch2GovernancePrerequisites({ cutoff, repo }) {
  const F = []; const facts = { rd19b4: 'ZERO', addendumMustBePinned: false };
  // 1 cutoff — v2 resolver only, defined and reached
  if (!cutoff || cutoff.ruleId !== 'EPOCH2_CUTOFF_RULE_CANONICAL_V03') F.push('P1: cutoff not produced by the Epoch 2 canonical resolver');
  else if (cutoff.defined !== true) F.push('P1: Epoch 2 cutoff undefined');
  else if (cutoff.reached !== true) F.push('P1: Epoch 2 cutoff ' + cutoff.cutoffTimestamp + ' not reached');
  const cut = cutoff && cutoff.defined === true ? cutoff.cutoffTimestamp : null;
  // 4 ratification.v2 (top-level facts only)
  const rat = repo.ratification;
  const ratDoc = rat.exists && rat.doc ? rat.doc : null;
  if (!rat.exists) F.push('P4: candidate-selection-ratification.v2.json missing (v1 ratification is never a substitute)');
  else if (!ratDoc) F.push('P4: candidate-selection-ratification.v2.json malformed: ' + rat.parseError);
  else {
    if (ratDoc.ratified !== true) F.push('P4: ratification.v2 ratified !== true');
    if (!UTC_SEC_RE.test(ratDoc.ratified_at || '')) F.push('P4: ratification.v2 ratified_at not full ISO-8601 UTC with seconds');
  }
  const ratPins = Object.fromEntries(((ratDoc && ratDoc.ratifies) || []).map((x) => [x.document, x.sha256]));
  // 2/3 Method + Spec: actual bytes == ratified pins
  const mPin = ratPins['FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_3.md'], sPin = ratPins['FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_3.md'];
  if (!repo.exists.method) F.push('P2: Method v0.3 missing'); else if (!HEX64.test(mPin || '') || repo.sha.method !== mPin) F.push('P2: Method v0.3 bytes do not match the ratified pin');
  if (!repo.exists.spec) F.push('P3: Spec v0.3 missing'); else if (!HEX64.test(sPin || '') || repo.sha.spec !== sPin) F.push('P3: Spec v0.3 bytes do not match the ratified pin');
  // 8 freeze.v2: exists, schema-valid, lineage coherent
  const fz = repo.freeze; const fzDoc = fz.exists && fz.doc ? fz.doc : null;
  if (!fz.exists) F.push('P8: experiment-freeze.v2.json missing');
  else if (!fzDoc) F.push('P8: experiment-freeze.v2.json malformed: ' + fz.parseError);
  else if (repo.sha.freeze !== RECORDED_FREEZE_SHA) F.push('P8: experiment-freeze.v2.json bytes differ from the RECORDED Epoch 2 pre-cutoff freeze ' + RECORDED_FREEZE_SHA.slice(0, 12) + '… — a locally modified or substituted freeze carries no authority');
  else {
    const se = repo.freezeSchemaErrors(fzDoc); if (se.length) F.push('P8: experiment-freeze.v2.json fails schema v2: ' + se.slice(0, 3).join('; '));
    if (fzDoc.freeze_version !== 2 || fzDoc.epoch !== 2) F.push('P8: freeze.v2 freeze_version/epoch not 2');
    if (fzDoc.freeze_status !== 'BLOCKED') F.push('P8: freeze.v2 must remain the BLOCKED pre-intake snapshot (any other status requires a versioned post-execution artifact, never a mutation)');
    const csm = fzDoc.candidate_selection_methodology || {};
    if (csm.status !== 'RATIFIED_AWAITING_CUTOFF') F.push('P8: freeze.v2 csm.status not RATIFIED_AWAITING_CUTOFF');
    const fc = csm.frozen_epoch2_cutoff || {};
    if (!cut || fc.value !== cut || fc.rule_id !== 'EPOCH2_CUTOFF_RULE_CANONICAL_V03') F.push('P8: freeze.v2 frozen_epoch2_cutoff does not equal the canonical resolver cutoff');
    if (!/authorizes neither discovery nor intake/.test(fc.cutoff_is_not_authorization || '')) F.push('P8: freeze.v2 lacks the cutoff-is-not-authorization statement');
    const rp = csm.recorded_public_pins || {};
    const pin = (k) => rp[k] && rp[k].sha256;
    // RV4-5: every recorded public pin must carry the exact canonical PATH as well as
    // the hash, and every public_commit present must be a full 40-hex commit.
    const PIN_PATHS = { method_v0_3: P.method, spec_v0_3: P.spec, ratification_v2: P.ratification, clarification: P.clarification, supersession: P.supersession };
    for (const [k, canon] of Object.entries(PIN_PATHS)) {
      if (!rp[k] || rp[k].path !== canon) F.push(`P8: freeze.v2 recorded_public_pins.${k}.path is not the canonical ${canon}`);
      if (rp[k] && 'public_commit' in rp[k] && !/^[0-9a-f]{40}$/.test(rp[k].public_commit || '')) F.push(`P8: freeze.v2 recorded_public_pins.${k}.public_commit is not a full 40-hex commit`);
    }
    for (const k of ['ratification_v2', 'supersession', 'clarification']) {
      if (rp[k] && !('public_commit' in rp[k])) F.push(`P8: freeze.v2 recorded_public_pins.${k} lacks its public_commit`);
      else if (rp[k] && rp[k].public_commit !== RECORDED_COMMITS[k]) F.push(`P8: freeze.v2 recorded_public_pins.${k}.public_commit is not the known public commit ${RECORDED_COMMITS[k].slice(0, 12)}…`);
    }
    if (rp.verified_against_public_main !== RECORDED_COMMITS.verified_against_public_main) F.push('P8: freeze.v2 verified_against_public_main is not the known public commit');
    if (!(fzDoc.supersedes && fzDoc.supersedes.epoch_1_closure_public_commit === RECORDED_COMMITS.epoch_1_closure)) F.push('P8: freeze.v2 epoch_1_closure_public_commit is not the known Epoch 1 closure commit');
    facts.freezeCutoffRule = csm.cutoff_gate_ref || null;
    if (pin('method_v0_3') !== repo.sha.method || pin('method_v0_3') !== mPin) F.push('P8: freeze.v2 Method pin incoherent with bytes/ratification');
    if (pin('spec_v0_3') !== repo.sha.spec || pin('spec_v0_3') !== sPin) F.push('P8: freeze.v2 Spec pin incoherent with bytes/ratification');
    if (!HEX64.test(pin('ratification_v2') || '') || pin('ratification_v2') !== repo.sha.ratification) F.push('P8: freeze.v2 ratification pin does not match ratification.v2 bytes');
    if (rp.ratification_v2 && ratDoc && rp.ratification_v2.ratified_at !== ratDoc.ratified_at) F.push('P8: freeze.v2 pinned ratified_at differs from ratification.v2');
    // 5 supersession
    const sup = repo.supersession;
    if (!sup.exists) F.push('P5: methodology-supersession-001.json missing');
    else if (!sup.doc) F.push('P5: methodology-supersession-001.json malformed');
    else {
      if (!HEX64.test(pin('supersession') || '') || pin('supersession') !== repo.sha.supersession) F.push('P5: supersession bytes do not match the freeze public pin');
      const succ = sup.doc.supersededBy && sup.doc.supersededBy.candidate_selection_method && sup.doc.supersededBy.candidate_selection_method.sha256;
      const prev = sup.doc.supersedes && sup.doc.supersedes.candidate_selection_method && sup.doc.supersedes.candidate_selection_method.sha256;
      if (succ !== repo.sha.method) F.push('P5: supersession does not name Method v0.3 (current bytes) as successor');
      if (!HEX64.test(prev || '') || prev === repo.sha.method) F.push('P5: supersession does not identify a distinct superseded v0.2 methodology');
      facts.supersededMethodSha = prev || null;
    }
    // 6 clarification
    const cl = repo.clarification;
    if (!cl.exists) F.push('P6: v03-ratification-input2-clarification-001.json missing');
    else if (!HEX64.test(pin('clarification') || '') || pin('clarification') !== repo.sha.clarification) F.push('P6: clarification bytes do not match the freeze public pin');
    else if (!cl.doc || cl.doc.stale_field_classification == null || cl.doc.stale_field_classification.classification !== 'STALE_PRE_RECORDING_DESCRIPTIVE_FIELDS') F.push('P6: clarification does not carry the STALE_PRE_RECORDING_DESCRIPTIVE_FIELDS classification');
    // 7 Epoch 1 terminal record
    const e1pin = fzDoc.supersedes && fzDoc.supersedes.epoch_1_terminal_record_sha256;
    const e1path = fzDoc.supersedes && fzDoc.supersedes.epoch_1_terminal_record;
    if (!repo.epoch1Terminal.exists) F.push('P7: Epoch 1 terminal record missing');
    else if (!HEX64.test(e1pin || '') || e1pin !== repo.sha.epoch1Terminal || e1path !== P.epoch1Terminal) F.push('P7: Epoch 1 terminal record bytes/path do not match the freeze pin');
    // controls
    const ip = fzDoc.instrument_plan || {}; const sc = ip.slate_control || {};
    if (ip.total_count !== EPOCH2_CONTROLS.total_count || ['H1_band_max', 'H2_band_min', 'H3_non_short_min', 'S1_class_max', 'S2_min_classes', 'S3_governance_vote_max'].some((k) => sc[k] !== EPOCH2_CONTROLS[k])) F.push('P8: freeze.v2 N/H/S controls differ from the ratified Epoch 2 constants');
    // 9 slate: exists, schema-valid, pristine, hash+path == freeze candidate_slate_ref
    const sl = repo.slate; const slDoc = sl.exists && sl.doc ? sl.doc : null;
    const ref = fzDoc.candidate_slate_ref || {};
    if (!sl.exists) F.push('P9: candidate-slate.v2.json missing');
    else if (!slDoc) F.push('P9: candidate-slate.v2.json malformed: ' + sl.parseError);
    else {
      const se2 = repo.slateSchemaErrors(slDoc); if (se2.length) F.push('P9: candidate-slate.v2.json fails schema v2: ' + se2.slice(0, 3).join('; '));
      if (!HEX64.test(ref.sha256 || '') || ref.sha256 !== repo.sha.slate) F.push('P9: candidate-slate.v2.json bytes do not match freeze candidate_slate_ref.sha256');
      if (ref.path !== 'candidate-slate.v2.json' || ref.slate_version !== 2) F.push('P9: freeze candidate_slate_ref path/version not the frozen v2 slate path');
      const slots = Array.isArray(slDoc.slots) ? slDoc.slots : [];
      const nulls = slots.reduce((a, s) => a + ['horizon_bucket', 'source_class', 'observable_type'].filter((k) => s && s[k] === null).length, 0);
      if (slDoc.all_slots_populated !== false || slDoc.total_slots !== 15 || slots.length !== 15 || nulls !== 45 || !slots.every((s) => s && s.status === 'AWAITING_CANDIDATE_SELECTION'))
        F.push('P9: candidate-slate.v2.json is not the pristine EMPTY pre-intake shell (15 slots, 45 null fields, all AWAITING_CANDIDATE_SELECTION, all_slots_populated:false)');
    }
  }
  // 10 Addendum 002 — PROVENANCE, not self-assertion (RV4-8). A file's own ratified_at
  // proves nothing about pre-cutoff PUBLIC existence. The only append-only pre-cutoff
  // proof this gate accepts is a recorded pin inside the immutable pre-cutoff
  // experiment-freeze.v2 (recorded_public_pins.addendum_002 with path + sha256). The
  // recorded freeze carries no such pin, so for Epoch 2 the addendum is mechanically
  // ABSENT / RD-19b4 ZERO regardless of any file that appears later. Any pinned-by-002
  // addendum is refused downstream (I). Incoherent files still refuse.
  // R5-4/RV4-8: the recorded freeze bytes are anchored above and carry NO addendum pin.
  // Therefore Addendum 002 is PERMANENTLY ABSENT for Epoch 2 and RD-19b4 is permanently
  // ZERO: no later local file, backdated timestamp or modified freeze can activate it.
  // A future epoch may decide prospectively. Incoherent files still refuse.
  const ad = repo.addendum;
  facts.addendumMustBePinned = false; facts.rd19b4 = 'ZERO'; facts.addendumNote = 'PERMANENTLY ABSENT for Epoch 2 (recorded pre-cutoff freeze pins no addendum)';
  if (ad.exists) {
    if (!ad.doc) F.push('P10: source-registry-addendum-002.json exists but is malformed');
    else {
      const ratified = ad.doc.activation ? ad.doc.activation.ratified === true : ad.doc.ratified === true;
      const at = (ad.doc.activation && ad.doc.activation.ratified_at) || ad.doc.ratified_at || null;
      if (ratified && !isRealUtcSec(at)) F.push('P10: ratified addendum-002 lacks a real full-UTC ratified_at — incoherent, refuse');
    }
  }
  // 12 premature or lookalike selected artifact (RV4-1): before lawful supervised
  // execution the canonical selected path MUST NOT exist and no lookalike may exist.
  if (repo.selectedExists) F.push('P12: candidate-slate.v2.selected.json exists before a validated completion sequence — refuse (reconciliation required)');
  if (repo.selectedLookalikes && repo.selectedLookalikes.length) F.push('P12: noncanonical selected-slate lookalike artifact(s) present: ' + repo.selectedLookalikes.join(', '));
  // 13 execution infrastructure (R5-6): the transaction must be able to FINISH lawfully.
  const infra = executionInfrastructureStatus(repo.infrastructure);
  facts.infrastructure = repo.infrastructure || EXECUTION_INFRASTRUCTURE; facts.infrastructureComplete = infra.complete && repo.infrastructureIntegrity && repo.infrastructureIntegrity.valid === true;
  if (!infra.complete) F.push('P13: EXECUTION_INFRASTRUCTURE_INCOMPLETE — not yet recorded/hash-pinned: ' + infra.missing.join(', '));
  else if (!repo.infrastructureIntegrity || repo.infrastructureIntegrity.valid !== true) F.push('P13: EXECUTION_INFRASTRUCTURE_DRIFT — ' + ((repo.infrastructureIntegrity && repo.infrastructureIntegrity.problems) || ['integrity result absent']).join(', '));
  // 11 completion / blockers
  if (repo.markerExists) F.push('P11: Epoch 2 completion marker exists — the single execution is spent or requires reconciliation');
  if (repo.blockedRecordsPresent) F.push('P11: intake-blocked record present');
  facts.cutoffTimestamp = cut; facts.sha = repo.sha; facts.ratifiedAt = ratDoc ? ratDoc.ratified_at : null; facts.freezeSha = repo.sha.freeze;
  return { passed: F.length === 0, failures: F, facts };
}

// ------------------------------------------------ final-record validator (MV-1)
const REQUIRED_PIN_PATHS = { methodology: P.method, experiment_spec: P.spec, experiment_freeze: P.freeze, pre_intake_candidate_slate: P.slate, supersession_record: P.supersession, epoch_1_terminal_record: P.epoch1Terminal };
function hasPlaceholder(v) {
  if (typeof v === 'string') return PLACEHOLDER_RE.test(v);
  if (v && typeof v === 'object') return Object.values(v).some(hasPlaceholder);
  return false;
}
const FINAL_TOP_KEYS = ['artifact_class', 'not_a_capital_instrument', 'gate', 'authorization_id', 'authorized', 'epoch', 'predecessor', 'scope', 'owner_authorization', 'pins', 'recorded_at', 'owner_ratification_required'];
const FINAL_PIN_KEYS = ['methodology', 'experiment_spec', 'experiment_freeze', 'pre_intake_candidate_slate', 'supersession_record', 'epoch_1_terminal_record', 'source_registry_addendum_002', 'frozen_cutoff', 'cutoff_rule_ref', 'execution_infrastructure'];
const INFRA_PIN_KEYS = ['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier', 'execution_critical_tooling_hashes', 'execution_head'];
function stringsOf(v, out = []) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsOf(x, out)); return out; }
// CLOSED deterministic authority object (R5-2): exact key sets everywhere, no status /
// revocation / duplicate-authority fields, no non-authority words in any string.
// `infra` defaults to the PRODUCTION infrastructure constant (incomplete until recorded);
// a final record can only be shape-valid when its infrastructure pins equal a COMPLETE
// recorded set (R5-6).
function validateAuthorizationShapeV2(a, name, infra) {
  const pr = [];
  const I = infra || EXECUTION_INFRASTRUCTURE;
  if (name !== undefined && name !== 'intake-execution-002.json') pr.push('filename must be exactly intake-execution-002.json');
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['record missing'];
  const extra = Object.keys(a).filter((k) => !FINAL_TOP_KEYS.includes(k)); if (extra.length) pr.push('unexpected top-level field(s): ' + extra.join(','));
  const missing = FINAL_TOP_KEYS.filter((k) => !(k in a)); if (missing.length) pr.push('missing required field(s): ' + missing.join(','));
  if ('_DRAFT_NOTICE' in a) pr.push('_DRAFT_NOTICE present — a draft (renamed or not) is never authoritative');
  if (a.artifact_class !== 'GOVERNANCE_EXECUTION_AUTHORIZATION') pr.push('artifact_class');
  if (a.not_a_capital_instrument !== true) pr.push('not_a_capital_instrument must be true');
  if (a.gate !== 'CANDIDATE_INTAKE_EXECUTION') pr.push('gate');
  if (a.authorization_id !== 'intake-execution-002') pr.push('authorization_id');
  if (a.authorized !== true) pr.push('authorized must be true');
  if (a.epoch !== 2) pr.push('epoch must be 2');
  if (a.owner_ratification_required !== false) pr.push('owner_ratification_required must be false in a final record');
  if (!isRealUtcSec(a.recorded_at)) pr.push('recorded_at must be a real full ISO-8601 UTC calendar timestamp with seconds');
  const pd = a.predecessor;
  if (!pd || typeof pd !== 'object') pr.push('predecessor object missing');
  else {
    const pk = Object.keys(pd).filter((k) => !['record', 'state'].includes(k)); if (pk.length) pr.push('unexpected predecessor field(s): ' + pk.join(','));
    if (pd.record !== 'governance/gates/intake-execution-001.json') pr.push('predecessor.record must be exactly governance/gates/intake-execution-001.json');
    if (!(typeof pd.state === 'string' && /preserved/i.test(pd.state) && /unspent/i.test(pd.state) && /unusable/i.test(pd.state) && /epoch 2/i.test(pd.state))) pr.push('predecessor.state must describe 001 as preserved, unspent and unusable for Epoch 2');
  }
  const oa = a.owner_authorization;
  if (!oa || typeof oa !== 'object') pr.push('owner_authorization object missing');
  else {
    const ok_ = Object.keys(oa).filter((k) => !['state', 'authorized_at', 'scope'].includes(k)); if (ok_.length) pr.push('unexpected owner_authorization field(s): ' + ok_.join(','));
    if (oa.state !== OWNER_AUTH_STATE) pr.push('owner_authorization.state must be ' + OWNER_AUTH_STATE);
    if (!isRealUtcSec(oa.authorized_at)) pr.push('owner_authorization.authorized_at must be a real full ISO-8601 UTC calendar timestamp with seconds');
    if (oa.scope !== OWNER_AUTH_SCOPE) pr.push('owner_authorization.scope must be exactly: ' + OWNER_AUTH_SCOPE);
  }
  const sc = a.scope;
  if (!sc || typeof sc !== 'object') pr.push('scope object missing');
  else {
    const sk = Object.keys(sc).filter((k) => !['what_is_authorized', 'single_use', 'completion_marker_path'].includes(k)); if (sk.length) pr.push('unexpected scope field(s): ' + sk.join(','));
    if (sc.single_use !== true) pr.push('scope.single_use must be true');
    if (sc.what_is_authorized !== OWNER_AUTH_SCOPE) pr.push('scope.what_is_authorized must be exactly: ' + OWNER_AUTH_SCOPE);
    if (sc.completion_marker_path !== P.marker002) pr.push('scope.completion_marker_path must be the canonical ' + P.marker002);
  }
  const p = a.pins && typeof a.pins === 'object' ? a.pins : null;
  if (!p) pr.push('pins object missing');
  else {
    const xk = Object.keys(p).filter((k) => !FINAL_PIN_KEYS.includes(k)); if (xk.length) pr.push('unexpected pins field(s): ' + xk.join(','));
    if ('cutoff_rule' in p) pr.push('pins.cutoff_rule (copied descriptive object) is not permitted in a final record — use cutoff_rule_ref');
    for (const [k, canon] of Object.entries(REQUIRED_PIN_PATHS)) {
      const o = p[k];
      if (!o || typeof o !== 'object') { pr.push('pins.' + k + ' missing'); continue; }
      const allowed = k === 'epoch_1_terminal_record' ? ['path', 'sha256', 'public_commit'] : ['path', 'sha256'];
      const ek = Object.keys(o).filter((x) => !allowed.includes(x)); if (ek.length) pr.push('unexpected pins.' + k + ' field(s): ' + ek.join(','));
      if (!HEX64.test(o.sha256 || '')) pr.push('pins.' + k + '.sha256 must be 64-hex');
      if (o.path !== canon) pr.push('pins.' + k + '.path must be the canonical ' + canon);
      if (k === 'epoch_1_terminal_record' && 'public_commit' in o && o.public_commit !== RECORDED_COMMITS.epoch_1_closure) pr.push('pins.epoch_1_terminal_record.public_commit must be the known Epoch 1 closure commit');
    }
    const ap = p.source_registry_addendum_002;
    if (!ap || typeof ap !== 'object') pr.push('pins.source_registry_addendum_002 missing');
    else {
      const ak = Object.keys(ap).filter((x) => !['path', 'sha256', 'required'].includes(x)); if (ak.length) pr.push('unexpected pins.source_registry_addendum_002 field(s): ' + ak.join(','));
      if (ap.required !== false) pr.push('pins.source_registry_addendum_002.required must be false');
      if (ap.path !== P.addendum) pr.push('pins.source_registry_addendum_002.path must be the canonical ' + P.addendum);
      if (ap.sha256 !== 'ABSENT') pr.push('pins.source_registry_addendum_002.sha256 must be exactly ABSENT for Epoch 2 (permanently absent; no hash may activate it)');
    }
    if (!isRealUtcMs(p.frozen_cutoff)) pr.push('pins.frozen_cutoff must be a real millisecond-UTC cutoff literal (not a template/placeholder)');
    const cr = p.cutoff_rule_ref;
    if (!cr || typeof cr !== 'object') pr.push('pins.cutoff_rule_ref missing');
    else {
      const ck = Object.keys(cr).filter((x) => !['rule_id', 'source_path', 'source_sha256', 'source_field', 'computed_cutoff'].includes(x)); if (ck.length) pr.push('unexpected pins.cutoff_rule_ref field(s): ' + ck.join(','));
      if (cr.rule_id !== CANONICAL_CUTOFF_RULE_ID) pr.push('cutoff_rule_ref.rule_id');
      if (cr.source_path !== P.freeze) pr.push('cutoff_rule_ref.source_path must be ' + P.freeze);
      if (cr.source_sha256 !== RECORDED_FREEZE_SHA) pr.push('cutoff_rule_ref.source_sha256 must be the recorded freeze sha');
      if (cr.source_field !== 'candidate_selection_methodology.cutoff_gate_ref') pr.push('cutoff_rule_ref.source_field');
      if (!isRealUtcMs(cr.computed_cutoff) || cr.computed_cutoff !== p.frozen_cutoff) pr.push('cutoff_rule_ref.computed_cutoff must equal pins.frozen_cutoff and be a real instant');
    }
    const ei = p.execution_infrastructure;
    if (!ei || typeof ei !== 'object') pr.push('pins.execution_infrastructure missing — no final 002 can be shape-valid until the execution infrastructure is recorded and pinned');
    else {
      const ik = Object.keys(ei).filter((x) => !INFRA_PIN_KEYS.includes(x)); if (ik.length) pr.push('unexpected pins.execution_infrastructure field(s): ' + ik.join(','));
      const st = executionInfrastructureStatus(I);
      if (!st.complete) pr.push('execution infrastructure not yet recorded/pinned in this gate (' + st.missing.join(',') + ') — record is unfinalizable');
      else {
        for (const k of ['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier']) if (!ei[k] || ei[k].path !== I[k].path || ei[k].sha256 !== I[k].sha256) pr.push('pins.execution_infrastructure.' + k + ' does not equal the recorded pin');
        if (JSON.stringify(ei.execution_critical_tooling_hashes) !== JSON.stringify(I.execution_critical_tooling_hashes)) pr.push('pins.execution_infrastructure.execution_critical_tooling_hashes differ from the recorded set');
        if (ei.execution_head !== I.execution_head) pr.push('pins.execution_infrastructure.execution_head is not the recorded execution HEAD');
      }
    }
  }
  for (const s of stringsOf(a)) { if (PLACEHOLDER_RE.test(s)) { pr.push('placeholder/stale wording in final record: ' + s.slice(0, 40)); break; } }
  for (const s of stringsOf(a)) { if (NON_AUTHORITY_RE.test(s)) { pr.push('non-authority word in final record: ' + s.slice(0, 40)); break; } }
  return pr;
}

// ------------------------------------------------ 2. EXECUTION PRECONDITIONS (pure)
function evaluateEpoch2ExecutionPreconditions({ preflight, authRecords, supervisedMode, readinessAggregate, nowMs }) {
  const evalNow = typeof nowMs === 'number' ? nowMs : Date.now();
  const failures = [];
  const pf = preflight || { passed: false, failures: ['P0: preflight missing'], facts: {} };
  for (const f of pf.failures) failures.push(f);
  const cut = pf.facts.cutoffTimestamp; const sha = pf.facts.sha || {};
  // B — exactly one final, shape-valid 002; no conflicting Epoch 2 authorization anywhere
  const recs = authRecords || [];
  const named = recs.filter((r) => r.name === 'intake-execution-002.json');
  const infra = pf.facts.infrastructure;
  const shaped = named.filter((r) => r.record && validateAuthorizationShapeV2(r.record, r.name, infra).length === 0);
  if (shaped.length !== 1) {
    const why = named.length ? '; problems: ' + (named[0].parseError ? 'malformed JSON' : validateAuthorizationShapeV2(named[0].record, named[0].name, infra).slice(0, 4).join(' | ')) : '';
    failures.push(`B: exactly one FINAL shape-valid intake-execution-002.json required (found ${shaped.length}${why})`);
    if (recs.some((r) => r.name === 'intake-execution-001.json')) failures.push('B: intake-execution-001.json can never satisfy Epoch 2 (v0.2 lineage; PRESERVED/UNSPENT/UNUSABLE — no fallback)');
  }
  for (const r of recs) {
    if (r.name === 'intake-execution-002.json' || r.name === 'intake-execution-001.json') continue;
    if (r.claimant)
      failures.push('B: conflicting/noncanonical Epoch 2 authorization claimant ' + r.name + (r.parseError ? ' (malformed — fails closed)' : ''));
  }
  const rec = shaped.length === 1 ? shaped[0].record : null; const pins = rec ? rec.pins : {};
  if (rec) {
    // C–F/N — record pins must equal the PREFLIGHT-VERIFIED bytes (single copy of the law)
    const expect = { methodology: sha.method, experiment_spec: sha.spec, experiment_freeze: sha.freeze, pre_intake_candidate_slate: sha.slate, supersession_record: sha.supersession, epoch_1_terminal_record: sha.epoch1Terminal };
    const letter = { methodology: 'C', experiment_spec: 'C', experiment_freeze: 'D', pre_intake_candidate_slate: 'E', supersession_record: 'F', epoch_1_terminal_record: 'N' };
    for (const [k, v] of Object.entries(expect)) if (!v || pins[k].sha256 !== v) failures.push(`${letter[k]}: pins.${k} does not match the byte-verified public artifact`);
    if (pf.facts.supersededMethodSha && pins.methodology.sha256 === pf.facts.supersededMethodSha) failures.push('F: pins.methodology is the SUPERSEDED v0.2 methodology — UNUSABLE FOR SUPERSEDED METHODOLOGY');
    // H — frozen cutoff literal equals resolver value exactly
    if (!cut || pins.frozen_cutoff !== cut) failures.push('H: pins.frozen_cutoff must equal the tooling-computed cutoff exactly');
    // Q — cutoff_rule_ref is a MECHANICAL reference: it must point at the recorded freeze
    // bytes on disk and its computed cutoff must equal the resolver AND the freeze's frozen value.
    const cr = pins.cutoff_rule_ref;
    if (!cr || cr.source_sha256 !== pf.facts.freezeSha || cr.source_sha256 !== RECORDED_FREEZE_SHA || !cut || cr.computed_cutoff !== cut) failures.push('Q: pins.cutoff_rule_ref does not reference the recorded freeze bytes on disk with the canonical resolver cutoff');
    // I — Addendum 002 is permanently ABSENT for Epoch 2 (shape already forces ABSENT; belt and braces)
    if (pins.source_registry_addendum_002.sha256 !== 'ABSENT') failures.push('I: addendum-002 is permanently ABSENT for Epoch 2 — no pin may activate it');
    // T — authorization chronology (R5-1): cutoff <= authorized_at <= recorded_at <= evaluation time
    const tA = Date.parse(rec.owner_authorization.authorized_at), tR = Date.parse(rec.recorded_at), tC = cut ? Date.parse(cut) : NaN;
    if (!(tC <= tA)) failures.push('T: owner_authorization.authorized_at precedes the canonical cutoff');
    if (!(tA <= tR)) failures.push('T: recorded_at precedes owner_authorization.authorized_at');
    if (!(tR <= evalNow)) failures.push('T: recorded_at is in the future relative to evaluation time');
  }
  // M — supervised invocation; R — live readiness
  if (supervisedMode !== true) failures.push('M: supervised mode required (' + SUPERVISED_FLAG + ' AND ' + SUPERVISED_ENV + '=' + SUPERVISED_ENV_VALUE + '); ordinary CI is always refused');
  if (readinessAggregate !== 'READY') failures.push('R: live acquisition readiness in THIS environment is ' + (readinessAggregate || 'UNVERIFIED') + ' — must be READY, including live B2 verification here');
  return { allowed: failures.length === 0, failures, rd19b4_contribution: 'ZERO', cutoff: pf.facts.cutoffTimestamp ? { cutoffTimestamp: pf.facts.cutoffTimestamp } : null };
}

// ------------------------------------------------ 3. COMPLETION MARKER (MV-3)
function validateEpoch2CompletionMarker(repoRoot, repo, cutoff, nowMs) {
  const pr = [];
  const m = repo.marker; if (!m.exists) return { exists: false, valid: false, problems: ['marker absent'] };
  if (!m.doc) return { exists: true, valid: false, problems: ['marker malformed JSON'] };
  const d = m.doc;
  // RV4-4 (1)-(3): completion can only bless a run whose governance preflight (with the
  // selected artifact and marker excused as post-run facts) passes AND whose owner
  // authorization is a FINAL, pin-coherent record.
  const repoPost = { ...repo, selectedExists: false, markerExists: false };
  const pf = evaluateEpoch2GovernancePrerequisites({ cutoff, repo: repoPost });
  for (const f of pf.failures) pr.push('governance: ' + f);
  const nowEval = typeof nowMs === 'number' ? nowMs : Date.now();
  const ev = evaluateEpoch2ExecutionPreconditions({ preflight: pf, authRecords: repo.authRecords, supervisedMode: true, readinessAggregate: 'READY', nowMs: nowEval });
  for (const f of ev.failures.filter((x) => !/^P\d+: /.test(x))) pr.push('authorization: ' + f);
  const rec002 = repo.authRecords.find((r) => r.name === 'intake-execution-002.json');
  if (rec002 && rec002.record && isRealUtcSec(d.completed_at) && isRealUtcSec(rec002.record.recorded_at)) {
    if (!(Date.parse(rec002.record.recorded_at) <= Date.parse(d.completed_at))) pr.push('completed_at precedes recorded_at');
    if (!(Date.parse(d.completed_at) <= nowEval)) pr.push('completed_at is in the future relative to completion-evaluation time');
  }
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_COMPLETION') pr.push('artifact_class');
  if (d.gate !== 'CANDIDATE_INTAKE_EXECUTION') pr.push('gate');
  if (d.authorization_id !== 'intake-execution-002') pr.push('authorization_id');
  if (!isRealUtcSec(d.completed_at)) pr.push('completed_at not a real full-UTC timestamp');
  if (d.single_use_consumed !== true) pr.push('single_use_consumed');
  if (!d.selected_slate || d.selected_slate.path !== P.selected) pr.push('selected_slate.path');
  if (!d.selected_slate || !HEX64.test(d.selected_slate.sha256 || '')) pr.push('selected_slate.sha256');
  if (!d.authorization_record || d.authorization_record.path !== P.auth002 || !HEX64.test(d.authorization_record.sha256 || '')) pr.push('authorization_record');
  if (!isRealUtcMs(d.cutoff)) pr.push('cutoff not a real millisecond-UTC timestamp');
  else if (!cutoff || cutoff.defined !== true || d.cutoff !== cutoff.cutoffTimestamp) pr.push('cutoff does not equal the canonical resolver cutoff');
  if (!d.pristine_shell || !HEX64.test(d.pristine_shell.sha256 || '')) pr.push('pristine_shell');
  const lin = d.lineage || {};
  for (const k of ['methodology', 'experiment_spec', 'experiment_freeze', 'supersession_record']) if (!HEX64.test(lin[k] || '')) pr.push('lineage.' + k);
  // bindings to disk
  if (d.authorization_record && repo.sha.auth002 !== d.authorization_record.sha256) pr.push('authorization_record.sha256 does not match intake-execution-002.json on disk');
  if (!repo.selected.exists) pr.push('selected artifact missing');
  else if (d.selected_slate && repo.sha.selected !== d.selected_slate.sha256) pr.push('selected artifact hash drift');
  else {
    const se = repo.selectedSchemaErrors(repo.selected.doc); if (se.length) pr.push('selected artifact fails recorded selected-slate schema: ' + se.slice(0, 2).join('; '));
    else {
      const semantic = require('./epoch2-selected-slate-writer.js').validateSelectedSlate(repoRoot, repo.selected.doc);
      if (!semantic.valid) pr.push('selected artifact fails recorded semantic controls: ' + semantic.problems.slice(0, 2).join('; '));
    }
    const s = repo.selected.doc || {};
    if (s.authorization_ref && d.authorization_record && s.authorization_ref.sha256 !== d.authorization_record.sha256) pr.push('selected artifact and marker bind to different authorizations');
    if (s.pre_intake_shell && d.pristine_shell && s.pre_intake_shell.sha256 !== d.pristine_shell.sha256) pr.push('selected artifact and marker bind to different pristine shells');
  }
  if (d.pristine_shell && repo.sha.slate !== d.pristine_shell.sha256) pr.push('pristine shell on disk differs from marker binding');
  for (const k of ['methodology', 'experiment_spec', 'experiment_freeze', 'supersession_record']) { const actual = { methodology: repo.sha.method, experiment_spec: repo.sha.spec, experiment_freeze: repo.sha.freeze, supersession_record: repo.sha.supersession }[k]; if (lin[k] && actual !== lin[k]) pr.push('lineage.' + k + ' differs from disk'); }
  return { exists: true, valid: pr.length === 0, problems: pr };
}

// ------------------------------------------------ repo wrappers + state machine
function evaluateEpoch2FromRepoWith(repoRoot, { nowMs, supervisedMode, readinessAggregate } = {}, infrastructure) {
  const repo = readRepoFacts(repoRoot, infrastructure);
  const preflight = evaluateEpoch2GovernancePrerequisites({ cutoff: safeCutoff(repoRoot, nowMs), repo });
  return evaluateEpoch2ExecutionPreconditions({ preflight, authRecords: repo.authRecords, supervisedMode: supervisedMode === true, readinessAggregate: readinessAggregate || null, nowMs });
}
function evaluateEpoch2FromRepo(repoRoot, opts = {}) { return evaluateEpoch2FromRepoWith(repoRoot, opts, undefined); }

function deriveEpoch2StateWith(repoRoot, { nowMs, readinessAggregate, supervisedMode } = {}, infrastructure) {
  const repo = readRepoFacts(repoRoot, infrastructure);
  if (!repo.markerExists && (repo.selectedExists || repo.selectedLookalikes.length)) {
    return { state: 'RECONCILIATION_REQUIRED', detail: 'a selected-slate artifact exists without any completion marker (' + [repo.selectedExists ? P.selected : null].concat(repo.selectedLookalikes).filter(Boolean).join(', ') + ') — premature or unexplained output; execution is refused until the owner reconciles the record' };
  }
  if (repo.markerExists) {
    const v = validateEpoch2CompletionMarker(repoRoot, repo, safeCutoff(repoRoot, nowMs), nowMs);
    if (v.valid) return { state: 'EXECUTION_COMPLETE_SPENT', detail: 'validated completion marker bound to the selected artifact and public lineage — the single authorized execution is complete and the authorization is spent; no rerun, no second population, no replacement slate' };
    return { state: 'RECONCILIATION_REQUIRED', detail: 'a completion marker EXISTS but does not validate (' + v.problems.slice(0, 4).join('; ') + ') — execution is permanently refused and the record requires owner reconciliation; existence never asserts completion' };
  }
  const cutoff = safeCutoff(repoRoot, nowMs);
  if (cutoff.defined !== true) return { state: 'CUTOFF_UNDEFINED', detail: cutoff.reason + ' — fail-closed: no Epoch 2 state can advance without a defined canonical cutoff', cutoff };
  if (cutoff.reached !== true) return { state: 'PRE_CUTOFF', detail: cutoff.reason, cutoff };
  const preflight = evaluateEpoch2GovernancePrerequisites({ cutoff, repo });
  const has002 = repo.authRecords.some((r) => r.name === 'intake-execution-002.json');
  if (!preflight.passed) {
    // Governance complete but the transaction cannot FINISH lawfully: explicit state (R5-6).
    if (preflight.failures.every((f) => /^P13: /.test(f))) return { state: 'EXECUTION_INFRASTRUCTURE_INCOMPLETE', detail: preflight.failures.join(' | ') + ' — governance prerequisites verified, but READY_FOR_OWNER_AUTHORIZATION is withheld until the selected-slate schema, v2 runner, deterministic selection, writer, completion writer/verifier, tooling hashes and execution HEAD are separately recorded and pinned', cutoff };
    return { state: 'CUTOFF_REACHED_GATE_INCOMPLETE', detail: preflight.failures.join(' | '), cutoff };
  }
  if (!has002) return { state: 'READY_FOR_OWNER_AUTHORIZATION', detail: 'governance prerequisites verified from public bytes (Method/Spec vs ratification pins, ratification.v2, clarification, supersession, freeze.v2 schema+lineage, Epoch 1 terminal, N/H/S controls); pristine empty slate verified against the frozen hash and path; cutoff reached; owner authorization record intake-execution-002.json ABSENT. Live acquisition readiness is NOT required for this state and is NOT asserted here — it MUST be READY at execution time for SUPERVISED_DISCOVERY_ALLOWED (gate letter R hard-refuses otherwise).', cutoff };
  const ev = evaluateEpoch2ExecutionPreconditions({ preflight, authRecords: repo.authRecords, supervisedMode: supervisedMode === true, readinessAggregate: readinessAggregate || null, nowMs });
  if (ev.failures.some((f) => !/^M: |^R: /.test(f))) return { state: 'CUTOFF_REACHED_GATE_INCOMPLETE', detail: ev.failures.join(' | '), cutoff };
  if (ev.allowed) return { state: 'SUPERVISED_DISCOVERY_ALLOWED', detail: 'every precondition verified under supervised invocation with live READY readiness — the pinned runner may proceed to exactly one supervised execution', cutoff };
  return { state: 'OWNER_AUTHORIZED', detail: 'final owner authorization recorded and verified; execution additionally requires supervised invocation (' + SUPERVISED_FLAG + ' + ' + SUPERVISED_ENV + '=' + SUPERVISED_ENV_VALUE + ') and live READY readiness', cutoff };
}
function deriveEpoch2State(repoRoot, opts = {}) { return deriveEpoch2StateWith(repoRoot, opts, undefined); }

// ------------------------------------------------ 4. PROCESS-BOUND ENTRY (MV-5 / RV4-6 / R5-5)
// PRODUCTION: evaluateEpoch2ForProcess(repoRoot) is the ONLY process authority entry.
// It reads process.argv/process.env itself, runs the readiness TRANSACTION itself, then
// re-reads HEAD and time AFTER the probe and validates provenance against those. No
// caller-supplied readiness, run time, stdout, supervision flag or clock is accepted.
// Readiness may be REPORTED, but executable becomes true only for the production
// entry after the complete pinned gate returns allowed:true. Fixture helpers can
// never report executable:true.
const READINESS_SOURCE = PROBE.READINESS_SOURCE;
function evaluateForProcessCore(repoRoot, { argv, env, probeResult, headAfterProbe, nowAfterProbe }) {
  const supervised = supervisedModeRequested(argv || [], env || {});
  const prov = PROBE.validateReadinessProvenance(probeResult, { nowMs: nowAfterProbe, headSha: headAfterProbe });
  const result = evaluateEpoch2FromRepo(repoRoot, { supervisedMode: supervised, readinessAggregate: prov.valid ? prov.aggregate : null });
  if (!prov.valid) result.failures = result.failures.map((f) => /^R: /.test(f) ? f + ' [provenance: ' + prov.problems.join('; ') + ']' : f);
  return { ...result, executable: false, readinessProvenance: prov, readinessReported: probeResult && probeResult.aggregate ? probeResult.aggregate : null };
}
function evaluateEpoch2ForProcess(repoRoot) {
  const probeResult = PROBE.runReadinessProbe(repoRoot);          // transaction: clean tree, HEAD-bound, HEAD-blob tooling
  const headAfterProbe = PROBE.currentHead(repoRoot);            // re-read AFTER the probe
  const nowAfterProbe = Date.now();                              // re-read AFTER the probe
  const r = evaluateForProcessCore(repoRoot, { argv: process.argv.slice(2), env: process.env, probeResult, headAfterProbe, nowAfterProbe });
  return { ...r, executable: r.allowed === true && r.readinessProvenance.valid === true, production: true, note: 'process-bound evaluation; executable only after final owner authorization, exact supervision pair, fresh READY probe, clean HEAD-bound tree and pinned infrastructure verification' };
}
// FIXTURE HELPERS — non-authoritative. Exported ONLY under __testOnly (R5-8).
function parseReadinessOutput(stdout, runAtIso) {
  const m = /AGGREGATE INTAKE_READINESS: (READY|BLOCKED)/.exec(String(stdout || ''));
  return { source: READINESS_SOURCE, aggregate: m ? m[1] : null, run_at: runAtIso, output_sha256: sha256(Buffer.from(String(stdout || ''))), fixture_only: true };
}
function evaluateForProcessWithDeps(repoRoot, deps) {
  let probeResult = null; try { probeResult = typeof deps.probe === 'function' ? deps.probe(repoRoot) : null; } catch (e) { probeResult = null; }
  const r = evaluateForProcessCore(repoRoot, { argv: deps.argv, env: deps.env, probeResult, headAfterProbe: deps.headSha, nowAfterProbe: deps.nowMs });
  return { ...r, production: false, test_only: true };
}

// ------------------------------------------------ 5. CI GUARD CASE E2 (MV-6)
function decideEpoch2GuardCase(repoRoot, { nowMs } = {}) {
  const repo = readRepoFacts(repoRoot);
  const e2 = safeCutoff(repoRoot, nowMs);
  const why = []; let pass = true;
  if (e2.epoch2IntakeAuthorized !== false) { pass = false; why.push('epoch2IntakeAuthorized must be hard false'); }
  if (repo.selectedExists || repo.selectedLookalikes.length) {
    // A selected artifact may exist ONLY as the output of a fully validated completion sequence.
    const st = deriveEpoch2State(repoRoot, { nowMs });
    if (st.state !== 'EXECUTION_COMPLETE_SPENT') { pass = false; why.push('selected-slate artifact present without a validated completion sequence (' + st.state + ')'); }
  }
  if (repo.authRecords.some((r) => r.name === 'intake-execution-002.json' || r.claimant)) {
    try {
      const v2 = evaluateEpoch2FromRepo(repoRoot, { nowMs, supervisedMode: false });
      if (v2.allowed !== false) { pass = false; why.push('unsupervised CI evaluation must always be a refusal'); }
      const lawful = v2.failures.filter((f) => /^P1: Epoch 2 cutoff .* not reached/.test(f) || /^M: supervised mode required/.test(f) || /^R: live acquisition readiness/.test(f));
      const integrity = v2.failures.filter((f) => !lawful.includes(f));
      if (integrity.length) { pass = false; why.push('intake-execution-002.json fails integrity verification: ' + integrity.join(' | ')); }
      else why.push('intake-execution-002.json verified by the v2 gate (refusal reasons in CI are only lawful pre-execution ones: ' + lawful.map((f) => f.split(':')[0]).join(',') + ')');
    } catch (err) { pass = false; why.push('v2 gate evaluation threw: ' + err.message); }
  }
  return { pass, caseId: 'E2', why: `Epoch 2 ${e2.defined ? 'cutoff ' + e2.cutoffTimestamp + (e2.reached ? ' reached' : ' not reached') : 'cutoff undefined'}; intake NOT authorized by cutoff${why.length ? '; ' + why.join('; ') : ''}` };
}

module.exports = { P, safeCutoff, isRealUtcSec, isRealUtcMs, CANONICAL_CUTOFF_RULE_ID, SCHEMA_IDENTITY, RECORDED_FREEZE_SHA, RECORDED_COMMITS, EXECUTION_INFRASTRUCTURE, executionInfrastructureStatus, verifyExecutionInfrastructureFiles, EPOCH2_CONTROLS, OWNER_AUTH_STATE, OWNER_AUTH_SCOPE, READINESS_SOURCE, readRepoFacts, validateAgainstSchemaFile, evaluateEpoch2GovernancePrerequisites, evaluateEpoch2ExecutionPreconditions, evaluateEpoch2FromRepo, validateAuthorizationShapeV2, validateEpoch2CompletionMarker, deriveEpoch2State, evaluateEpoch2ForProcess, decideEpoch2GuardCase, supervisedModeRequested, SUPERVISED_FLAG, SUPERVISED_ENV, SUPERVISED_ENV_VALUE,
  // Non-authoritative fixture surfaces. No production module imports these.
  __testOnly: { test_only: true, parseReadinessOutput, evaluateForProcessWithDeps, evaluateEpoch2FromRepoWith, deriveEpoch2StateWith, readRepoFactsWith: readRepoFacts } };
