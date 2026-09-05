// FCC Stage 0 — write-once shortage result infrastructure for Epoch 2 C1-C3.
// Pure builders and an injected transaction core only. Nothing in this module
// grants process authority or performs acquisition.
'use strict';
const crypto = require('crypto');
const canonicalize = require('canonicalize');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const selection = require('./epoch2-selection.js');

const SCHEMA_PATH = 'governance/schemas/v2/epoch2-shortage-event.schema.json';
const C0_CUTOFF = '2026-09-03T00:00:00.000Z';
const CHECKPOINTS = Object.freeze({
  C1: { authorization: 'intake-execution-003', days_after_c0: 7, timestamp: '2026-09-10T00:00:00.000Z' },
  C2: { authorization: 'intake-execution-004', days_after_c0: 14, timestamp: '2026-09-17T00:00:00.000Z' },
  C3: { authorization: 'intake-execution-005', days_after_c0: 21, timestamp: '2026-09-24T00:00:00.000Z' },
});
const RECONCILIATION_PATH = 'governance/gates/epoch2-c0-shortage-reconciliation-001.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const authPath = (run) => `governance/gates/${CHECKPOINTS[run].authorization}.json`;
const shortagePath = (run) => `governance/experiments/stage0-public-experiment-v1/epoch2-${run.toLowerCase()}-shortage-event.json`;
const markerPath = (run) => `governance/gates/${CHECKPOINTS[run].authorization}.completed.json`;

function observedPool(result) {
  const rows = [];
  const row = (x, disposition, reason, epoch2) => ({
    source_class: (epoch2 && epoch2.sourceClass) || selection.SOURCE_CLASS[x.sourceId] || null,
    source_id: x.sourceId,
    canonical_id: x.canonicalId,
    opened_at: typeof x.openedAt === 'string' ? x.openedAt : null,
    resolution_date: typeof x.resolutionDate === 'string' ? x.resolutionDate : null,
    observable_type: typeof x.observableType === 'string' ? x.observableType : null,
    asset_id: typeof x.assetId === 'string' ? x.assetId : null,
    title: typeof x.title === 'string' ? x.title : null,
    qualification_stance_shaped: typeof x.qualificationStanceShaped === 'boolean' ? x.qualificationStanceShaped : null,
    subject_touches_federation: typeof x.subjectTouchesFederation === 'boolean' ? x.subjectTouchesFederation : null,
    standing_adversary_counter_thesis_risk: typeof x.materialRisk === 'boolean' ? x.materialRisk : null,
    horizon_bucket: epoch2 && epoch2.bucket ? epoch2.bucket : null,
    days_to_resolution: epoch2 && typeof epoch2.daysToResolution === 'number' ? epoch2.daysToResolution : null,
    possible_duplicate_refs: (x.possibleDuplicateRefs || []).slice().sort(),
    disposition,
    reason,
  });
  for (const x of result.eligible || []) rows.push(row(x, 'ELIGIBLE', null, x._epoch2));
  for (const r of result.rejected || []) if (r.item && typeof r.item.sourceId === 'string' && typeof r.item.canonicalId === 'string' && r.item.canonicalId) rows.push(row(r.item, 'INELIGIBLE', r.reason || 'ineligible', null));
  for (const d of result.duplicates || []) if (d.item && typeof d.item.sourceId === 'string' && typeof d.item.canonicalId === 'string' && d.item.canonicalId) rows.push(row(d.item, 'EXACT_DUPLICATE', 'duplicate source_id + canonical_id', null));
  return rows.sort((a, b) => `${a.opened_at || ''}|${a.source_id}|${a.canonical_id}|${a.disposition}`.localeCompare(`${b.opened_at || ''}|${b.source_id}|${b.canonical_id}|${b.disposition}`));
}

function availabilityFor(eligible) {
  const counts = selection.countsFor(eligible || []);
  return {
    eligible_total: (eligible || []).length,
    bands: counts.bands,
    classes: counts.classes,
    governance_votes: counts.governanceVotes,
    non_governance: (eligible || []).length - counts.governanceVotes,
    non_short: counts.nonShort,
    distinct_classes: counts.distinctClasses,
  };
}

function availabilityFromObserved(rows) {
  const eligible = (rows || []).filter((x) => x.disposition === 'ELIGIBLE');
  const bands = { short: 0, medium: 0, long: 0 };
  const classes = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let governanceVotes = 0;
  for (const x of eligible) {
    if (x.horizon_bucket in bands) bands[x.horizon_bucket]++;
    if (x.source_class in classes) classes[x.source_class]++;
    if ((x.source_id === 'A1' || x.source_id === 'A2') && x.observable_type === 'OBS_SOURCE_NATIVE_DATE') governanceVotes++;
  }
  return {
    eligible_total: eligible.length,
    bands,
    classes,
    governance_votes: governanceVotes,
    non_governance: eligible.length - governanceVotes,
    non_short: bands.medium + bands.long,
    distinct_classes: Object.values(classes).filter(Boolean).length,
  };
}

function supplyDeficitsFromAvailability(a) {
  const out = [];
  const add = (control, requirement, available, shortfall, detail) => out.push({ control, requirement, available, shortfall, detail });
  if (a.eligible_total < 15) add('N', 'at least 15 eligible candidates', a.eligible_total, 15 - a.eligible_total, `eligible supply is ${a.eligible_total}/15`);
  for (const band of ['short', 'medium', 'long']) {
    if (a.bands[band] < 2) add('H2', `at least 2 ${band} candidates`, a.bands[band], 2 - a.bands[band], `${band} availability is ${a.bands[band]}/2`);
    const outside = a.eligible_total - a.bands[band];
    if (outside < 8) add('H1', `at least 8 candidates outside ${band} so ${band} can remain at or below 7`, outside, 8 - outside, `only ${outside} eligible candidates exist outside ${band}`);
  }
  if (a.non_short < 5) add('H3', 'at least 5 non-SHORT candidates', a.non_short, 5 - a.non_short, `non-SHORT availability is ${a.non_short}/5`);
  for (const klass of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const outside = a.eligible_total - a.classes[klass];
    if (outside < 8) add('S1', `at least 8 candidates outside class ${klass} so that class can remain at or below 7`, outside, 8 - outside, `only ${outside} eligible candidates exist outside class ${klass}`);
  }
  if (a.distinct_classes < 3) add('S2', 'at least 3 distinct contributing classes', a.distinct_classes, 3 - a.distinct_classes, `distinct-class availability is ${a.distinct_classes}/3`);
  if (a.non_governance < 8) add('S3', 'at least 8 non-governance candidates so governance-vote observables can remain at or below 7', a.non_governance, 8 - a.non_governance, `non-governance availability is ${a.non_governance}/8`);
  return out;
}

function supplyDeficits(eligible) { return supplyDeficitsFromAvailability(availabilityFor(eligible)); }

function deficitsFor(result) {
  if (result.state === 'DIFFICULTY_QUOTA_UNSATISFIED') {
    const actual = result.difficulty && Number.isInteger(result.difficulty.materialCount) ? result.difficulty.materialCount : 0;
    return [{ control: 'DIFFICULTY', requirement: 'at least 3 materially non-trivial counter-theses', available: actual, shortfall: Math.max(0, 3 - actual), detail: `material counter-thesis availability in the selected composition is ${actual}/3` }];
  }
  const deficits = supplyDeficits(result.eligible || []);
  if (!deficits.length) deficits.push({ control: 'COMBINATION_FEASIBILITY', requirement: 'one conflict-free 15-item composition satisfying N/H1/H2/H3/S1/S2/S3', available: null, shortfall: null, detail: 'aggregate supply bounds pass, but deterministic exhaustive selection found no jointly feasible composition; the full ordered pool permits independent reproduction' });
  return deficits;
}

function remainingSchedule(run) {
  const order = ['C1', 'C2', 'C3'];
  return order.slice(order.indexOf(run) + 1).map((r) => ({ run: r, days_after_c0: CHECKPOINTS[r].days_after_c0, timestamp: CHECKPOINTS[r].timestamp }));
}

function buildShortageEvent({ run, result, authorizationSha, reconciliationSha, lineage, completedAt }) {
  if (!CHECKPOINTS[run]) throw new Error('run must be C1, C2, or C3');
  if (!result || result.ok !== false || !['SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(result.state)) throw new Error('result is not a recognized non-writable Epoch 2 outcome');
  if (result.cutoff !== CHECKPOINTS[run].timestamp) throw new Error(`result cutoff must equal the frozen ${run} checkpoint`);
  const pool = observedPool(result);
  return {
    artifact_class: 'EPOCH2_RERUN_SHORTAGE_EVENT',
    not_a_capital_instrument: true,
    epoch: 2,
    run,
    state: result.state,
    authorization_ref: { path: authPath(run), sha256: authorizationSha },
    c0_reconciliation_ref: { path: RECONCILIATION_PATH, sha256: reconciliationSha },
    lineage: { ...lineage },
    c0_cutoff: C0_CUTOFF,
    checkpoint_timestamp: CHECKPOINTS[run].timestamp,
    selection_completed_at: completedAt,
    selection_algorithm: 'LEXICOGRAPHIC_FIRST_FEASIBLE_V1',
    target_slots: 15,
    selected: [],
    provisional_selected: result.state === 'DIFFICULTY_QUOTA_UNSATISFIED' ? (result.selected || []).map(selection.stableId) : [],
    difficulty: result.state === 'DIFFICULTY_QUOTA_UNSATISFIED' ? {
      target: 3,
      actual: result.difficulty && Number.isInteger(result.difficulty.materialCount) ? result.difficulty.materialCount : 0,
      shortfall: Math.max(0, 3 - (result.difficulty && Number.isInteger(result.difficulty.materialCount) ? result.difficulty.materialCount : 0)),
    } : null,
    observed_pool: pool,
    observed_pool_sha256: sha256(Buffer.from(canonicalize(pool))),
    availability: availabilityFor(result.eligible || []),
    deficits: deficitsFor(result),
    rerun_schedule_remaining: remainingSchedule(run),
  };
}

function validator(repoRoot) {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, SCHEMA_PATH), 'utf8'));
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function validateShortageEvent(repoRoot, doc) {
  const problems = [], v = validator(repoRoot);
  if (!v(doc)) problems.push(...(v.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`));
  if (!doc || !CHECKPOINTS[doc.run]) return { valid: false, problems: problems.concat('unknown run') };
  const cp = CHECKPOINTS[doc.run];
  if (!doc.authorization_ref || doc.authorization_ref.path !== authPath(doc.run)) problems.push('authorization path/run mismatch');
  if (doc.checkpoint_timestamp !== cp.timestamp) problems.push('checkpoint timestamp/run mismatch');
  if (Date.parse(doc.selection_completed_at) < Date.parse(doc.checkpoint_timestamp)) problems.push('selection completed before checkpoint');
  const canonicalPool = canonicalize(doc.observed_pool || []);
  if (sha256(Buffer.from(canonicalPool)) !== doc.observed_pool_sha256) problems.push('observed pool hash mismatch');
  const sorted = (doc.observed_pool || []).slice().sort((a, b) => `${a.opened_at || ''}|${a.source_id}|${a.canonical_id}|${a.disposition}`.localeCompare(`${b.opened_at || ''}|${b.source_id}|${b.canonical_id}|${b.disposition}`));
  if (canonicalize(sorted) !== canonicalize(doc.observed_pool || [])) problems.push('observed pool is not deterministically ordered');
  const recomputedAvailability = availabilityFromObserved(doc.observed_pool || []);
  if (canonicalize(recomputedAvailability) !== canonicalize(doc.availability || {})) problems.push('availability does not match the observed pool');
  if (doc.state === 'SHORTAGE_EVENT') {
    const deficits = supplyDeficitsFromAvailability(recomputedAvailability);
    if (!deficits.length) deficits.push({ control: 'COMBINATION_FEASIBILITY', requirement: 'one conflict-free 15-item composition satisfying N/H1/H2/H3/S1/S2/S3', available: null, shortfall: null, detail: 'aggregate supply bounds pass, but deterministic exhaustive selection found no jointly feasible composition; the full ordered pool permits independent reproduction' });
    if (canonicalize(deficits) !== canonicalize(doc.deficits || [])) problems.push('deficits do not match the observed-pool availability');
  } else if (doc.state === 'DIFFICULTY_QUOTA_UNSATISFIED') {
    const eligibleById = new Map((doc.observed_pool || []).filter((x) => x.disposition === 'ELIGIBLE').map((x) => [`${x.source_id}|${x.canonical_id}`, x]));
    const refs = doc.provisional_selected || [];
    if (refs.some((id) => !eligibleById.has(id))) problems.push('provisional selection references an identity outside the eligible pool');
    const actual = refs.filter((id) => eligibleById.get(id) && eligibleById.get(id).standing_adversary_counter_thesis_risk === true).length;
    if (!doc.difficulty || doc.difficulty.target !== 3 || doc.difficulty.actual !== actual || doc.difficulty.shortfall !== 3 - actual) problems.push('difficulty proof does not match the provisional selection');
    const expected = [{ control: 'DIFFICULTY', requirement: 'at least 3 materially non-trivial counter-theses', available: actual, shortfall: 3 - actual, detail: `material counter-thesis availability in the selected composition is ${actual}/3` }];
    if (canonicalize(expected) !== canonicalize(doc.deficits || [])) problems.push('difficulty deficit does not match the provisional selection');
  }
  const remaining = remainingSchedule(doc.run);
  if (canonicalize(remaining) !== canonicalize(doc.rerun_schedule_remaining || [])) problems.push('remaining schedule/run mismatch');
  return { valid: problems.length === 0, problems };
}

function buildCompletionMarker({ run, outcome, completedAt, resultSha, authorizationSha, reconciliationSha }) {
  if (!CHECKPOINTS[run]) throw new Error('run must be C1, C2, or C3');
  if (!['SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(outcome)) throw new Error('completion outcome is not a recognized non-writable result');
  return {
    artifact_class: 'GOVERNANCE_EXECUTION_COMPLETION',
    not_a_capital_instrument: true,
    gate: 'CANDIDATE_INTAKE_RERUN_EXECUTION',
    authorization_id: CHECKPOINTS[run].authorization,
    epoch: 2,
    run,
    outcome,
    completed_at: completedAt,
    single_use_consumed: true,
    result_artifact: { path: shortagePath(run), sha256: resultSha },
    authorization_record: { path: authPath(run), sha256: authorizationSha },
    c0_reconciliation_record: { path: RECONCILIATION_PATH, sha256: reconciliationSha },
    checkpoint_timestamp: CHECKPOINTS[run].timestamp,
  };
}

function validateCompletionMarker(marker, { run, outcome, completedAt, resultBytes, authorizationBytes, reconciliationBytes }) {
  const problems = [], d = marker || {}, cp = CHECKPOINTS[run];
  const keys = ['artifact_class', 'not_a_capital_instrument', 'gate', 'authorization_id', 'epoch', 'run', 'outcome', 'completed_at', 'single_use_consumed', 'result_artifact', 'authorization_record', 'c0_reconciliation_record', 'checkpoint_timestamp'];
  const actualKeys = Object.keys(d);
  for (const k of keys) if (!(k in d)) problems.push('missing ' + k);
  for (const k of actualKeys) if (!keys.includes(k)) problems.push('unexpected ' + k);
  if (!cp) problems.push('unknown run');
  if (d.artifact_class !== 'GOVERNANCE_EXECUTION_COMPLETION' || d.not_a_capital_instrument !== true || d.gate !== 'CANDIDATE_INTAKE_RERUN_EXECUTION' || d.epoch !== 2) problems.push('completion identity');
  if (!cp || d.authorization_id !== cp.authorization || d.run !== run || d.checkpoint_timestamp !== cp.timestamp) problems.push('run binding');
  if (d.outcome !== outcome || !['SHORTAGE_EVENT', 'DIFFICULTY_QUOTA_UNSATISFIED'].includes(d.outcome)) problems.push('outcome binding');
  if (d.completed_at !== completedAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(d.completed_at || '') || Number.isNaN(Date.parse(d.completed_at))) problems.push('completed_at');
  if (d.single_use_consumed !== true) problems.push('single_use_consumed');
  const bound = (obj, expectedPath, bytes, label) => {
    if (!obj || Object.keys(obj).sort().join(',') !== 'path,sha256' || obj.path !== expectedPath || obj.sha256 !== sha256(bytes)) problems.push(label);
  };
  if (cp) {
    bound(d.result_artifact, shortagePath(run), resultBytes, 'result_artifact');
    bound(d.authorization_record, authPath(run), authorizationBytes, 'authorization_record');
    bound(d.c0_reconciliation_record, RECONCILIATION_PATH, reconciliationBytes, 'c0_reconciliation_record');
  }
  return { valid: problems.length === 0, problems };
}

function runWriteOnceTransaction({ run, target, document, authorizationBytes, reconciliationBytes, completedAt, validateDocument }) {
  if (!CHECKPOINTS[run]) return { ok: false, state: 'REFUSED_UNKNOWN_RUN' };
  if (target.resultExists() || target.markerExists()) return { ok: false, state: 'REFUSED_ALREADY_STARTED' };
  if (!document || document.run !== run || document.selection_completed_at !== completedAt) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['run/completedAt does not match document'] };
  if (!document.authorization_ref || document.authorization_ref.sha256 !== sha256(authorizationBytes)) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['authorization bytes do not match document'] };
  if (!document.c0_reconciliation_ref || document.c0_reconciliation_ref.sha256 !== sha256(reconciliationBytes)) return { ok: false, state: 'REFUSED_BINDING_MISMATCH', problems: ['C0 reconciliation bytes do not match document'] };
  const vd = validateDocument(document);
  if (!vd.valid) return { ok: false, state: 'REFUSED_INVALID_SHORTAGE_EVENT', problems: vd.problems };
  const resultBytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  try { target.writeResult(resultBytes); } catch (e) { return { ok: false, state: 'RESULT_WRITE_FAILED_NO_MARKER', problems: [e.message] }; }
  const reread = target.readResult();
  if (!reread.equals(resultBytes)) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['result artifact read-back mismatch; do not rerun'] };
  const marker = buildCompletionMarker({ run, outcome: document.state, completedAt, resultSha: sha256(reread), authorizationSha: sha256(authorizationBytes), reconciliationSha: sha256(reconciliationBytes) });
  const mv = validateCompletionMarker(marker, { run, outcome: document.state, completedAt, resultBytes: reread, authorizationBytes, reconciliationBytes });
  if (!mv.valid) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: mv.problems };
  const markerBytes = Buffer.from(JSON.stringify(marker, null, 2) + '\n');
  try { target.writeMarker(markerBytes); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['marker write failed after verified result artifact: ' + e.message, 'do not rerun'] }; }
  let markerReread;
  try { markerReread = target.readMarker(); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker read-back failed: ' + e.message, 'do not rerun'] }; }
  if (!markerReread.equals(markerBytes)) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker read-back mismatch; do not rerun'] };
  let parsed;
  try { parsed = JSON.parse(markerReread); } catch (e) { return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: ['completion marker became malformed after write; do not rerun'] }; }
  const rereadValidation = validateCompletionMarker(parsed, { run, outcome: document.state, completedAt, resultBytes: reread, authorizationBytes, reconciliationBytes });
  if (!rereadValidation.valid) return { ok: false, state: 'RECONCILIATION_REQUIRED', problems: rereadValidation.problems };
  return { ok: true, state: 'SHORTAGE_RECORDED_AUTHORIZATION_SPENT', resultSha: sha256(reread), marker: parsed };
}

module.exports = { SCHEMA_PATH, C0_CUTOFF, CHECKPOINTS, RECONCILIATION_PATH, sha256, authPath, shortagePath, markerPath, observedPool, availabilityFor, availabilityFromObserved, supplyDeficitsFromAvailability, supplyDeficits, remainingSchedule, buildShortageEvent, validateShortageEvent, buildCompletionMarker, validateCompletionMarker, runWriteOnceTransaction };
