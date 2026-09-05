// FCC Stage 0 — write-once selected-slate result for Epoch 2 C1-C3.
// Builders and the injected transaction are pure with respect to authority.
// The production executor re-evaluates the process-bound rerun gate immediately
// before writing any byte.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const canonicalize = require('canonicalize');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const selection = require('./epoch2-selection.js');
const shortage = require('./epoch2-shortage-result.js');
const completion = require('./epoch2-rerun-completion.js');

const SCHEMA_PATH = 'governance/schemas/v2/candidate-slate.v2.rerun-selected.schema.json';
const SHELL_PATH = 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.json';
const METHOD_PATH = 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_3.md';
const SPEC_PATH = 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_3.md';
const FREEZE_PATH = 'governance/experiments/stage0-public-experiment-v1/experiment-freeze.v2.json';
const SUPERSESSION_PATH = 'governance/gates/methodology-supersession-001.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileBytes = (root, rel) => fs.readFileSync(path.join(root, rel));

function lineageFromRepo(repoRoot) {
  return {
    methodology: sha256(fileBytes(repoRoot, METHOD_PATH)),
    experiment_spec: sha256(fileBytes(repoRoot, SPEC_PATH)),
    experiment_freeze: sha256(fileBytes(repoRoot, FREEZE_PATH)),
    supersession_record: sha256(fileBytes(repoRoot, SUPERSESSION_PATH)),
  };
}

function buildSelectedSlate({ run, result, authorizationSha, reconciliationSha, shellSha, lineage, completedAt }) {
  const cp = shortage.CHECKPOINTS[run];
  if (!cp) throw new Error('run must be C1, C2, or C3');
  if (!result || result.ok !== true || !result.control || result.control.valid !== true || !result.difficulty || result.difficulty.quotaMet !== true) throw new Error('selection result is not a complete control-valid Epoch 2 slate');
  if (result.cutoff !== cp.timestamp) throw new Error(`result cutoff must equal the frozen ${run} checkpoint`);
  const pool = shortage.observedPool(result);
  return {
    artifact_class: 'EPOCH2_RERUN_SELECTED_CANDIDATE_SLATE',
    not_a_capital_instrument: true,
    epoch: 2,
    run,
    slate_version: 2,
    authorization_ref: { path: completion.authPath(run), sha256: authorizationSha },
    c0_reconciliation_ref: { path: completion.RECONCILIATION_PATH, sha256: reconciliationSha },
    pre_intake_shell: { path: SHELL_PATH, sha256: shellSha },
    lineage: { ...lineage },
    c0_cutoff: shortage.C0_CUTOFF,
    checkpoint_timestamp: cp.timestamp,
    selection_completed_at: completedAt,
    selection_algorithm: 'LEXICOGRAPHIC_FIRST_FEASIBLE_V1',
    total_slots: 15,
    all_slots_populated: true,
    slate_control: { ...selection.CONTROLS, verified: true },
    difficulty_control: { minimum_material_count: 3, actual_material_count: result.selected.filter((x) => x.materialRisk === true).length, verified: true },
    observed_pool: pool,
    observed_pool_sha256: sha256(Buffer.from(canonicalize(pool))),
    slots: result.selected.map((x, i) => ({
      slot_id: `SLOT-${String(i + 1).padStart(2, '0')}`,
      horizon_bucket: x._epoch2.bucket,
      source_class: x._epoch2.sourceClass,
      source_id: x.sourceId,
      observable_type: x.observableType,
      standing_adversary_counter_thesis_risk: x.materialRisk === true,
      status: 'SELECTED_PENDING_FILING',
      subject: {
        canonical_id: x.canonicalId,
        title: x.title || null,
        asset_id: x.assetId || null,
        opened_at: x.openedAt,
        resolution_date: x.resolutionDate,
        days_to_resolution: x._epoch2.daysToResolution,
      },
      possible_duplicate_refs: (x.possibleDuplicateRefs || []).slice().sort(),
    })),
  };
}

function schemaValidator(repoRoot) {
  const schema = JSON.parse(fileBytes(repoRoot, SCHEMA_PATH));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function validateSelectedSlate(repoRoot, doc) {
  const problems = [], v = schemaValidator(repoRoot);
  if (!v(doc)) problems.push(...(v.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`));
  const cp = doc && shortage.CHECKPOINTS[doc.run];
  if (!cp) return { valid: false, problems: problems.concat('unknown run') };
  if (!doc.authorization_ref || doc.authorization_ref.path !== completion.authPath(doc.run)) problems.push('authorization path/run mismatch');
  if (!doc.c0_reconciliation_ref || doc.c0_reconciliation_ref.path !== completion.RECONCILIATION_PATH) problems.push('C0 reconciliation path mismatch');
  if (doc.checkpoint_timestamp !== cp.timestamp) problems.push('checkpoint timestamp/run mismatch');
  if (Date.parse(doc.selection_completed_at) < Date.parse(cp.timestamp)) problems.push('selection completed before checkpoint');
  const canonicalPool = canonicalize(doc.observed_pool || []);
  if (sha256(Buffer.from(canonicalPool)) !== doc.observed_pool_sha256) problems.push('observed pool hash mismatch');
  const sorted = (doc.observed_pool || []).slice().sort((a, b) => `${a.opened_at || ''}|${a.source_id}|${a.canonical_id}|${a.disposition}`.localeCompare(`${b.opened_at || ''}|${b.source_id}|${b.canonical_id}|${b.disposition}`));
  if (canonicalize(sorted) !== canonicalPool) problems.push('observed pool is not deterministically ordered');
  const observedAll = new Set((doc.observed_pool || []).map((x) => `${x.source_id}|${x.canonical_id}`));
  const observedEligible = new Set((doc.observed_pool || []).filter((x) => x.disposition === 'ELIGIBLE').map((x) => `${x.source_id}|${x.canonical_id}`));
  const slotIds = new Set();
  const selectedIds = new Set((doc.slots || []).map((x) => `${x.source_id}|${x.subject && x.subject.canonical_id}`));
  for (const x of doc.slots || []) {
    slotIds.add(x.slot_id);
    const id = `${x.source_id}|${x.subject && x.subject.canonical_id}`;
    if (!observedEligible.has(id)) problems.push(`selected identity is not eligible in observed pool for ${x.slot_id}`);
    if (selection.SOURCE_CLASS[x.source_id] !== x.source_class) problems.push(`source class mismatch for ${x.slot_id}`);
    if (!selection.OBSERVABLES[x.source_id] || !selection.OBSERVABLES[x.source_id].includes(x.observable_type)) problems.push(`observable whitelist mismatch for ${x.slot_id}`);
    for (const ref of x.possible_duplicate_refs || []) {
      if (!observedAll.has(ref)) problems.push(`duplicate reference absent from observed pool for ${x.slot_id}`);
      if (selectedIds.has(ref)) problems.push(`two POSSIBLE_DUPLICATE identities selected together for ${x.slot_id}`);
    }
    if (x.subject && typeof x.subject.days_to_resolution === 'number') {
      const days = (Date.parse(x.subject.resolution_date) - Date.parse(cp.timestamp)) / 86400000;
      if (days !== x.subject.days_to_resolution || selection.bucketFor(days) !== x.horizon_bucket) problems.push(`horizon arithmetic mismatch for ${x.slot_id}`);
    }
  }
  if (slotIds.size !== 15) problems.push('slot identifiers not unique');
  if (selectedIds.size !== 15) problems.push('selected source identities not unique');
  const materialCount = (doc.slots || []).filter((x) => x.standing_adversary_counter_thesis_risk === true).length;
  if (materialCount < 3 || !doc.difficulty_control || doc.difficulty_control.actual_material_count !== materialCount) problems.push('difficulty quota proof mismatch');
  const shaped = (doc.slots || []).map((x) => ({ sourceId: x.source_id, canonicalId: x.subject && x.subject.canonical_id, observableType: x.observable_type, possibleDuplicateRefs: x.possible_duplicate_refs, _epoch2: { bucket: x.horizon_bucket, sourceClass: x.source_class } }));
  const controls = selection.checkControls(shaped);
  if (!controls.valid) problems.push(...controls.failures);
  return { valid: problems.length === 0, problems, controls };
}

function runWriteOnceTransaction({ run, target, document, authorizationBytes, reconciliationBytes, completedAt, executionHead, readinessOutputSha256, validateDocument }) {
  if (!shortage.CHECKPOINTS[run]) return { ok: false, state: 'REFUSED_UNKNOWN_RUN' };
  if (target.resultExists() || target.markerExists()) return { ok: false, state: 'REFUSED_ALREADY_STARTED' };
  if (!document || document.run !== run || document.selection_completed_at !== completedAt) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['run/completedAt does not match document'] };
  if (!document.authorization_ref || document.authorization_ref.sha256 !== sha256(authorizationBytes)) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['authorization bytes do not match document'] };
  if (!document.c0_reconciliation_ref || document.c0_reconciliation_ref.sha256 !== sha256(reconciliationBytes)) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['C0 reconciliation bytes do not match document'] };
  const vd = validateDocument(document);
  if (!vd.valid) return { ok: false, state: 'REFUSED_INVALID_SELECTED_SLATE', problems: vd.problems };
  const resultBytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  try { target.writeResult(resultBytes); } catch (e) { return { ok: false, state: 'RESULT_WRITE_FAILED_NO_MARKER', problems: [e.message] }; }
  let reread;
  try { reread = target.readResult(); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['selected result read-back failed: ' + e.message, 'do not rerun'] }; }
  if (!reread.equals(resultBytes)) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['selected result read-back mismatch; do not rerun'] };
  const marker = completion.buildCompletionMarker({ run, outcome: 'SELECTED', completedAt, resultBytes: reread, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 });
  const mv = completion.validateCompletionMarker(marker, { run, outcome: 'SELECTED', completedAt, resultBytes: reread, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 });
  if (!mv.valid) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: mv.problems };
  const markerBytes = Buffer.from(JSON.stringify(marker, null, 2) + '\n');
  try { target.writeMarker(markerBytes); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['marker write failed after verified selected result: ' + e.message, 'do not rerun'] }; }
  let markerReread;
  try { markerReread = target.readMarker(); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker read-back failed: ' + e.message, 'do not rerun'] }; }
  if (!markerReread.equals(markerBytes)) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker read-back mismatch; do not rerun'] };
  let parsed;
  try { parsed = JSON.parse(markerReread); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker became malformed after write; do not rerun'] }; }
  if (!completion.validateCompletionMarker(parsed, { run, outcome: 'SELECTED', completedAt, resultBytes: reread, authorizationBytes, reconciliationBytes, executionHead, readinessOutputSha256 }).valid) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker failed post-write verification; do not rerun'] };
  return { ok: true, state: 'SELECTED_RECORDED_AUTHORIZATION_SPENT', resultSha: sha256(reread), marker: parsed };
}

function fsTarget(repoRoot, run) {
  const result = path.join(repoRoot, completion.selectedPath(run));
  const marker = path.join(repoRoot, completion.markerPath(run));
  const writeOnce = (target, bytes) => { const fd = fs.openSync(target, 'wx', 0o644); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
  return {
    resultExists: () => fs.existsSync(result), markerExists: () => fs.existsSync(marker),
    writeResult: (bytes) => writeOnce(result, bytes), readResult: () => fs.readFileSync(result),
    writeMarker: (bytes) => writeOnce(marker, bytes), readMarker: () => fs.readFileSync(marker),
  };
}

function executeSelectedWrite(repoRoot, run, document) {
  const gate = require('./epoch2-rerun-authorization.js').evaluateRerunForProcess(repoRoot, run);
  if (gate.allowed !== true || gate.executable !== true || gate.production !== true) {
    const e = new Error('EPOCH2_RERUN_WRITE_REFUSED: process-bound authorization is not executable; ' + (gate.failures || []).join(' | '));
    e.code = 'EPOCH2_RERUN_WRITE_REFUSED';
    throw e;
  }
  const authorizationBytes = fileBytes(repoRoot, completion.authPath(run));
  const reconciliationBytes = fileBytes(repoRoot, completion.RECONCILIATION_PATH);
  const shellBytes = fileBytes(repoRoot, SHELL_PATH);
  const lineage = lineageFromRepo(repoRoot);
  if (document.authorization_ref.sha256 !== sha256(authorizationBytes) || document.c0_reconciliation_ref.sha256 !== sha256(reconciliationBytes) || document.pre_intake_shell.sha256 !== sha256(shellBytes) || canonicalize(document.lineage) !== canonicalize(lineage) || document.checkpoint_timestamp !== gate.checkpointTimestamp) throw new Error('EPOCH2_RERUN_WRITE_REFUSED: selected document bindings do not equal current authorized bytes');
  return runWriteOnceTransaction({ run, target: fsTarget(repoRoot, run), document, authorizationBytes, reconciliationBytes, completedAt: document.selection_completed_at, executionHead: gate.executionHead, readinessOutputSha256: gate.readinessOutputSha256, validateDocument: (d) => validateSelectedSlate(repoRoot, d) });
}

module.exports = { SCHEMA_PATH, SHELL_PATH, METHOD_PATH, SPEC_PATH, FREEZE_PATH, SUPERSESSION_PATH, sha256, lineageFromRepo, buildSelectedSlate, validateSelectedSlate, runWriteOnceTransaction, fsTarget, executeSelectedWrite };
