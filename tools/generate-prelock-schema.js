#!/usr/bin/env node
// BUILD 02.1 item 9: derives governance/schemas/v1/prelock-body.schema.json
// from the frozen locked-body.schema.json by stripping instrument_id and
// filed_at (the two fields the LOCK RUN injects). Generated, not hand-
// duplicated, so the two schemas can never silently drift apart. The
// frozen locked-body schema itself is NEVER mutated by this process.
const fs = require('fs'), path = require('path');
const lockedSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../governance/schemas/v1/locked-body.schema.json'), 'utf8'));

const prelock = JSON.parse(JSON.stringify(lockedSchema)); // deep clone, never mutate the source
prelock.$id = prelock.$id.replace('locked-body', 'prelock-body');
prelock.title = 'FCC Capital Instrument — PRELOCK Package (v1, generated)';
prelock.description = 'GENERATED from locked-body.schema.json by tools/generate-prelock-schema.js -- do not hand-edit. Represents the semantic body BEFORE instrument_id and filed_at are injected by an authoritative LOCK RUN. A PRELOCK package that validates here is not filed, not locked, and carries no lock_sha256.';
delete prelock.properties.instrument_id;
delete prelock.properties.filed_at;
prelock.required = prelock.required.filter(f => f !== 'instrument_id' && f !== 'filed_at');
fs.writeFileSync(path.join(__dirname, '../governance/schemas/v1/prelock-body.schema.json'), JSON.stringify(prelock, null, 2) + '\n');
console.log('prelock-body.schema.json generated from locked-body.schema.json');
