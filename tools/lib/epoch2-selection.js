// FCC STAGE 0 — Epoch 2 deterministic candidate selection (Method v0.3).
// Pure mechanics only: no clock, network, filesystem or process authority.
'use strict';
const crypto = require('crypto');

const TOTAL = 15;
const DAY_MS = 86400000;
const EPOCH1_CUTOFF = '2026-08-31T00:00:00.000Z';
const SOURCE_CLASS = Object.freeze({ A1: 'A', A2: 'A', B1: 'B', B2: 'B', C1: 'C', C2: 'C', D1: 'D', D2: 'D', E1: 'E', F1: 'F' });
const OBSERVABLES = Object.freeze({
  A1: ['OBS_SOURCE_NATIVE_DATE'],
  A2: ['OBS_SOURCE_NATIVE_DATE', 'OBS_SOURCE_NATIVE_EXECUTION_DATE'],
  B1: ['OBS_RULE_DERIVED_DATE'], B2: ['OBS_SOURCE_NATIVE_DATE'],
  C1: [], C2: [], D1: [], D2: [],
  E1: ['OBS_SOURCE_NATIVE_DATE'], F1: ['OBS_RULE_DERIVED_DATE'],
});
const CONTROLS = Object.freeze({ H1_band_max: 7, H2_band_min: 2, H3_non_short_min: 5, S1_class_max: 7, S2_min_classes: 3, S3_governance_vote_max: 7 });
const FEDERATION_RE = /\b(GFOF|Galactic Federation|Dossier|Federation Capital|FCC)\b/i;
const iso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString() === s;
const stableId = (x) => `${x.sourceId}|${x.canonicalId}`;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

function bucketFor(days) { if (days <= 14) return 'short'; if (days <= 45) return 'medium'; if (days <= 90) return 'long'; return null; }
function orderKey(item, cutoff) {
  const day = item.openedAt.slice(0, 10);
  return `${day}|${hash(String(item.canonicalId) + '||' + cutoff)}`;
}
function compareAtCutoff(a, b, cutoff) { const ka = orderKey(a, cutoff), kb = orderKey(b, cutoff); return ka.localeCompare(kb); }

function dedupExact(pool) {
  const seen = new Set(), kept = [], duplicates = [];
  for (const item of pool) {
    if (!item || typeof item.sourceId !== 'string' || typeof item.canonicalId !== 'string' || !item.canonicalId) { kept.push(item); continue; }
    const id = stableId(item);
    if (seen.has(id)) duplicates.push({ item, id });
    else { seen.add(id); kept.push(item); }
  }
  return { kept, duplicates };
}

function jaccard(aWords, bWords) {
  const a = new Set(aWords || []), b = new Set(bWords || []);
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}
function flagPossibleDuplicates(pool) {
  const cloned = pool.map((x) => ({ ...x, possibleDuplicateRefs: (x.possibleDuplicateRefs || []).slice() }));
  const flags = [];
  for (let i = 0; i < cloned.length; i++) for (let j = i + 1; j < cloned.length; j++) {
    const a = cloned[i], b = cloned[j];
    if (!a.assetId || a.assetId !== b.assetId || !iso(a.resolutionDate) || !iso(b.resolutionDate)) continue;
    if (Math.abs(Date.parse(a.resolutionDate) - Date.parse(b.resolutionDate)) > 3 * DAY_MS) continue;
    const sim = jaccard(a.questionKeywords || a.keywords || [], b.questionKeywords || b.keywords || []);
    if (sim < 0.6) continue;
    const aid = stableId(a), bid = stableId(b);
    if (!a.possibleDuplicateRefs.includes(bid)) a.possibleDuplicateRefs.push(bid);
    if (!b.possibleDuplicateRefs.includes(aid)) b.possibleDuplicateRefs.push(aid);
    flags.push({ a: aid, b: bid, jaccard: sim });
  }
  cloned.forEach((x) => x.possibleDuplicateRefs.sort());
  return { pool: cloned, flags };
}

function evaluateItem(item, { cutoff, priorStableIds = new Set(), aiLintPass = () => true }) {
  if (!item || !SOURCE_CLASS[item.sourceId]) return { eligible: false, reason: 'source not in the A-F registry' };
  if (typeof item.canonicalId !== 'string' || !item.canonicalId) return { eligible: false, reason: 'source-native stable identity missing' };
  if (!iso(item.openedAt)) return { eligible: false, reason: 'source-native opening timestamp missing or not canonical ISO UTC' };
  if (priorStableIds.has(stableId(item)) || Date.parse(item.openedAt) <= Date.parse(EPOCH1_CUTOFF)) return { eligible: false, reason: 'Epoch 1 anti-carry-over exclusion' };
  if (Date.parse(item.openedAt) > Date.parse(cutoff)) return { eligible: false, reason: 'opening timestamp is after the fixed acquisition cutoff' };
  if (item.sourceId === 'B1' || item.sourceId === 'F1') return { eligible: false, reason: 'RD-19b4 addendum-002 was absent before the Epoch 2 cutoff; contribution fixed at ZERO' };
  if (!OBSERVABLES[item.sourceId].includes(item.observableType)) return { eligible: false, reason: 'observable type not whitelisted for source class' };
  if (!iso(item.resolutionDate)) return { eligible: false, reason: 'resolution observable missing or not canonical ISO UTC' };
  if (item.qualificationStanceShaped !== true) return { eligible: false, reason: 'not qualification-stance shaped' };
  if (item.subjectTouchesFederation === true || FEDERATION_RE.test(item.title || '')) return { eligible: false, reason: 'Federation subject/source permanently excluded' };
  if (aiLintPass(item) !== true) return { eligible: false, reason: 'AI LINT failed' };
  const days = (Date.parse(item.resolutionDate) - Date.parse(cutoff)) / DAY_MS;
  const bucket = bucketFor(days);
  if (days < 3 || !bucket) return { eligible: false, reason: `resolution horizon ${days}d outside frozen 3-90d window` };
  return { eligible: true, daysToResolution: days, bucket, sourceClass: SOURCE_CLASS[item.sourceId] };
}

function countsFor(items) {
  const bands = { short: 0, medium: 0, long: 0 };
  const classes = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let governanceVotes = 0;
  for (const x of items) {
    bands[x._epoch2.bucket]++;
    classes[x._epoch2.sourceClass]++;
    if ((x.sourceId === 'A1' || x.sourceId === 'A2') && x.observableType === 'OBS_SOURCE_NATIVE_DATE') governanceVotes++;
  }
  return { bands, classes, governanceVotes, nonShort: bands.medium + bands.long, distinctClasses: Object.values(classes).filter(Boolean).length };
}

function checkControls(items) {
  const c = countsFor(items), failures = [];
  if (items.length !== TOTAL) failures.push(`N:${items.length}/${TOTAL}`);
  for (const b of ['short', 'medium', 'long']) {
    if (c.bands[b] > CONTROLS.H1_band_max) failures.push(`H1:${b}=${c.bands[b]}>7`);
    if (c.bands[b] < CONTROLS.H2_band_min) failures.push(`H2:${b}=${c.bands[b]}<2`);
  }
  if (c.nonShort < CONTROLS.H3_non_short_min) failures.push(`H3:non-short=${c.nonShort}<5`);
  for (const [k, n] of Object.entries(c.classes)) if (n > CONTROLS.S1_class_max) failures.push(`S1:${k}=${n}>7`);
  if (c.distinctClasses < CONTROLS.S2_min_classes) failures.push(`S2:classes=${c.distinctClasses}<3`);
  if (c.governanceVotes > CONTROLS.S3_governance_vote_max) failures.push(`S3:governance-votes=${c.governanceVotes}>7`);
  return { valid: failures.length === 0, failures, counts: c };
}

function conflicts(item, selected) {
  const refs = new Set(item.possibleDuplicateRefs || []);
  return selected.some((x) => refs.has(stableId(x)) || new Set(x.possibleDuplicateRefs || []).has(stableId(item)));
}

function remainingCanSatisfy(ordered, at, selected) {
  const needed = TOTAL - selected.length;
  if (ordered.length - at < needed) return false;
  const c = countsFor(selected), rest = ordered.slice(at);
  for (const b of ['short', 'medium', 'long']) {
    const available = rest.filter((x) => x._epoch2.bucket === b).length;
    if (c.bands[b] + available < CONTROLS.H2_band_min) return false;
  }
  const possibleClasses = new Set(selected.map((x) => x._epoch2.sourceClass));
  rest.forEach((x) => possibleClasses.add(x._epoch2.sourceClass));
  return possibleClasses.size >= CONTROLS.S2_min_classes;
}

function firstFeasible(ordered) {
  const selected = [];
  function walk(at) {
    if (selected.length === TOTAL) return checkControls(selected).valid ? selected.slice() : null;
    if (!remainingCanSatisfy(ordered, at, selected)) return null;
    for (let i = at; i < ordered.length; i++) {
      const x = ordered[i];
      if (conflicts(x, selected)) continue;
      selected.push(x);
      const partial = countsFor(selected);
      const exceeds = partial.bands[x._epoch2.bucket] > 7 || partial.classes[x._epoch2.sourceClass] > 7 || partial.governanceVotes > 7;
      const found = exceeds ? null : walk(i + 1);
      if (found) return found;
      selected.pop();
    }
    return null;
  }
  return walk(0);
}

function applyDifficulty(selected, ordered, materialRisk = (x) => x.materialRisk === true) {
  const out = selected.slice(), substitutions = [];
  const keySet = () => new Set(out.map(stableId));
  const materialCount = () => out.filter(materialRisk).length;
  for (const bucket of ['short', 'medium', 'long']) {
    if (materialCount() >= 3) break;
    const incoming = ordered.filter((x) => x._epoch2.bucket === bucket && materialRisk(x) && !keySet().has(stableId(x)));
    const outgoing = out.filter((x) => x._epoch2.bucket === bucket && !materialRisk(x)).sort((a, b) => compareAtCutoff(b, a, a._epoch2.cutoff));
    for (const inc of incoming) {
      if (materialCount() >= 3) break;
      for (const old of outgoing) {
        const idx = out.indexOf(old); if (idx < 0) continue;
        const trial = out.slice(); trial[idx] = inc;
        if (!conflicts(inc, trial.filter((_, j) => j !== idx)) && checkControls(trial).valid) {
          out[idx] = inc; substitutions.push({ bucket, outgoing: stableId(old), incoming: stableId(inc) }); break;
        }
      }
    }
  }
  return { selected: out.sort((a, b) => compareAtCutoff(a, b, a._epoch2.cutoff)), substitutions, materialCount: materialCount(), targetCount: 3, quotaMet: materialCount() >= 3 };
}

function rerunSchedule(cutoff) { const t = Date.parse(cutoff); return [7, 14, 21].map((days, i) => ({ run: `C${i + 1}`, days_after_c0: days, timestamp: new Date(t + days * DAY_MS).toISOString() })); }

function selectEpoch2(pool, { cutoff, priorStableIds = [], aiLintPass, materialRisk } = {}) {
  if (!iso(cutoff)) throw new Error('cutoff must be a canonical ISO-8601 UTC instant');
  const { kept, duplicates } = dedupExact(Array.isArray(pool) ? pool : []);
  const flagged = flagPossibleDuplicates(kept);
  const rejected = [], eligible = [];
  for (const item of flagged.pool) {
    const ev = evaluateItem(item, { cutoff, priorStableIds: new Set(priorStableIds), aiLintPass });
    if (!ev.eligible) rejected.push({ item, reason: ev.reason });
    else eligible.push({ ...item, _epoch2: { ...ev, cutoff } });
  }
  eligible.sort((a, b) => compareAtCutoff(a, b, cutoff));
  for (let i = 1; i < eligible.length; i++) if (orderKey(eligible[i - 1], cutoff) === orderKey(eligible[i], cutoff)) throw new Error('ambiguous deterministic order key for distinct candidates');
  const initial = firstFeasible(eligible);
  if (!initial) return { ok: false, state: 'SHORTAGE_EVENT', cutoff, selected: [], eligible, rejected, duplicates, possibleDuplicateFlags: flagged.flags, unsatisfied: ['N/H1/H2/H3/S1/S2/S3'], rerun_schedule: rerunSchedule(cutoff) };
  const difficult = applyDifficulty(initial, eligible, materialRisk);
  if (!difficult.quotaMet) return { ok: false, state: 'DIFFICULTY_QUOTA_UNSATISFIED', cutoff, selected: difficult.selected, eligible, rejected, duplicates, possibleDuplicateFlags: flagged.flags, control: checkControls(difficult.selected), difficulty: difficult, rerun_schedule: rerunSchedule(cutoff) };
  return { ok: true, state: 'SELECTED', cutoff, selected: difficult.selected, eligible, rejected, duplicates, possibleDuplicateFlags: flagged.flags, control: checkControls(difficult.selected), difficulty: difficult };
}

module.exports = { TOTAL, EPOCH1_CUTOFF, SOURCE_CLASS, OBSERVABLES, CONTROLS, stableId, bucketFor, orderKey, compareAtCutoff, dedupExact, flagPossibleDuplicates, evaluateItem, countsFor, checkControls, rerunSchedule, selectEpoch2 };
