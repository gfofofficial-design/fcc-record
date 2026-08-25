// BUILD 04.1 — CANDIDATE INTAKE PIPELINE (pure mechanics).
//
// Implements FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md sections 2-4 exactly.
// Every function here is pure (no network I/O, no clock reads except where a
// timestamp is explicitly passed in) so the mechanics are deterministically
// testable without touching any real source. Real network acquisition (per
// source's §1.5 interface) is a SEPARATE, not-yet-built layer that would feed
// raw pool items into dedupExactId() as its first consumer -- building that
// live-network layer is explicitly out of scope for this pass (intake is not
// authorized to run yet), so only mock/injected raw pools are exercised here.
const crypto = require('crypto');

const LOOKBACK_DAYS = 21;      // frozen, C-7 ratified, not adjustable
const MIN_FILING_LAG_DAYS = 3; // frozen, C-7 ratified, not adjustable
const MAX_HORIZON_DAYS = 90;
const DUP_DATE_WINDOW_DAYS = 3;   // frozen similarity-test parameter, disclosed as approximate
const DUP_JACCARD_THRESHOLD = 0.6; // frozen similarity-test parameter, disclosed as approximate
const DIFFICULTY_QUOTA_PCT = 0.20; // frozen, unchanged from base spec

const REGISTRY_SOURCE_IDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'F1']; // Class A-F only; G never generates

const daysBetween = (aIso, bIso) => Math.round((Date.parse(bIso) - Date.parse(aIso)) / 86400000);

// ── Step 2: Deduplication ────────────────────────────────────────────────
// (a) exact canonical-ID merge -- the only destructive, automatic path.
function dedupExactId(pool) {
  const seen = new Map(); // key = sourceId + '|' + canonicalId
  const kept = [];
  const merges = [];
  for (const item of pool) {
    const key = `${item.sourceId}|${item.canonicalId}`;
    if (seen.has(key)) { merges.push({ dropped: item, keptAs: seen.get(key) }); continue; }
    seen.set(key, item);
    kept.push(item);
  }
  return { pool: kept, merges };
}
// (b) explicit frozen cross-source equivalence keys. Ratified table is EMPTY
// in v0.2 -- this function exists so the mechanism is real, not a placeholder,
// but with no keys ratified it is a pure passthrough (asserted by fixture).
const RATIFIED_EQUIVALENCE_KEYS = []; // [{sourceIdA, patternA, sourceIdB, patternB}] -- none ratified yet
function applyEquivalenceKeys(pool) {
  if (RATIFIED_EQUIVALENCE_KEYS.length === 0) return { pool, merges: [] };
  throw new Error('applyEquivalenceKeys: a ratified key exists but no matching logic was implemented for it -- this must never silently no-op once a real key is ratified');
}
// (c) mechanical POSSIBLE_DUPLICATE flag -- NEVER merges, only flags both sides.
function jaccard(aWords, bWords) {
  const a = new Set(aWords), b = new Set(bWords);
  const inter = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}
function flagPossibleDuplicates(pool) {
  const flags = []; // [{a: canonicalId, b: canonicalId, jaccard}]
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const A = pool[i], B = pool[j];
      if (!A.assetId || !B.assetId || A.assetId !== B.assetId) continue;
      if (!A.resolutionDate || !B.resolutionDate) continue;
      if (Math.abs(daysBetween(A.resolutionDate, B.resolutionDate)) > DUP_DATE_WINDOW_DAYS) continue;
      const sim = jaccard(A.questionKeywords || [], B.questionKeywords || []);
      if (sim >= DUP_JACCARD_THRESHOLD) {
        flags.push({ a: `${A.sourceId}|${A.canonicalId}`, b: `${B.sourceId}|${B.canonicalId}`, jaccard: sim });
      }
    }
  }
  const byKey = new Map(pool.map((it) => [`${it.sourceId}|${it.canonicalId}`, it]));
  for (const f of flags) {
    const a = byKey.get(f.a), b = byKey.get(f.b);
    a.possibleDuplicateOf = (a.possibleDuplicateOf || []).concat([f.b]);
    b.possibleDuplicateOf = (b.possibleDuplicateOf || []).concat([f.a]);
  }
  return { pool, flags };
}

// ── Step 3: Eligibility checklist (short-circuit, first failure wins) ──────
function checkEligibility(item, { cutoffTimestamp, aiLintPass }) {
  if (!REGISTRY_SOURCE_IDS.includes(item.sourceId)) return { eligible: false, reason: 'source not in registry (or, for a conditional source, acquisition not confirmed this run)' };
  if (!item.resolutionDate) return { eligible: false, reason: 'no source-published fixed resolution date -- this alone rejects roadmap-only items, no other rule needed' };
  if (!item.qualificationStanceShaped) return { eligible: false, reason: 'not qualification-stance shaped' };
  if (item.subjectTouchesFederation) return { eligible: false, reason: 'permanent exclusion: subject or source touches $GFOF/Dossier/Federation' };
  const days = daysBetween(cutoffTimestamp, item.resolutionDate);
  if (days < MIN_FILING_LAG_DAYS || days > MAX_HORIZON_DAYS) return { eligible: false, reason: `horizon ${days}d out of range [${MIN_FILING_LAG_DAYS}, ${MAX_HORIZON_DAYS}]` };
  if (aiLintPass === false) return { eligible: false, reason: 'failed AI LINT' };
  return { eligible: true, reason: null, daysToResolution: days };
}

// ── Step 4A: horizon bucketing (pure arithmetic) ────────────────────────
function horizonBucket(daysToResolution) {
  if (daysToResolution <= 14) return 'short';
  if (daysToResolution <= 45) return 'medium';
  return 'long';
}

// ── Step 4B: deterministic ordering (C-4: timestamp asc, then hash tie-break) ──
function tieBreakHash(canonicalId, cutoffTimestamp) {
  return crypto.createHash('sha256').update(canonicalId + '||' + cutoffTimestamp).digest('hex');
}
function orderItems(items, cutoffTimestamp) {
  return [...items].sort((x, y) => {
    const t = Date.parse(x.openedAt) - Date.parse(y.openedAt);
    if (t !== 0) return t;
    return tieBreakHash(`${x.sourceId}|${x.canonicalId}`, cutoffTimestamp) < tieBreakHash(`${y.sourceId}|${y.canonicalId}`, cutoffTimestamp) ? -1 : 1;
  });
}

// ── Step 6: select top N respecting the duplicate-skip rule (C-2) ──────────
function selectWithDuplicateSkip(orderedEligible, targetCount) {
  const selected = [];
  const selectedKeys = new Set();
  const skipped = [];
  for (const item of orderedEligible) {
    if (selected.length >= targetCount) break;
    const key = `${item.sourceId}|${item.canonicalId}`;
    const dupOf = item.possibleDuplicateOf || [];
    const conflictsWithSelected = dupOf.some((k) => selectedKeys.has(k));
    if (conflictsWithSelected) {
      skipped.push({ key, reason: 'POSSIBLE_DUPLICATE_SKIPPED', deferredTo: dupOf.find((k) => selectedKeys.has(k)) });
      continue;
    }
    selected.push(item);
    selectedKeys.add(key);
  }
  return { selected, skipped };
}

// ── §4C: shortage handling (mechanical, no manual pull-in) ──────────────
function shortageAction(bucketName, eligibleCount, targetCount, currentLookbackDays) {
  if (eligibleCount >= targetCount) return { action: 'NONE' };
  if (currentLookbackDays < LOOKBACK_DAYS * 2) {
    return { action: 'EXTEND_LOOKBACK', newLookbackDays: LOOKBACK_DAYS * 2, bucket: bucketName, reason: `SHORTAGE_EVENT: bucket ${bucketName} has ${eligibleCount}/${targetCount} eligible at lookback=${currentLookbackDays}d; doubling lookback per frozen shortage rule` };
  }
  return { action: 'WAIT_AND_RERUN', rerunAfterDays: 7, bucket: bucketName, reason: `SHORTAGE_EVENT: bucket ${bucketName} still short after extended lookback; re-run identical procedure 7 days later per frozen shortage rule` };
}

// ── §4E: difficulty-quota substitution (deterministic, adversary flag injected) ──
// adversaryFlagFn(item) -> boolean (material risk), injected because the real
// AI Standing Adversary is a separate, already-frozen mechanism this pipeline
// must never reimplement or approximate with a new invented score.
function applyDifficultyQuota(selectedByBucket, poolByBucket, adversaryFlagFn) {
  const allSelected = () => Object.values(selectedByBucket).flat();
  const substitutions = [];
  const targetCount = Math.ceil(DIFFICULTY_QUOTA_PCT * 15); // 3 of 15
  let materialCount = allSelected().filter(adversaryFlagFn).length;
  const buckets = Object.keys(selectedByBucket);
  for (const bucket of buckets) {
    if (materialCount >= targetCount) break;
    const selected = selectedByBucket[bucket];
    const pool = poolByBucket[bucket] || [];
    const selectedKeys = new Set(selected.map((it) => `${it.sourceId}|${it.canonicalId}`));
    // candidates eligible-but-not-selected in this bucket, in frozen order, material-risk only
    const swapCandidates = pool.filter((it) => !selectedKeys.has(`${it.sourceId}|${it.canonicalId}`) && adversaryFlagFn(it));
    if (swapCandidates.length === 0) continue;
    // find lowest-ranked (last) non-material selected item in this bucket to swap out
    for (let i = selected.length - 1; i >= 0 && materialCount < targetCount && swapCandidates.length > 0; i--) {
      if (adversaryFlagFn(selected[i])) continue; // never swap out a material-risk candidate
      const incoming = swapCandidates.shift();
      substitutions.push({ bucket, outgoing: `${selected[i].sourceId}|${selected[i].canonicalId}`, incoming: `${incoming.sourceId}|${incoming.canonicalId}`, reason: 'DIFFICULTY_QUOTA_SUBSTITUTION' });
      selected[i] = incoming;
      materialCount++;
    }
  }
  return { selectedByBucket, substitutions, materialCount, targetCount, quotaMet: materialCount >= targetCount };
}

module.exports = {
  LOOKBACK_DAYS, MIN_FILING_LAG_DAYS, MAX_HORIZON_DAYS, DUP_DATE_WINDOW_DAYS, DUP_JACCARD_THRESHOLD, DIFFICULTY_QUOTA_PCT, REGISTRY_SOURCE_IDS,
  dedupExactId, applyEquivalenceKeys, flagPossibleDuplicates,
  checkEligibility, horizonBucket, orderItems, tieBreakHash,
  selectWithDuplicateSkip, shortageAction, applyDifficultyQuota,
};
