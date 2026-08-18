#!/usr/bin/env node
// Candidate-quarantine proof (BUILD 02 item 5/9): staging/ candidates must
// never accidentally enter the permanent record/. Two checks: (1) no
// candidate instrument id under staging/candidates/ has a same-id path
// under record/instruments/; (2) staging/ is git-ignored, so it can never
// be committed at all — belt and suspenders.
const fs = require('fs'), path = require('path');
let fail = false;

const gi = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
if (!/(^|\n)staging\/?/.test(gi)) { console.error('FAIL: staging/ is not present in .gitignore'); fail = true; }
else console.log('PASS: staging/ is git-ignored (candidates can never be committed by accident)');

const stagingDir = 'staging/candidates';
const recordDir = 'record/instruments';
const stagedIds = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
const recordIds = fs.existsSync(recordDir) ? fs.readdirSync(recordDir) : [];
const leaked = stagedIds.filter(id => recordIds.includes(id));
if (leaked.length) { console.error('FAIL: candidate id(s) leaked into record/:', leaked); fail = true; }
else console.log(`PASS: 0 of ${stagedIds.length} staged candidate id(s) present under record/instruments/`);

if (fail) { console.error('\nCANDIDATE QUARANTINE CHECK FAILED'); process.exit(1); }
console.log('\nCandidate quarantine verified.');
