#!/usr/bin/env node
// BUILD 02.1 items 2,3,5,7,10 — LOCK RUN (local pre-publication portion only).
//
// fetch authoritative id -> mint filed_at NOW -> dual canonicalize ->
// compare -> SHA-256. No Git witness publication, no Telegram, no COMMIT
// POINT claim, no FILED/LOCKED transition, no write into record/. Output
// is explicitly classified UNPUBLISHED_LOCK_RUN_ARTIFACT -- it is not a
// filed instrument unless a future approved witness succeeds (BUILD 03+).
//
// HARD RULES ENFORCED HERE, ALL TESTED ADVERSARIALLY:
//   - no authoritativeInstrumentId supplied -> refuse to proceed (item 5)
//   - no operator-controlled filed_at override exists anywhere in this
//     module or its call signature (item 2) -- filed_at is ALWAYS
//     `new Date().toISOString()` captured internally, with zero parameter
//     path to override it in production use
//   - instrument_type === 'allocation' -> refused at Stage 0 (item 7)
//   - output never uses the field name lock_sha256 for anything but the
//     complete, schema-valid, dual-canonicalized locked body (item 10)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { dualCanonicalize } = require('./lib/canonicalize.js');
const { validatePrelockPackage } = require('./prelock.js');

const LOCKED_SCHEMA_PATH = path.join(__dirname, '../governance/schemas/v1/locked-body.schema.json');

function buildLockedValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(LOCKED_SCHEMA_PATH, 'utf8')));
}

// opts:
//   prelockSemanticBody   (required) -- the PRELOCK-validated semantic body
//   authoritativeInstrumentId (required, production callers must obtain
//                              this from the future public Filing Log --
//                              no fallback, no minting, ever)
//   _testOracles          (TEST-ONLY, see tools/lib/canonicalize.js -- no
//                          production call site anywhere sets this)
function prepareLockRun(opts) {
  if (!opts || !opts.prelockSemanticBody) throw new Error('prelockSemanticBody is required');

  // item 5 — hard refusal with no authoritative id. This is the ONLY id
  // source; this function never mints one itself.
  if (!opts.authoritativeInstrumentId) {
    throw new Error('NO AUTHORITATIVE FILING-LOG ID SUPPLIED — production lock-run preparation refuses to proceed. The Filing Log workflow that would supply this id does not exist yet in this build.');
  }
  if (!/^FCC-I-[0-9]{6}$/.test(opts.authoritativeInstrumentId)) {
    throw new Error('authoritativeInstrumentId does not match the frozen namespace format FCC-I-000000');
  }

  // PRELOCK re-validation — never trust an unvalidated semantic body
  const prelockResult = validatePrelockPackage(opts.prelockSemanticBody);

  // item 7 — Stage-0 procedure/lint gate. The frozen schema still
  // RECOGNIZES 'allocation' (not removed, per item 7's instruction) --
  // this is a pipeline-level refusal, not a schema change.
  if (prelockResult.semantic_body.instrument_type === 'allocation') {
    throw new Error('STAGE-0 ELIGIBILITY: instrument_type "allocation" is recognized by the frozen schema but REJECTED at Stage 0 per Doctrine §B1 (allocation-class instruments are ineligible until the Stage 0.5 gate opens). This lock-run refuses to proceed.');
  }

  // item 2 — filed_at is ALWAYS minted here, internally, at exactly this
  // instant. There is no parameter, override, or environment variable
  // anywhere in this function's signature that can change this value.
  const filedAt = new Date().toISOString();

  const completeBody = { ...prelockResult.semantic_body, instrument_id: opts.authoritativeInstrumentId, filed_at: filedAt };

  const validate = buildLockedValidator();
  if (!validate(completeBody)) {
    const err = new Error('COMPLETE LOCKED-BODY SCHEMA VALIDATION FAILED — refusing to proceed');
    err.schemaErrors = validate.errors;
    throw err;
  }

  // dual canonicalization — hard-fails on any Node/Python divergence.
  // _testOracles is the item-8 injection seam; production call sites
  // (this file's own CLI entrypoint, and every other module) never pass it.
  const { bytes: canonicalBytes, nodeVersion, pythonVersion } = dualCanonicalize(completeBody, null, opts._testOracles);

  const lockSha256 = crypto.createHash('sha256').update(canonicalBytes).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(lockSha256)) throw new Error('lock_sha256 malformed — refusing lock-run output');

  const recomputed = crypto.createHash('sha256').update(canonicalBytes).digest('hex');
  if (recomputed !== lockSha256) throw new Error('POST-COMPUTE SELF-VERIFICATION FAILED');

  return {
    status: 'UNPUBLISHED_LOCK_RUN_ARTIFACT',
    status_note: 'Not a filed instrument. No witness publication has occurred (BUILD 03+). This is local operator output only, subject to the Δ publication-tolerance procedure and Case A/B expiry.',
    instrument_id: opts.authoritativeInstrumentId,
    filed_at: filedAt,
    canonical_bytes: canonicalBytes, // exact bytes -- what would be hashed/published
    lock_sha256: lockSha256,          // reserved EXCLUSIVELY for complete locked-body bytes from a real Lock Run
    canonicalization: { node_version: nodeVersion, python_version: pythonVersion, parity_result: 'MATCH' },
  };
}

module.exports = { prepareLockRun };

if (require.main === module) {
  console.error('tools/lock-run.js exposes no CLI entrypoint by design in BUILD 02.1: production use requires an authoritativeInstrumentId from the not-yet-built Filing Log, and this module never invents one. Use prepareLockRun() programmatically from test code with an explicit test id in an isolated context.');
  process.exit(1);
}
