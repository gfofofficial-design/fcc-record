#!/usr/bin/env node
// Foundation-scope schema validation (QA-1.1 item 3). Proves: (a) every
// schema under governance/schemas/ loads and COMPILES via the pinned Ajv
// dependency; (b) a well-formed fixture validates against it; (c) a
// malformed fixture is rejected. FCC-TEST-* fixtures live only in
// tests/fixtures/ — never under record/ (test-quarantine still enforced).
//
// Scope note: only the event-envelope schema is implemented in BUILD 01.
// The frozen documents fully resolve this object's shape (architecture
// v0.1.2 Correction 2). The full Capital Instrument locked-body schema is
// deliberately NOT built here — assembling it is BUILD 02+ (canonicalization
// + lock pipeline) scope per this gate's explicit boundary, not an
// unresolved architecture question.
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const fs = require('fs'), path = require('path');

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
let fail = false;

const schemaFiles = fs.readdirSync('governance/schemas/v1').filter(f => f.endsWith('.schema.json'));
console.log(`Found ${schemaFiles.length} schema(s) in governance/schemas/v1/`);

const validators = {};
for (const f of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join('governance/schemas/v1', f), 'utf8'));
  try {
    validators[f] = ajv.compile(schema);
    console.log('PASS compiled:', f);
  } catch (e) {
    console.log('FAIL compile:', f, e.message);
    fail = true;
  }
}

// Fixtures — FCC-TEST-* namespace, never persisted under record/
const validEvent = {
  event_id: "01M08CMA7J2C8H132SY7NVVRH7",
  type: "filed-locked",
  at: "2026-08-17T00:00:00.000Z",
  payload_refs: ["FCC-TEST-000001"],
  prev_event_sha256: "0".repeat(64),
  event_sha256: "1".repeat(64)
};
const malformedEvent = {
  event_id: "not-a-ulid",
  type: "not-a-real-type",
  at: "not-a-date",
  payload_refs: "should-be-an-array",
  prev_event_sha256: "too-short"
  // event_sha256 missing entirely
};

const v = validators['event.schema.json'];
if (v) {
  const validOk = v(validEvent);
  console.log(validOk ? 'PASS valid fixture accepted' : 'FAIL valid fixture rejected: ' + JSON.stringify(v.errors));
  if (!validOk) fail = true;

  const malformedOk = v(malformedEvent);
  console.log(!malformedOk ? 'PASS malformed fixture correctly rejected' : 'FAIL malformed fixture incorrectly accepted');
  if (malformedOk) fail = true;
}

// Quarantine cross-check: fixtures referenced here must never exist under record/
const recordScan = fs.existsSync('record') ? JSON.stringify(fs.readdirSync('record', {recursive:true})) : '';
if (recordScan.includes('FCC-TEST')) { console.log('FAIL: FCC-TEST reference leaked into record/'); fail = true; }
else console.log('PASS: no FCC-TEST fixture reference under record/');

if (fail) { console.error('\nSCHEMA VALIDATION FOUNDATION FAILED'); process.exit(1); }
console.log('\nSchema validation foundation passed.');
