// FCC STAGE 0 — Epoch 2 write-once selected-slate transaction.
// Public execution re-evaluates the process-bound gate itself. In Phase 1 the
// production gate deliberately reports executable:false, so this module cannot
// write the real repository until a later commit records exact hashes + HEAD.
'use strict';
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const selection = require('./epoch2-selection.js');
const completion = require('./epoch2-completion.js');

const SCHEMA_PATH = 'governance/schemas/v2/candidate-slate.v2.selected.schema.json';
const METHOD_PATH = 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_3.md';
const SPEC_PATH = 'governance/experiments/stage0-public-experiment-v1/FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_3.md';
const FREEZE_PATH = 'governance/experiments/stage0-public-experiment-v1/experiment-freeze.v2.json';
const SUPERSESSION_PATH = 'governance/gates/methodology-supersession-001.json';

function observedPool(result) {
  const rows = [];
  for (const x of result.eligible || []) rows.push({ source_class: x._epoch2.sourceClass, source_id: x.sourceId, canonical_id: x.canonicalId, opened_at: x.openedAt, disposition: 'ELIGIBLE', reason: null });
  for (const r of result.rejected || []) if (r.item && typeof r.item.sourceId === 'string' && typeof r.item.canonicalId === 'string') rows.push({ source_class: selection.SOURCE_CLASS[r.item.sourceId] || null, source_id: r.item.sourceId, canonical_id: r.item.canonicalId, opened_at: typeof r.item.openedAt === 'string' ? r.item.openedAt : null, disposition: 'INELIGIBLE', reason: r.reason });
  for (const d of result.duplicates || []) if (d.item && typeof d.item.sourceId === 'string' && typeof d.item.canonicalId === 'string') rows.push({ source_class: selection.SOURCE_CLASS[d.item.sourceId] || null, source_id: d.item.sourceId, canonical_id: d.item.canonicalId, opened_at: typeof d.item.openedAt === 'string' ? d.item.openedAt : null, disposition: 'EXACT_DUPLICATE', reason: 'duplicate source_id + canonical_id' });
  return rows.sort((a, b) => `${a.opened_at || ''}|${a.source_id}|${a.canonical_id}|${a.disposition}`.localeCompare(`${b.opened_at || ''}|${b.source_id}|${b.canonical_id}|${b.disposition}`));
}

function buildSelectedSlate({ result, authorizationSha, shellSha, lineage, completedAt }) {
  if (!result || result.ok !== true || !result.control || result.control.valid !== true) throw new Error('selection result is not a complete control-valid Epoch 2 slate');
  return {
    artifact_class: 'EPOCH2_SELECTED_CANDIDATE_SLATE', not_a_capital_instrument: true,
    epoch: 2, slate_version: 2,
    authorization_ref: { path: completion.AUTH_PATH, sha256: authorizationSha },
    pre_intake_shell: { path: completion.SHELL_PATH, sha256: shellSha },
    lineage: { ...lineage }, cutoff: result.cutoff, selection_completed_at: completedAt,
    selection_algorithm: 'LEXICOGRAPHIC_FIRST_FEASIBLE_V1', total_slots: 15, all_slots_populated: true,
    slate_control: { ...selection.CONTROLS, verified: true },
    difficulty_control: { minimum_material_count: 3, actual_material_count: result.selected.filter((x) => x.materialRisk === true).length, verified: true },
    observed_pool: observedPool(result),
    slots: result.selected.map((x, i) => ({
      slot_id: `SLOT-${String(i + 1).padStart(2, '0')}`,
      horizon_bucket: x._epoch2.bucket, source_class: x._epoch2.sourceClass,
      source_id: x.sourceId, observable_type: x.observableType,
      standing_adversary_counter_thesis_risk: x.materialRisk === true,
      status: 'SELECTED_PENDING_FILING',
      subject: { canonical_id: x.canonicalId, title: x.title || null, asset_id: x.assetId || null, opened_at: x.openedAt, resolution_date: x.resolutionDate, days_to_resolution: x._epoch2.daysToResolution },
      possible_duplicate_refs: (x.possibleDuplicateRefs || []).slice().sort(),
    })),
  };
}

function schemaValidator(repoRoot) {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, SCHEMA_PATH), 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
  return ajv.compile(schema);
}
function validateSelectedSlate(repoRoot, doc) {
  const v = schemaValidator(repoRoot), problems = [];
  if (!v(doc)) problems.push(...(v.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`));
  const ids = new Set((doc.slots || []).map((x) => x.slot_id));
  const subjects = new Set((doc.slots || []).map((x) => `${x.source_id}|${x.subject && x.subject.canonical_id}`));
  if (ids.size !== 15) problems.push('slot identifiers not unique');
  if (subjects.size !== 15) problems.push('selected source identities not unique');
  const observedIds = new Set((doc.observed_pool || []).map((x) => `${x.source_id}|${x.canonical_id}`));
  const selectedIds = new Set((doc.slots || []).map((x) => `${x.source_id}|${x.subject && x.subject.canonical_id}`));
  const materialCount = (doc.slots || []).filter((x) => x.standing_adversary_counter_thesis_risk === true).length;
  if (materialCount < 3 || !doc.difficulty_control || doc.difficulty_control.actual_material_count !== materialCount) problems.push('difficulty quota proof mismatch');
  for (const x of doc.slots || []) {
    if (selection.SOURCE_CLASS[x.source_id] !== x.source_class) problems.push(`source class mismatch for ${x.slot_id}`);
    if (!selection.OBSERVABLES[x.source_id] || !selection.OBSERVABLES[x.source_id].includes(x.observable_type)) problems.push(`observable whitelist mismatch for ${x.slot_id}`);
    const xid = `${x.source_id}|${x.subject && x.subject.canonical_id}`;
    if (!observedIds.has(xid)) problems.push(`selected identity absent from observed pool for ${x.slot_id}`);
    for (const ref of x.possible_duplicate_refs || []) {
      if (!observedIds.has(ref)) problems.push(`duplicate reference absent from observed pool for ${x.slot_id}`);
      if (selectedIds.has(ref)) problems.push(`two POSSIBLE_DUPLICATE identities selected together for ${x.slot_id}`);
    }
    if (x.subject && typeof x.subject.days_to_resolution === 'number') {
      const actual = (Date.parse(x.subject.resolution_date) - Date.parse(doc.cutoff)) / 86400000;
      if (actual !== x.subject.days_to_resolution || selection.bucketFor(actual) !== x.horizon_bucket) problems.push(`horizon arithmetic mismatch for ${x.slot_id}`);
    }
  }
  if (Date.parse(doc.selection_completed_at) < Date.parse(doc.cutoff)) problems.push('selection completed before cutoff');
  const shaped = (doc.slots || []).map((x) => ({ sourceId: x.source_id, canonicalId: x.subject.canonical_id, observableType: x.observable_type, possibleDuplicateRefs: x.possible_duplicate_refs, _epoch2: { bucket: x.horizon_bucket, sourceClass: x.source_class } }));
  const controls = selection.checkControls(shaped); if (!controls.valid) problems.push(...controls.failures);
  return { valid: problems.length === 0, problems, controls };
}

function fileBytes(repoRoot, rel) { return fs.readFileSync(path.join(repoRoot, rel)); }
function lineageFromRepo(repoRoot) { return { methodology: completion.sha256(fileBytes(repoRoot, METHOD_PATH)), experiment_spec: completion.sha256(fileBytes(repoRoot, SPEC_PATH)), experiment_freeze: completion.sha256(fileBytes(repoRoot, FREEZE_PATH)), supersession_record: completion.sha256(fileBytes(repoRoot, SUPERSESSION_PATH)) }; }

function runWriteOnceTransaction({ target, document, authorizationBytes, shellBytes, cutoff, lineage, completedAt, validateDocument }) {
  if (target.selectedExists() || target.markerExists()) return { ok: false, state: 'REFUSED_ALREADY_STARTED' };
  const vd = validateDocument(document); if (!vd.valid) return { ok: false, state: 'REFUSED_INVALID_SELECTED_SLATE', problems: vd.problems };
  const selectedBytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  try { target.writeSelected(selectedBytes); } catch (e) { return { ok: false, state: 'SELECTED_WRITE_FAILED_NO_MARKER', problems: [e.message] }; }
  const reread = target.readSelected();
  if (!reread.equals(selectedBytes)) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['selected artifact read-back mismatch; do not rerun'] };
  const marker = completion.buildCompletionMarker({ completedAt, selectedSha: completion.sha256(reread), authorizationSha: completion.sha256(authorizationBytes), cutoff, shellSha: completion.sha256(shellBytes), lineage });
  const vm = completion.validateCompletionMarker(marker, { selectedBytes: reread, authorizationBytes, shellBytes, cutoff, lineage, nowMs: Date.parse(completedAt) });
  if (!vm.valid) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: vm.problems };
  try { target.writeMarker(marker); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['marker write failed after verified selected artifact: ' + e.message, 'do not rerun'] }; }
  return { ok: true, state: 'COMPLETED', selectedSha: completion.sha256(reread), marker };
}

function fsTarget(repoRoot) {
  const selected = path.join(repoRoot, completion.SELECTED_PATH), marker = path.join(repoRoot, completion.MARKER_PATH);
  return {
    selectedExists: () => fs.existsSync(selected), markerExists: () => fs.existsSync(marker),
    writeSelected: (bytes) => { const fd = fs.openSync(selected, 'wx', 0o644); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } },
    readSelected: () => fs.readFileSync(selected),
    writeMarker: (obj) => completion.writeMarkerOnce(repoRoot, obj),
  };
}

function executeSelectedSlateWrite(repoRoot, document) {
  const gate = require('./epoch2-intake-authorization.js').evaluateEpoch2ForProcess(repoRoot);
  if (gate.allowed !== true || gate.executable !== true || gate.production !== true) {
    const e = new Error('EPOCH2_WRITE_REFUSED: process-bound authorization is not executable; ' + (gate.failures || []).join(' | ')); e.code = 'EPOCH2_WRITE_REFUSED'; throw e;
  }
  const authorizationBytes = fileBytes(repoRoot, completion.AUTH_PATH), shellBytes = fileBytes(repoRoot, completion.SHELL_PATH);
  const lineage = lineageFromRepo(repoRoot), completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (document.authorization_ref.sha256 !== completion.sha256(authorizationBytes) || document.pre_intake_shell.sha256 !== completion.sha256(shellBytes) || JSON.stringify(document.lineage) !== JSON.stringify(lineage) || document.cutoff !== gate.cutoff.cutoffTimestamp) throw new Error('EPOCH2_WRITE_REFUSED: selected document bindings do not equal current authorized bytes');
  return runWriteOnceTransaction({ target: fsTarget(repoRoot), document, authorizationBytes, shellBytes, cutoff: gate.cutoff.cutoffTimestamp, lineage, completedAt, validateDocument: (d) => validateSelectedSlate(repoRoot, d) });
}

module.exports = { SCHEMA_PATH, buildSelectedSlate, validateSelectedSlate, lineageFromRepo, runWriteOnceTransaction, fsTarget, executeSelectedSlateWrite };
