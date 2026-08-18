#!/usr/bin/env node
// BUILD 02.1 item 1 — PRELOCK PACKAGE.
//
// Replaces the withdrawn "LOCK CANDIDATE" model entirely. A PRELOCK
// package contains the semantic body ONLY -- no instrument_id, no
// filed_at, and nothing that could be mistaken for a lock_sha256.
//
// Dry-run canonicalization/hash evidence is permitted (useful for
// determinism testing before an authoritative Lock Run) but every such
// value is unmistakably labeled: field name dry_run_sha256 (never
// lock_sha256), hash_class "DRY_RUN_ONLY", proof_status
// "NOT_FILED_NOT_LOCKED".
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { dualCanonicalize } = require('./lib/canonicalize.js');

const PRELOCK_SCHEMA_PATH = path.join(__dirname, '../governance/schemas/v1/prelock-body.schema.json');

function buildValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(PRELOCK_SCHEMA_PATH, 'utf8')));
}

// Validates a semantic body against the PRELOCK schema and, if requested,
// computes DRY-RUN evidence only. Never writes instrument_id or filed_at.
// Throws on schema failure -- no best-effort mode.
function validatePrelockPackage(semanticBody, opts = {}) {
  const validate = buildValidator();
  if (!validate(semanticBody)) {
    const err = new Error('PRELOCK SCHEMA VALIDATION FAILED');
    err.schemaErrors = validate.errors;
    throw err;
  }
  const result = {
    semantic_body: semanticBody,
    proof_status: 'NOT_FILED_NOT_LOCKED',
  };
  if (opts.computeDryRunEvidence) {
    const { bytes, nodeVersion, pythonVersion } = dualCanonicalize(semanticBody);
    result.dry_run_evidence = {
      hash_class: 'DRY_RUN_ONLY',
      dry_run_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      note: 'This is NOT a lock_sha256. It has no instrument_id and no filed_at baked in, is not derived from a Lock Run, and carries zero evidentiary weight about filing or publication.',
      canonicalization: { node_version: nodeVersion, python_version: pythonVersion },
    };
  }
  return result;
}

module.exports = { validatePrelockPackage, PRELOCK_SCHEMA_PATH };

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath) { console.error('usage: node tools/prelock.js <semantic-body.json>'); process.exit(1); }
  try {
    const r = validatePrelockPackage(JSON.parse(fs.readFileSync(inputPath, 'utf8')), { computeDryRunEvidence: true });
    console.log('PRELOCK PACKAGE valid. proof_status:', r.proof_status);
    console.log('dry_run_sha256 (NOT a lock hash):', r.dry_run_evidence.dry_run_sha256);
  } catch (e) {
    console.error('PRELOCK VALIDATION FAILED:', e.message);
    if (e.schemaErrors) console.error(JSON.stringify(e.schemaErrors, null, 2));
    process.exit(1);
  }
}
