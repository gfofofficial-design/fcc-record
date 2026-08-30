// FCC repository-level append-only law (frozen architecture v0.1.2 §19).
// Two distinct rules, not one blanket "no modification":
//
//   IMMUTABLE (write-once): locked.json files, annex files, .ots proof
//   files, frozen governance documents, and EXISTING versioned public keys.
//   These may never be modified or deleted. New ones may be ADDED.
//
//   APPEND-ONLY NDJSON: existing *.ndjson files may only grow by appending
//   complete new lines. Old bytes must remain an exact, untouched prefix
//   of the new bytes — no rewrite, no insertion, no reordering, no
//   truncation, no deletion of the file itself.
//
// This module is the single source of truth for both the adversarial test
// battery and the CI enforcement script (item 3), so the two can never
// silently diverge.
const { execSync } = require('child_process');

function isNdjson(path) { return /\.ndjson$/.test(path); }
function isProtectedRoot(path) {
  return /^record\//.test(path) || /^governance\/frozen\//.test(path) || /^governance\/keys\//.test(path) || /^governance\/experiments\//.test(path) || /^governance\/gates\//.test(path);
}

function blobBytes(ref, path) {
  return execSync(`git cat-file blob ${ref}:${path}`, { maxBuffer: 1024 * 1024 * 64 });
}

// Verifies that `newBytes` is `oldBytes` plus one or more complete,
// newline-terminated JSON lines appended at the end — nothing else.
function verifyNdjsonAppend(oldBytes, newBytes) {
  if (newBytes.length < oldBytes.length) return { ok: false, reason: 'truncated (new file shorter than old)' };
  const prefix = newBytes.slice(0, oldBytes.length);
  if (!prefix.equals(oldBytes)) return { ok: false, reason: 'old bytes are not an exact untouched prefix (rewrite, insertion, or reorder)' };
  if (oldBytes.length > 0) {
    const lastByte = oldBytes[oldBytes.length - 1];
    if (lastByte !== 0x0a) return { ok: false, reason: 'existing file does not end in a newline — append boundary is not clean' };
  }
  const appended = newBytes.slice(oldBytes.length);
  if (appended.length === 0) return { ok: true, reason: 'no change' };
  const text = appended.toString('utf8');
  if (!text.endsWith('\n')) return { ok: false, reason: 'appended content does not end in a newline (incomplete final line)' };
  const lines = text.split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  for (const line of lines) {
    try { JSON.parse(line); } catch (e) { return { ok: false, reason: `appended line is not valid JSON: ${e.message}` }; }
  }
  return { ok: true, reason: `${lines.length} complete JSON line(s) appended` };
}

// ── PINNED HISTORICAL-INCIDENT CORRECTION RECORDS ─────────────────────────
// A correction record (governance/gates/append-only-correction-*.json) can
// excuse EXACTLY ONE already-recorded transition: bad-blob -> restored-blob on
// exactly the listed paths, where restored == before (a byte-exact return to
// the pre-incident state — new content can never be excused). Before a record
// is honored, every pin is verified against real recorded history: the
// offending commit's parent must hold the before blob, the offending commit
// the bad blob, and the restorative commit the restored blob, for every listed
// path. A record that fails any check — wrong SHAs, wrong blobs, wildcards,
// malformed fields — is ignored entirely, and the violation stands. Records
// themselves live under the protected governance/gates/ root, so mutating or
// deleting one is itself a violation. This mechanism cannot weaken future
// protection: it can only bless transitions that terminate in the historical
// pre-incident bytes, which any subsequent modification necessarily departs.
const SHA1_RE = /^[0-9a-f]{40}$/;

function blobShaAt(ref, path) {
  try { return execSync(`git rev-parse ${ref}:${path}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return null; }
}

function loadVerifiedCorrectionRecords(headRef) {
  let names = [];
  try {
    names = execSync(`git ls-tree --name-only ${headRef} governance/gates/`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').filter((n) => /^governance\/gates\/append-only-correction-[A-Za-z0-9._-]+\.json$/.test(n));
  } catch (e) { return []; }
  const verified = [];
  for (const name of names) {
    let r;
    try { r = JSON.parse(blobBytes(headRef, name).toString('utf8')); } catch (e) { continue; }
    const shape = r
      && SHA1_RE.test(r.offending_commit || '')
      && SHA1_RE.test(r.restorative_commit || '')
      && SHA1_RE.test(r.before_blob_sha1 || '')
      && SHA1_RE.test(r.bad_blob_sha1 || '')
      && SHA1_RE.test(r.restored_blob_sha1 || '')
      && r.before_blob_sha1 === r.restored_blob_sha1
      && r.restoration_is_byte_exact_return === true
      && Array.isArray(r.paths) && r.paths.length > 0
      && r.paths.every((p) => typeof p === 'string' && p.length > 0 && !/[*?\[\]]/.test(p) && isProtectedRoot(p));
    if (!shape) continue;
    const grounded = r.paths.every((p) =>
      blobShaAt(`${r.offending_commit}^`, p) === r.before_blob_sha1
      && blobShaAt(r.offending_commit, p) === r.bad_blob_sha1
      && blobShaAt(r.restorative_commit, p) === r.restored_blob_sha1);
    if (!grounded) continue;
    verified.push(r);
  }
  return verified;
}

function correctionExcuses(records, path, baseRef, headRef) {
  return records.some((r) => r.paths.includes(path)
    && blobShaAt(baseRef, path) === r.bad_blob_sha1
    && blobShaAt(headRef, path) === r.restored_blob_sha1);
}

// Returns an array of violation strings. Empty array = compliant.
function checkAppendOnlyLaw(baseRef, headRef) {
  const diff = execSync(`git diff --name-status ${baseRef} ${headRef} || true`, { encoding: 'utf8' });
  const violations = [];
  const corrections = loadVerifiedCorrectionRecords(headRef);
  diff.split('\n').filter(Boolean).forEach(line => {
    const [status, path] = line.split(/\s+/);
    if (!isProtectedRoot(path)) return;

    if (status === 'A') return; // additions always allowed

    if (status === 'D') {
      violations.push(`DELETE ${path} — deletion of an existing protected artifact is prohibited`);
      return;
    }

    // status === 'M' (or similar) — modification
    if (isNdjson(path)) {
      const oldBytes = blobBytes(baseRef, path);
      const newBytes = blobBytes(headRef, path);
      const result = verifyNdjsonAppend(oldBytes, newBytes);
      if (!result.ok) violations.push(`MODIFY ${path} (ndjson) — REJECTED: ${result.reason}`);
      // else: legitimate append, not a violation
    } else if (correctionExcuses(corrections, path, baseRef, headRef)) {
      // Pinned historical restoration: base blob is the recorded bad state and
      // head blob is the byte-exact pre-incident state, verified against the
      // offending and restorative commits. Not a violation; nothing else is.
    } else {
      violations.push(`MODIFY ${path} — immutable artifact, modification prohibited`);
    }
  });
  return violations;
}

module.exports = { checkAppendOnlyLaw, verifyNdjsonAppend, isNdjson, isProtectedRoot, blobBytes, loadVerifiedCorrectionRecords, correctionExcuses };
