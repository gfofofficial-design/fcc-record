#!/usr/bin/env node
// EPOCH 2 v2 INTAKE-AUTHORIZATION GATE TESTS (REV5). Dry-run evaluation ONLY — no test
// performs discovery, spawns the runner, calls a network adapter, calls the final-write
// executor, or writes to the real repository. Fixture paths remain non-executable, and
// the production authorization record is only read and validated. No test invokes the
// real runner or supplies the owner-present supervision pair.
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const G = require('./lib/epoch2-intake-authorization.js');
const PROBE = require('./lib/epoch2-readiness-probe.js');
const FW = require('./lib/intake-final-write.js');
const SEL = require('./lib/epoch2-selection.js');
const WRITER = require('./lib/epoch2-selected-slate-writer.js');
const TO = G.__testOnly;
const ROOT = path.join(__dirname, '..');
const H = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let n = 0, fails = 0; const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const has = (r, re) => (r.failures || r.problems || []).some((f) => re.test(f));
const CUT = '2026-09-03T00:00:00.000Z';
const PRE = Date.parse(CUT) - 1, AT = Date.parse(CUT), POST = Date.parse('2026-09-04T12:00:00Z');
const P = G.P;
const INFRA_COPY = [
  ...['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier'].map((k) => G.EXECUTION_INFRASTRUCTURE[k].path),
  ...Object.keys(G.EXECUTION_INFRASTRUCTURE.execution_critical_tooling_hashes),
];
const COPY = [...new Set([P.method, P.spec, P.ratification, P.freeze, P.slate, P.clarification, P.supersession, P.epoch1Terminal, P.freezeSchema, P.slateSchema, ...INFRA_COPY, 'governance/gates/build03-1-ad3-status.v2.json', 'governance/gates/intake-execution-001.json', 'governance/experiments/stage0-public-experiment-v1/candidate-selection-ratification.json'])];
function mkRepo(mut) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2r5-')); for (const rel of COPY) { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(tmp, rel)); } if (mut) mut(tmp); return tmp; }
const rm = (t) => fs.rmSync(t, { recursive: true, force: true });
const del = (t, rel) => fs.rmSync(path.join(t, rel));
const appendByte = (t, rel) => fs.appendFileSync(path.join(t, rel), '\n');
const editJson = (t, rel, fn) => { const p = path.join(t, rel); const d = JSON.parse(fs.readFileSync(p, 'utf8')); fn(d); fs.writeFileSync(p, JSON.stringify(d, null, 2)); };
const writeJson = (t, rel, d) => { fs.mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); fs.writeFileSync(path.join(t, rel), typeof d === 'string' ? d : JSON.stringify(d, null, 2)); };
const SH = { method: H(path.join(ROOT, P.method)), spec: H(path.join(ROOT, P.spec)), freeze: H(path.join(ROOT, P.freeze)), slate: H(path.join(ROOT, P.slate)), supersession: H(path.join(ROOT, P.supersession)), e1: H(path.join(ROOT, P.epoch1Terminal)) };
// FICTIONAL complete infrastructure — test fixture only; production has separately recorded pins.
const INFRA = { selected_slate_schema: { path: G.EXECUTION_INFRASTRUCTURE.selected_slate_schema.path, sha256: '1'.repeat(64) }, v2_discovery_runner: { path: G.EXECUTION_INFRASTRUCTURE.v2_discovery_runner.path, sha256: '2'.repeat(64) }, deterministic_selection: { path: G.EXECUTION_INFRASTRUCTURE.deterministic_selection.path, sha256: '3'.repeat(64) }, selected_slate_writer: { path: G.EXECUTION_INFRASTRUCTURE.selected_slate_writer.path, sha256: '4'.repeat(64) }, completion_marker_writer_verifier: { path: G.EXECUTION_INFRASTRUCTURE.completion_marker_writer_verifier.path, sha256: '5'.repeat(64) }, execution_critical_tooling_hashes: { 'tools/verify-acquisition-readiness.js': '6'.repeat(64) }, execution_head: 'ab'.repeat(20) };
const finalRec = (infrastructure = INFRA) => ({ artifact_class: 'GOVERNANCE_EXECUTION_AUTHORIZATION', not_a_capital_instrument: true, gate: 'CANDIDATE_INTAKE_EXECUTION', authorization_id: 'intake-execution-002', authorized: true, epoch: 2,
  predecessor: { record: 'governance/gates/intake-execution-001.json', state: 'PRESERVED, UNSPENT and UNUSABLE for Epoch 2 (v0.2 lineage); never amended, never marked spent' },
  scope: { what_is_authorized: G.OWNER_AUTH_SCOPE, single_use: true, completion_marker_path: P.marker002 },
  owner_authorization: { state: G.OWNER_AUTH_STATE, authorized_at: '2026-09-03T01:00:00Z', scope: G.OWNER_AUTH_SCOPE },
  pins: { methodology: { path: P.method, sha256: SH.method }, experiment_spec: { path: P.spec, sha256: SH.spec }, experiment_freeze: { path: P.freeze, sha256: SH.freeze }, pre_intake_candidate_slate: { path: P.slate, sha256: SH.slate }, supersession_record: { path: P.supersession, sha256: SH.supersession }, epoch_1_terminal_record: { path: P.epoch1Terminal, sha256: SH.e1, public_commit: G.RECORDED_COMMITS.epoch_1_closure },
    source_registry_addendum_002: { path: P.addendum, sha256: 'ABSENT', required: false }, frozen_cutoff: CUT,
    cutoff_rule_ref: { rule_id: G.CANONICAL_CUTOFF_RULE_ID, source_path: P.freeze, source_sha256: G.RECORDED_FREEZE_SHA, source_field: 'candidate_selection_methodology.cutoff_gate_ref', computed_cutoff: CUT },
    execution_infrastructure: JSON.parse(JSON.stringify(infrastructure)) },
  recorded_at: '2026-09-03T01:00:05Z', owner_ratification_required: false });
const withAuth = (mut) => mkRepo((t) => { writeJson(t, P.auth002, finalRec()); if (mut) mut(t); });
const withProductionAuth = (mut) => mkRepo((t) => { writeJson(t, P.auth002, finalRec(G.EXECUTION_INFRASTRUCTURE)); if (mut) mut(t); });
const SUPR = { supervisedMode: true, readinessAggregate: 'READY', nowMs: POST };
const evalI = (t, o = SUPR) => TO.evaluateEpoch2FromRepoWith(t, o, INFRA);           // fixture-infrastructure evaluation
const stateI = (t, o = { nowMs: POST }) => TO.deriveEpoch2StateWith(t, o, INFRA).state;
const shape = (d) => G.validateAuthorizationShapeV2(d, 'intake-execution-002.json', INFRA);
const pfOf = (t, nowMs = POST, infra = INFRA) => G.evaluateEpoch2GovernancePrerequisites({ cutoff: G.safeCutoff(t, nowMs), repo: G.readRepoFacts(t, infra) });
let t;

console.log('== REV2/3/4 semantics retained (fixture infrastructure) ==');
t = mkRepo();
ok(stateI(t, { nowMs: PRE }) === 'PRE_CUTOFF', 'before cutoff => PRE_CUTOFF');
ok(has(evalI(t, { ...SUPR, nowMs: PRE }), /^P1: .*not reached/), 'cutoff minus 1 ms => REFUSE on P1');
{ const ra = evalI(t, { ...SUPR, nowMs: AT }); ok(!ra.allowed && !has(ra, /^P1: /) && has(ra, /^B: /), 'cutoff instant satisfies P1 alone; refusal continues on B'); }
ok(has(evalI(t), /^B: intake-execution-001\.json can never satisfy/), 'intake-001 present, no 002 => explicit no-fallback refusal');
{ const s2 = TO.deriveEpoch2StateWith(t, { nowMs: POST, readinessAggregate: null }, INFRA); ok(s2.state === 'READY_FOR_OWNER_AUTHORIZATION' && /NOT required for this state and is NOT asserted/.test(s2.detail), 'governance-valid + reached + no 002 + readiness UNVERIFIED (+ complete infra) => READY_FOR_OWNER_AUTHORIZATION, readiness not asserted'); }
rm(t);
t = withAuth();
ok(stateI(t) === 'OWNER_AUTHORIZED', 'valid FINAL 002, unsupervised => OWNER_AUTHORIZED');
ok(stateI(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'BLOCKED' }) === 'OWNER_AUTHORIZED' && has(evalI(t, { ...SUPR, readinessAggregate: 'BLOCKED' }), /^R: /), 'valid 002 + supervised + BLOCKED => OWNER_AUTHORIZED, refused on R');
{ const hp = evalI(t); ok(hp.allowed === true && hp.failures.length === 0 && hp.rd19b4_contribution === 'ZERO', 'valid FINAL 002 + supervised + READY + all gates (+ fixture infra) => WOULD_EXECUTE (dry-run only); RD-19b4 ZERO'); }
ok(stateI(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'READY' }) === 'SUPERVISED_DISCOVERY_ALLOWED', 'state: SUPERVISED_DISCOVERY_ALLOWED only under fixture infra + supervised + READY');
ok(has(evalI(t, { ...SUPR, supervisedMode: false }), /^M: /), 'unsupervised => M');
ok(G.supervisedModeRequested([G.SUPERVISED_FLAG], {}) === false && G.supervisedModeRequested([], { [G.SUPERVISED_ENV]: G.SUPERVISED_ENV_VALUE }) === false && G.supervisedModeRequested([G.SUPERVISED_FLAG], { [G.SUPERVISED_ENV]: '1' }) === false && G.supervisedModeRequested([G.SUPERVISED_FLAG], { [G.SUPERVISED_ENV]: G.SUPERVISED_ENV_VALUE }) === true, 'flag-only / env-only / generic-truthy refused; exact pair supervised');
rm(t);
for (const [label, mut, re] of [
  ['authorized:false', (d) => { d.authorized = false; }, /^B: /], ['wrong authorization_id', (d) => { d.authorization_id = 'intake-execution-001'; }, /^B: /], ['wrong epoch', (d) => { d.epoch = 1; }, /^B: /],
  ['wrong Method pin', (d) => { d.pins.methodology.sha256 = 'a'.repeat(64); }, /^C: /], ['wrong Spec pin', (d) => { d.pins.experiment_spec.sha256 = 'a'.repeat(64); }, /^C: /], ['wrong freeze pin', (d) => { d.pins.experiment_freeze.sha256 = 'a'.repeat(64); }, /^D: /], ['wrong slate pin', (d) => { d.pins.pre_intake_candidate_slate.sha256 = 'a'.repeat(64); }, /^E: /], ['wrong supersession pin', (d) => { d.pins.supersession_record.sha256 = 'a'.repeat(64); }, /^F: /], ['wrong Epoch-1 terminal pin', (d) => { d.pins.epoch_1_terminal_record.sha256 = 'a'.repeat(64); }, /^N: /],
  ['wrong frozen_cutoff literal', (d) => { d.pins.frozen_cutoff = '2026-09-04T00:00:00.000Z'; d.pins.cutoff_rule_ref.computed_cutoff = '2026-09-04T00:00:00.000Z'; }, /^H: |^Q: /],
  ['template-string frozen_cutoff', (d) => { d.pins.frozen_cutoff = 'COMPUTED_BY_FORMULA_AT_RECORDING'; }, /^B: /],
  ['v0.2-pinned methodology', (d) => { d.pins.methodology.sha256 = JSON.parse(fs.readFileSync(path.join(ROOT, P.supersession), 'utf8')).supersedes.candidate_selection_method.sha256; }, /^C: |UNUSABLE FOR SUPERSEDED/],
]) { const r = withAuth((tt) => editJson(tt, P.auth002, mut)); ok(has(evalI(r), re), `final 002 with ${label} => REFUSE`); rm(r); }
t = mkRepo((tt) => fs.copyFileSync(path.join(tt, 'governance/gates/intake-execution-001.json'), path.join(tt, P.auth002)));
ok(has(evalI(t), /^B: /), 'v1 authorization copied to the 002 filename => REFUSE'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/intake-blocked-x.json', {})); ok(has(evalI(t), /^P11: intake-blocked/), 'intake-blocked record => REFUSE'); rm(t);
t = mkRepo(); { const probe = FW.checkEpoch2FinalWriteTargetAvailability(t, SH.slate); ok(probe.targetAvailable === true && probe.isFinalWriteAuthorization === false && !('allowed' in probe), 'final-write probe carries no authorization semantics'); }
writeJson(t, FW.EPOCH2_SELECTED_SLATE_PATH, {}); ok(FW.checkEpoch2FinalWriteTargetAvailability(t, SH.slate).targetAvailable === false, 'pre-existing selected output => target unavailable'); del(t, FW.EPOCH2_SELECTED_SLATE_PATH);
appendByte(t, P.slate); ok(FW.checkEpoch2FinalWriteTargetAvailability(t, SH.slate).targetAvailable === false, 'drifted shell => target unavailable'); rm(t);
ok(typeof FW.assertEpoch2FinalWriteAllowed === 'undefined', 'no final-write authorization function exported');

console.log('== MV-2 / R5-4: no-002 governance preflight — absence/mutation never READY; freeze bytes anchored ==');
// Any edit of the freeze changes its bytes => P8 anchor fires first. The granular P8 checks are
// then proven as defence-in-depth by spoofing ONLY the freeze sha fact (pure-function input).
const spoofFreezeSha = (tt) => { const repo = G.readRepoFacts(tt, INFRA); repo.sha.freeze = G.RECORDED_FREEZE_SHA; return G.evaluateEpoch2GovernancePrerequisites({ cutoff: G.safeCutoff(tt, POST), repo }); };
const NEG = [
  ['missing Method v0.3', (tt) => del(tt, P.method), /^P2: /], ['altered Method v0.3', (tt) => appendByte(tt, P.method), /^P2: /],
  ['missing Spec v0.3', (tt) => del(tt, P.spec), /^P3: /], ['altered Spec v0.3', (tt) => appendByte(tt, P.spec), /^P3: /],
  ['missing ratification.v2', (tt) => del(tt, P.ratification), /^P4: /], ['malformed ratification.v2', (tt) => fs.writeFileSync(path.join(tt, P.ratification), '{'), /^P4: /],
  ['ratification ratified:false', (tt) => editJson(tt, P.ratification, (d) => { d.ratified = false; }), /^P4: /], ['malformed ratified_at', (tt) => editJson(tt, P.ratification, (d) => { d.ratified_at = '2026-09-01'; }), /^P4: /],
  ['missing supersession', (tt) => del(tt, P.supersession), /^P5: /], ['altered supersession', (tt) => appendByte(tt, P.supersession), /^P5: /],
  ['missing clarification', (tt) => del(tt, P.clarification), /^P6: /], ['altered clarification', (tt) => appendByte(tt, P.clarification), /^P6: /],
  ['missing Epoch 1 terminal gate', (tt) => del(tt, P.epoch1Terminal), /^P7: /], ['altered Epoch 1 terminal gate', (tt) => appendByte(tt, P.epoch1Terminal), /^P7: /],
  ['missing freeze.v2', (tt) => del(tt, P.freeze), /^P8: /], ['malformed freeze.v2', (tt) => fs.writeFileSync(path.join(tt, P.freeze), 'nope'), /^P8: /],
  ['missing candidate-slate.v2', (tt) => del(tt, P.slate), /^P9: /], ['altered candidate-slate.v2', (tt) => appendByte(tt, P.slate), /^P9: /],
  ['slate schema failure', (tt) => editJson(tt, P.slate, (d) => { d.extra = true; }), /fails schema v2|^P9: /],
  ['prepopulated slate', (tt) => editJson(tt, P.slate, (d) => { d.slots[0].horizon_bucket = 'SHORT'; d.slots[0].status = 'SELECTED'; }), /^P9: /],
  ['wrong slot count', (tt) => editJson(tt, P.slate, (d) => { d.slots.pop(); }), /^P9: /],
  ['slot non-null field', (tt) => editJson(tt, P.slate, (d) => { d.slots[3].source_class = 'A'; }), /^P9: /],
  ['slot status not AWAITING', (tt) => editJson(tt, P.slate, (d) => { d.slots[5].status = 'SELECTED'; }), /^P9: /],
  ['incoherent Addendum 002 file', (tt) => writeJson(tt, P.addendum, { activation: { ratified: true, ratified_at: 'garbage' } }), /^P10: /],
  ['intake-blocked record', (tt) => writeJson(tt, 'governance/gates/intake-blocked-y.json', {}), /^P11: /],
  ['schema file missing', (tt) => del(tt, P.slateSchema), /schema missing/],
  ['weakened slate schema, same $id', (tt) => writeJson(tt, P.slateSchema, { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://fcc-record/governance/schemas/v2/candidate-slate.schema.json', type: 'object' }), /schema bytes differ/],
  ['weakened freeze schema, same $id', (tt) => writeJson(tt, P.freezeSchema, { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://fcc-record/governance/schemas/v2/experiment-freeze.schema.json', type: 'object' }), /schema bytes differ/],
];
for (const [label, mut, re] of NEG) { const tt = mkRepo(mut); const st = TO.deriveEpoch2StateWith(tt, { nowMs: POST }, INFRA); const pf = pfOf(tt); const acceptable = st.state === 'CUTOFF_REACHED_GATE_INCOMPLETE' || (st.state === 'CUTOFF_UNDEFINED' && /ratif/.test(label)); ok(acceptable && st.state !== 'READY_FOR_OWNER_AUTHORIZATION' && has(pf, re), `no-002 ${label} => ${st.state} (${re})`); rm(tt); }
const FREEZE_EDITS = [
  ['freeze schema failure', (d) => { d.unexpected_top_level_field = 1; }, /fails schema v2/],
  ['wrong cutoff inside freeze', (d) => { d.candidate_selection_methodology.frozen_epoch2_cutoff.value = '2026-09-04T00:00:00.000Z'; }, /frozen_epoch2_cutoff/],
  ['wrong Method pin inside freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.method_v0_3.sha256 = 'a'.repeat(64); }, /Method pin/],
  ['wrong Spec pin inside freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.spec_v0_3.sha256 = 'a'.repeat(64); }, /Spec pin/],
  ['wrong ratification pin inside freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.ratification_v2.sha256 = 'a'.repeat(64); }, /ratification pin/],
  ['wrong supersession pin inside freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.supersession.sha256 = 'a'.repeat(64); }, /^P5: /],
  ['wrong clarification pin inside freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.clarification.sha256 = 'a'.repeat(64); }, /^P6: /],
  ['wrong Epoch 1 terminal pin inside freeze', (d) => { d.supersedes.epoch_1_terminal_record_sha256 = 'a'.repeat(64); }, /^P7: /],
  ['slate hash != freeze candidate_slate_ref', (d) => { d.candidate_slate_ref.sha256 = 'b'.repeat(64); }, /candidate_slate_ref/],
  ['slate path != frozen path', (d) => { d.candidate_slate_ref.path = 'candidate-slate.json'; }, /path\/version/],
  ['freeze status not BLOCKED', (d) => { d.freeze_status = 'VALID'; }, /BLOCKED/],
  ['freeze N/H/S controls altered', (d) => { d.instrument_plan.slate_control.H2_band_min = 1; }, /controls/],
  ['unchecked freeze field rewritten (schema-valid)', (d) => { d.freeze_status_reason = 'rewritten'; }, null],
  ['arbitrary well-formed ratification commit', (d) => { d.candidate_selection_methodology.recorded_public_pins.ratification_v2.public_commit = 'f'.repeat(40); }, /not the known public commit/],
  ['arbitrary well-formed supersession commit', (d) => { d.candidate_selection_methodology.recorded_public_pins.supersession.public_commit = 'f'.repeat(40); }, /not the known public commit/],
  ['arbitrary well-formed clarification commit', (d) => { d.candidate_selection_methodology.recorded_public_pins.clarification.public_commit = 'f'.repeat(40); }, /not the known public commit/],
  ['arbitrary verified_against_public_main', (d) => { d.candidate_selection_methodology.recorded_public_pins.verified_against_public_main = 'f'.repeat(40); }, /verified_against_public_main/],
  ['arbitrary epoch_1_closure_public_commit', (d) => { d.supersedes.epoch_1_closure_public_commit = 'f'.repeat(40); }, /Epoch 1 closure commit/],
  ['short public_commit', (d) => { d.candidate_selection_methodology.recorded_public_pins.clarification.public_commit = '2c0cdc3'; }, /not the known public commit/],
  ['missing public_commit', (d) => { delete d.candidate_selection_methodology.recorded_public_pins.supersession.public_commit; }, /lacks its public_commit/],
  ['locally added Addendum-002 pin in freeze', (d) => { d.candidate_selection_methodology.recorded_public_pins.addendum_002 = { path: P.addendum, sha256: 'c'.repeat(64) }; }, null],
];
for (const [k] of [['method_v0_3'], ['spec_v0_3'], ['ratification_v2'], ['clarification'], ['supersession']]) FREEZE_EDITS.push([`freeze pin PATH mutated (${k})`, (d) => { d.candidate_selection_methodology.recorded_public_pins[k].path = 'governance/wrong/' + k; }, new RegExp(`recorded_public_pins\\.${k}\\.path`)]);
for (const [label, mut, innerRe] of FREEZE_EDITS) {
  const tt = mkRepo((r) => editJson(r, P.freeze, mut)); const st = TO.deriveEpoch2StateWith(tt, { nowMs: POST }, INFRA); const pf = pfOf(tt);
  const spoof = innerRe ? spoofFreezeSha(tt) : null;
  ok(st.state === 'CUTOFF_REACHED_GATE_INCOMPLETE' && has(pf, /bytes differ from the RECORDED Epoch 2 pre-cutoff freeze/) && (!innerRe || has(spoof, innerRe)), `freeze edit: ${label} => refused on exact freeze-byte anchor${innerRe ? ' (+ inner check ' + innerRe + ' as defence in depth)' : ''}`); rm(tt);
}
t = mkRepo((tt) => { writeJson(tt, P.addendum, { activation: { ratified: true, ratified_at: '2026-09-02T12:00:00Z' } }); editJson(tt, P.freeze, (d) => { d.candidate_selection_methodology.recorded_public_pins.addendum_002 = { path: P.addendum, sha256: H(path.join(tt, P.addendum)) }; }); writeJson(tt, P.auth002, finalRec()); editJson(tt, P.auth002, (d) => { d.pins.experiment_freeze.sha256 = H(path.join(tt, P.freeze)); }); });
{ const r = evalI(t); ok(r.allowed === false && r.rd19b4_contribution === 'ZERO' && has(r, /^P8: .*RECORDED/), 'R5-4: locally modified freeze carrying a new Addendum-002 pin => refused before READY; RD-19b4 stays ZERO'); } rm(t);
t = mkRepo((tt) => writeJson(tt, P.marker002, '{}')); ok(stateI(t) === 'RECONCILIATION_REQUIRED', 'invalid completion marker => RECONCILIATION_REQUIRED'); rm(t);

console.log('== R5-2 / R5-3 / MV-1 / RV4-2: closed FINAL 002 ==');
ok(shape(finalRec()).length === 0, 'closed finalized shape (with fixture infrastructure pins) => accepted');
ok(G.validateAuthorizationShapeV2(finalRec(), 'intake-execution-002.json').length > 0 && /does not equal the recorded pin|recorded execution HEAD/.test(G.validateAuthorizationShapeV2(finalRec(), 'intake-execution-002.json').join()), 'R5-6: the SAME fixture record under PRODUCTION infrastructure => refused because its pins differ');
for (const [label, mut, re] of [
  ['status DRAFT_NOT_AUTHORIZED field', (d) => { d.status = 'DRAFT_NOT_AUTHORIZED'; }, /unexpected top-level|non-authority word/],
  ['revoked:true field', (d) => { d.revoked = true; }, /unexpected top-level/],
  ['owner_authorization.revoked', (d) => { d.owner_authorization.revoked = true; }, /unexpected owner_authorization/],
  ['duplicate authority field owner_authorized', (d) => { d.owner_authorized = false; }, /unexpected top-level/],
  ['missing predecessor', (d) => { delete d.predecessor; }, /predecessor/],
  ['wrong predecessor record', (d) => { d.predecessor.record = 'governance/gates/intake-execution-000.json'; }, /predecessor\.record/],
  ['predecessor state not describing preserved/unspent/unusable', (d) => { d.predecessor.state = 'superseded'; }, /predecessor\.state/],
  ['extra predecessor field', (d) => { d.predecessor.spent = true; }, /unexpected predecessor/],
  ['DRAFT word inside a string', (d) => { d.predecessor.state += ' (DRAFT)'; }, /non-authority word/],
  ['PENDING word inside a string', (d) => { d.owner_authorization.scope = G.OWNER_AUTH_SCOPE; d.predecessor.state += ' PENDING'; }, /non-authority word/],
  ['wrong epoch_1 public_commit', (d) => { d.pins.epoch_1_terminal_record.public_commit = 'f'.repeat(40); }, /Epoch 1 closure commit/],
  ['extra scope field', (d) => { d.scope.also = 'x'; }, /unexpected scope/],
  ['extra pins field', (d) => { d.pins.extra = { sha256: 'a'.repeat(64) }; }, /unexpected pins/],
  ['extra field inside a pin', (d) => { d.pins.methodology.note = 'x'; }, /unexpected pins\.methodology/],
  ['_DRAFT_NOTICE', (d) => { d._DRAFT_NOTICE = 'x'; }, /_DRAFT_NOTICE|unexpected top-level/],
  ['owner_ratification_required:true', (d) => { d.owner_ratification_required = true; }, /owner_ratification_required/],
  ['placeholder recorded_at', (d) => { d.recorded_at = 'TO_BE_SET_AT_RECORDING'; }, /recorded_at/],
  ['impossible calendar recorded_at', (d) => { d.recorded_at = '2026-99-99T99:99:99Z'; }, /recorded_at/],
  ['impossible calendar authorized_at', (d) => { d.owner_authorization.authorized_at = '2026-99-99T99:99:99Z'; }, /authorized_at/],
  ['missing owner_authorization', (d) => { delete d.owner_authorization; }, /owner_authorization/],
  ['wrong owner_authorization.state', (d) => { d.owner_authorization.state = 'OWNER_REVIEWED'; }, /owner_authorization\.state/],
  ['scope broader than one execution', (d) => { d.owner_authorization.scope = 'all Epoch 2 executions'; }, /owner_authorization\.scope/],
  ['scope.what_is_authorized UNBOUNDED', (d) => { d.scope.what_is_authorized = 'UNBOUNDED'; }, /what_is_authorized/],
  ['not_a_capital_instrument false', (d) => { d.not_a_capital_instrument = false; }, /not_a_capital_instrument/],
  ['noncanonical completion marker path', (d) => { d.scope.completion_marker_path = 'governance/gates/x.json'; }, /completion_marker_path/],
  ['pin path not canonical', (d) => { d.pins.methodology.path = 'somewhere/else.md'; }, /pins\.methodology\.path/],
  ['TO_BE_PINNED in a pin', (d) => { d.pins.experiment_freeze.sha256 = 'TO_BE_PINNED'; }, /pins\.experiment_freeze/],
  ['addendum placeholder', (d) => { d.pins.source_registry_addendum_002.sha256 = 'TO_BE_PINNED_IF_RATIFIED_BEFORE_CUTOFF'; }, /source_registry_addendum_002/],
  ['addendum 64-hex (activation attempt)', (d) => { d.pins.source_registry_addendum_002.sha256 = 'c'.repeat(64); }, /exactly ABSENT/],
  ['addendum path not canonical', (d) => { d.pins.source_registry_addendum_002.path = 'x.json'; }, /source_registry_addendum_002\.path/],
  ['copied cutoff_rule object present', (d) => { d.pins.cutoff_rule = { rule_id: G.CANONICAL_CUTOFF_RULE_ID }; }, /cutoff_rule \(copied descriptive object\)|unexpected pins/],
  ['stale copied wording NOT COMPUTED', (d) => { d.predecessor.state += ' NOT COMPUTED in this draft.'; }, /placeholder\/stale wording/],
  ['missing cutoff_rule_ref', (d) => { delete d.pins.cutoff_rule_ref; }, /cutoff_rule_ref/],
  ['cutoff_rule_ref wrong source sha', (d) => { d.pins.cutoff_rule_ref.source_sha256 = 'a'.repeat(64); }, /source_sha256/],
  ['cutoff_rule_ref wrong source path', (d) => { d.pins.cutoff_rule_ref.source_path = 'x.json'; }, /source_path/],
  ['cutoff_rule_ref wrong field', (d) => { d.pins.cutoff_rule_ref.source_field = 'x'; }, /source_field/],
  ['cutoff_rule_ref computed != frozen', (d) => { d.pins.cutoff_rule_ref.computed_cutoff = '2026-09-04T00:00:00.000Z'; }, /computed_cutoff/],
  ['cutoff_rule_ref extra key', (d) => { d.pins.cutoff_rule_ref.note = 'x'; }, /unexpected pins\.cutoff_rule_ref/],
  ['impossible frozen_cutoff', (d) => { d.pins.frozen_cutoff = '2026-13-01T00:00:00.000Z'; }, /frozen_cutoff/],
  ['missing execution_infrastructure pins', (d) => { delete d.pins.execution_infrastructure; }, /execution_infrastructure missing/],
  ['execution_infrastructure pin differs from recorded set', (d) => { d.pins.execution_infrastructure.v2_discovery_runner.sha256 = 'a'.repeat(64); }, /does not equal the recorded pin/],
  ['execution_head differs', (d) => { d.pins.execution_infrastructure.execution_head = 'cd'.repeat(20); }, /execution_head/],
  ['wrong artifact_class', (d) => { d.artifact_class = 'DRAFT'; }, /artifact_class/], ['wrong gate', (d) => { d.gate = 'OTHER'; }, /gate/],
]) { const d = finalRec(); mut(d); ok(shape(d).some((x) => re.test(x)), `final-002 ${label} => REFUSE`); }
ok(G.validateAuthorizationShapeV2(finalRec(), 'intake-execution-002.DRAFT.json', INFRA).length > 0, 'DRAFT filename never authoritative');
{ const dl = finalRec(); dl._DRAFT_NOTICE = 'DRAFT — UNSIGNED, NOT AUTHORIZED'; dl.recorded_at = 'TO_BE_SET_AT_RECORDING'; dl.owner_ratification_required = true; dl.owner_authorization.state = 'TO_BE_SET_AT_RECORDING'; const pr = shape(dl); ok(pr.length >= 4, 'renamed DRAFT template with authorized flipped => REFUSE on multiple independent indicators'); }
t = withAuth((tt) => editJson(tt, P.auth002, (d) => { d.pins.cutoff_rule_ref.source_sha256 = 'a'.repeat(64); }));
ok(has(evalI(t), /^B: /), 'cutoff_rule_ref not referencing the recorded freeze => refused (shape)'); rm(t);
t = withAuth(); ok(!has(evalI(t), /^Q: /), 'mechanical cutoff_rule_ref referencing the recorded freeze bytes + resolver cutoff => Q satisfied'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/intake-execution-003.json', Object.assign(finalRec(), { authorization_id: 'intake-execution-002' })));
ok(has(evalI(t), /^B: conflicting/), 'conflicting Epoch 2 authorization record (003 claiming id 002) => REFUSE'); rm(t);
t = withAuth((tt) => fs.writeFileSync(path.join(tt, P.auth002), '{ not json')); ok(has(evalI(t), /^B: .*malformed/), 'malformed 002 JSON => REFUSE'); rm(t);

console.log('== R5-1: authorization chronology ==');
for (const [label, mut, re, expectRefuse] of [
  ['authorized_at before cutoff', (d) => { d.owner_authorization.authorized_at = '2026-09-02T23:59:59Z'; }, /^T: .*precedes the canonical cutoff/, true],
  ['recorded_at before authorized_at', (d) => { d.recorded_at = '2026-09-03T00:59:59Z'; }, /^T: recorded_at precedes/, true],
  ['both timestamps in 2099', (d) => { d.owner_authorization.authorized_at = '2099-01-01T00:00:00Z'; d.recorded_at = '2099-01-01T00:00:01Z'; }, /^T: recorded_at is in the future/, true],
  ['recorded_at 1s after evaluation time', (d) => { d.owner_authorization.authorized_at = '2026-09-04T12:00:00Z'; d.recorded_at = '2026-09-04T12:00:01Z'; }, /^T: recorded_at is in the future/, true],
  ['authorized_at == cutoff instant (boundary)', (d) => { d.owner_authorization.authorized_at = '2026-09-03T00:00:00Z'; d.recorded_at = '2026-09-03T00:00:00Z'; }, /^T: /, false],
  ['recorded_at == authorized_at (boundary)', (d) => { d.recorded_at = d.owner_authorization.authorized_at; }, /^T: /, false],
  ['recorded_at == evaluation time (boundary)', (d) => { d.owner_authorization.authorized_at = '2026-09-04T12:00:00Z'; d.recorded_at = '2026-09-04T12:00:00Z'; }, /^T: /, false],
]) { const r = withAuth((tt) => editJson(tt, P.auth002, mut)); const e = evalI(r); ok(expectRefuse ? has(e, re) : (!has(e, re) && e.allowed === true), `chronology: ${label} => ${expectRefuse ? 'REFUSE' : 'accepted'}`); rm(r); }

console.log('== MV-3 / RV4-4 / R5-1: completion ==');
function completionSelection() {
  const src = [['A1', 5], ['B2', 25], ['E1', 60]], pool = [];
  for (const [sourceId, days] of src) for (let i = 0; i < 5; i++) pool.push({ sourceId, canonicalId: `${sourceId}-${i}`, openedAt: '2026-09-02T00:00:00.000Z', resolutionDate: new Date(Date.parse(CUT) + (days + i) * 86400000).toISOString(), observableType: 'OBS_SOURCE_NATIVE_DATE', assetId: `${sourceId}-asset-${i}`, title: `${sourceId} candidate ${i}`, qualificationStanceShaped: true, subjectTouchesFederation: false, materialRisk: i === 0, possibleDuplicateRefs: [] });
  return SEL.selectEpoch2(pool, { cutoff: CUT });
}
const selDoc = (authSha) => WRITER.buildSelectedSlate({ result: completionSelection(), authorizationSha: authSha, shellSha: SH.slate, lineage: { methodology: SH.method, experiment_spec: SH.spec, experiment_freeze: SH.freeze, supersession_record: SH.supersession }, completedAt: '2026-09-03T02:00:00Z' });
function completeRepo(mutMarker, mutOther) {
  return withAuth((tt) => {
    const authSha = H(path.join(tt, P.auth002)); writeJson(tt, FW.EPOCH2_SELECTED_SLATE_PATH, selDoc(authSha));
    const marker = { artifact_class: 'GOVERNANCE_EXECUTION_COMPLETION', gate: 'CANDIDATE_INTAKE_EXECUTION', authorization_id: 'intake-execution-002', completed_at: '2026-09-03T02:00:05Z', single_use_consumed: true, selected_slate: { path: P.selected, sha256: H(path.join(tt, FW.EPOCH2_SELECTED_SLATE_PATH)) }, authorization_record: { path: P.auth002, sha256: authSha }, cutoff: CUT, pristine_shell: { path: P.slate, sha256: SH.slate }, lineage: { methodology: SH.method, experiment_spec: SH.spec, experiment_freeze: SH.freeze, supersession_record: SH.supersession } };
    if (mutMarker) mutMarker(marker, tt); writeJson(tt, P.marker002, marker); if (mutOther) mutOther(tt);
  });
}
t = completeRepo(); { const cst = TO.deriveEpoch2StateWith(t, { nowMs: POST }, INFRA); ok(cst.state === 'EXECUTION_COMPLETE_SPENT', 'fully bound completion under the recorded schema => EXECUTION_COMPLETE_SPENT'); }
ok(has(evalI(t), /^P11: .*completion marker/), 'completion marker present => execution permanently REFUSED'); rm(t);
for (const [label, mm, mo] of [
  ['empty {} marker', (m) => { for (const k of Object.keys(m)) delete m[k]; }], ['wrong authorization_id', (m) => { m.authorization_id = 'intake-execution-001'; }], ['malformed completed_at', (m) => { m.completed_at = 'now'; }], ['impossible completed_at', (m) => { m.completed_at = '2026-99-99T99:99:99Z'; }],
  ['completed_at before recorded_at', (m) => { m.completed_at = '2026-09-03T00:30:00Z'; }], ['completed_at in the future', (m) => { m.completed_at = '2027-01-01T00:00:00Z'; }],
  ['selected hash drift', (m) => { m.selected_slate.sha256 = 'a'.repeat(64); }], ['wrong cutoff', (m) => { m.cutoff = '2026-09-04T00:00:00.000Z'; }], ['wrong pristine_shell', (m) => { m.pristine_shell.sha256 = 'a'.repeat(64); }],
  ['unauthorized 002 + bound marker', null, (tt) => editJson(tt, P.auth002, (d) => { d.authorized = false; })], ['missing selected artifact', null, (tt) => del(tt, FW.EPOCH2_SELECTED_SLATE_PATH)], ['selected schema absent', null, (tt) => del(tt, P.selectedSchema)],
]) { const r = completeRepo(mm, mo); const st = TO.deriveEpoch2StateWith(r, { nowMs: POST }, INFRA); ok(st.state === 'RECONCILIATION_REQUIRED', `marker ${label} => RECONCILIATION_REQUIRED`); rm(r); }
t = completeRepo(null, (tt) => editJson(tt, P.auth002, (d) => { d.authorized = false; })); { const st = TO.deriveEpoch2StateWith(t, { nowMs: POST }, INFRA); ok(/authorization: B: /.test(st.detail), 'unauthorized 002 named explicitly in the reconciliation detail'); } rm(t);
t = completeRepo((m) => { m.completed_at = '2026-09-03T00:30:00Z'; }); { const v = G.validateEpoch2CompletionMarker(t, G.readRepoFacts(t, INFRA), G.safeCutoff(t, POST), POST); ok(v.problems.some((p) => /completed_at precedes recorded_at/.test(p)), 'R5-1: completion chronology recorded_at <= completed_at enforced'); } rm(t);

console.log('== R5-6: recorded execution infrastructure (PRODUCTION surfaces) ==');
t = mkRepo(); ok(G.deriveEpoch2State(t, { nowMs: POST }).state === 'READY_FOR_OWNER_AUTHORIZATION', 'production deriver, governance-valid, post-cutoff, no 002 => READY_FOR_OWNER_AUTHORIZATION');
ok(/owner authorization record.*ABSENT/.test(G.deriveEpoch2State(t, { nowMs: POST }).detail), 'state detail names the absent owner authorization and does not imply execution'); rm(t);
t = withAuth(); { const r = G.evaluateEpoch2FromRepo(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'READY' }); ok(r.allowed === false && !has(r, /^P13: /) && has(r, /^B: /), 'production rejects a 002 carrying fictional fixture pins while recorded infrastructure remains valid'); }
ok(G.deriveEpoch2State(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'READY' }).state === 'CUTOFF_REACHED_GATE_INCOMPLETE', 'production never accepts a 002 whose infrastructure pins differ from the recorded set'); rm(t);
t = withProductionAuth(); { const r = G.evaluateEpoch2FromRepo(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'READY' }); ok(r.allowed === true && r.failures.length === 0, 'production pure evaluator accepts an exactly pinned FINAL 002 only with supervised + READY inputs'); }
ok(G.deriveEpoch2State(t, { nowMs: POST, supervisedMode: true, readinessAggregate: 'READY' }).state === 'SUPERVISED_DISCOVERY_ALLOWED', 'fully pinned production state can reach SUPERVISED_DISCOVERY_ALLOWED after separate owner authorization'); rm(t);
ok(G.executionInfrastructureStatus().complete === true && G.executionInfrastructureStatus().missing.length === 0, 'production EXECUTION_INFRASTRUCTURE has all seven components recorded');
ok(G.verifyExecutionInfrastructureFiles(ROOT).valid, 'production infrastructure files match every recorded hash');
t = mkRepo((tt) => appendByte(tt, G.EXECUTION_INFRASTRUCTURE.deterministic_selection.path)); ok(has(G.evaluateEpoch2FromRepo(t, { nowMs: POST }), /^P13: EXECUTION_INFRASTRUCTURE_DRIFT/), 'one-byte drift in a named execution component => P13 REFUSE'); rm(t);
t = mkRepo((tt) => del(tt, 'tools/lib/live-acquisition-provider.js')); ok(has(G.evaluateEpoch2FromRepo(t, { nowMs: POST }), /^P13: EXECUTION_INFRASTRUCTURE_DRIFT/), 'missing pinned acquisition provider => P13 REFUSE'); rm(t);
ok(G.executionInfrastructureStatus(INFRA).complete === true, 'fixture infrastructure is complete (test surface only)');
for (const k of ['selected_slate_schema', 'v2_discovery_runner', 'deterministic_selection', 'selected_slate_writer', 'completion_marker_writer_verifier']) { const i = JSON.parse(JSON.stringify(INFRA)); i[k].sha256 = null; ok(!G.executionInfrastructureStatus(i).complete && TO.deriveEpoch2StateWith(mkRepo(), { nowMs: POST }, i).state === 'EXECUTION_INFRASTRUCTURE_INCOMPLETE', `missing ${k} pin => EXECUTION_INFRASTRUCTURE_INCOMPLETE`); }
{ const i = JSON.parse(JSON.stringify(INFRA)); i.execution_head = null; ok(TO.deriveEpoch2StateWith(mkRepo(), { nowMs: POST }, i).state === 'EXECUTION_INFRASTRUCTURE_INCOMPLETE', 'missing execution_head => EXECUTION_INFRASTRUCTURE_INCOMPLETE'); }
{ const i = JSON.parse(JSON.stringify(INFRA)); i.execution_critical_tooling_hashes = null; ok(TO.deriveEpoch2StateWith(mkRepo(), { nowMs: POST }, i).state === 'EXECUTION_INFRASTRUCTURE_INCOMPLETE', 'missing tooling hashes => EXECUTION_INFRASTRUCTURE_INCOMPLETE'); }

console.log('== R5-5 / R5-8: readiness TRANSACTION provenance and process authority ==');
const HEAD = 'ab'.repeat(20); const NOW = Date.parse('2026-09-03T01:30:00Z');
const blobs = { 'tools/verify-acquisition-readiness.js': 'console.log("AGGREGATE INTAKE_READINESS: BLOCKED")' };
for (const rel of PROBE.EXECUTION_CRITICAL_TOOLING) if (!blobs[rel]) blobs[rel] = '// ' + rel;
function fakeSys(over = {}) {
  const disk = Object.assign({}, blobs, over.disk || {});
  let calls = 0;
  return Object.assign({
    git: (repoRoot, args) => { if (args[0] === 'status') return { status: 0, stdout: over.porcelain || '' }; if (args[0] === 'rev-parse') { calls++; return { status: 0, stdout: (over.headSeq && over.headSeq[calls - 1]) || HEAD }; } if (args[0] === 'show') { const rel = args[1].split(':')[1]; return blobs[rel] ? { status: 0, stdout: blobs[rel] } : { status: 128, stdout: '' }; } return { status: 1, stdout: '' }; },
    runVerifier: () => ({ status: over.exit === undefined ? 0 : over.exit, stdout: over.stdout || 'AGGREGATE INTAKE_READINESS: BLOCKED\n' }),
    readFile: (repoRoot, rel) => (disk[rel] === undefined ? null : Buffer.from(disk[rel])),
    now: () => new Date(over.now === undefined ? NOW - 2000 : over.now),
  }, over.sys || {});
}
const run = (over) => PROBE.__testOnly.runReadinessTransactionWith(fakeSys(over), '/x');
const prov = (res, nowMs = NOW, headSha = HEAD) => PROBE.validateReadinessProvenance(res, { nowMs, headSha });
{ const r = run(); ok(r.tree_clean_before && r.tree_clean_after && r.tooling_verified && r.head_before === HEAD && r.head_after === HEAD && r.exit_status === 0 && r.aggregate === 'BLOCKED', 'clean transaction: tree clean, HEAD stable, tooling == HEAD blobs, verifier run, aggregate parsed'); ok(prov(r).valid === true && prov(r).aggregate === 'BLOCKED', 'clean transaction validates with post-probe HEAD/time'); }
{ const r = run({ porcelain: ' M tools/verify-acquisition-readiness.js\n' }); ok(r.tree_clean_before === false && r.exit_status === null, 'dirty (modified, unstaged) readiness verifier => transaction refuses to run the verifier'); ok(!prov(r).valid && prov(r).problems.some((p) => /not clean before/.test(p)), 'dirty tree => provenance invalid'); }
{ const r = run({ porcelain: 'M  tools/verify-acquisition-readiness.js\n' }); ok(r.tree_clean_before === false && r.exit_status === null, 'staged readiness-verifier modification => refused'); }
{ const r = run({ porcelain: '?? tools/lib/rogue.js\n' }); ok(r.tree_clean_before === false, 'untracked file in the tree => refused'); }
{ const r = run({ disk: { 'tools/verify-acquisition-readiness.js': 'console.log("AGGREGATE INTAKE_READINESS: READY")' }, stdout: 'AGGREGATE INTAKE_READINESS: READY\n' }); ok(r.tooling_verified === false && r.exit_status === null && r.aggregate === null, 'R5-5: working-tree verifier printing READY while HEAD blob differs => tooling_verified false, verifier NOT run, no READY'); ok(!prov(r).valid && prov(r).problems.some((p) => /HEAD blobs/.test(p)), 'modified verifier bytes => provenance invalid'); }
{ const r = run({ disk: { 'tools/lib/epoch2-intake-authorization.js': '// tampered' } }); ok(r.tooling_verified === false, 'any execution-critical tooling file differing from HEAD => refused'); }
{ const r = run({ headSeq: [HEAD, 'cd'.repeat(20)] }); ok(r.head_before !== r.head_after && !prov(r).valid && prov(r).problems.some((p) => /HEAD changed/.test(p)), 'HEAD change during probe => provenance invalid'); }
{ const r = run(); ok(!prov(r, NOW, 'cd'.repeat(20)).valid, 'probe bound to a different HEAD than the post-probe HEAD => invalid'); ok(!prov(r, NOW + 11 * 60 * 1000).valid && prov(r, NOW + 11 * 60 * 1000).problems.some((p) => /stale/.test(p)), 'stale (measured from completed_at) => invalid'); ok(!prov(r, NOW - 60 * 60 * 1000).valid, 'future-dated relative to post-probe time => invalid'); }
{ const r = run({ exit: 1, stdout: 'AGGREGATE INTAKE_READINESS: READY\n' }); ok(r.aggregate === null && !prov(r).valid, 'nonzero verifier exit => no aggregate, invalid'); }
ok(!prov(TO.parseReadinessOutput('AGGREGATE INTAKE_READINESS: READY', '2026-09-03T01:29:30Z')).valid, 'caller-forged readiness via the fixture helper => never valid provenance');
ok(!prov('READY').valid && !prov({ aggregate: 'READY' }).valid, 'bare strings/objects => invalid');
// process entry
t = withAuth();
{ const cleanProbe = () => run({ stdout: 'AGGREGATE INTAKE_READINESS: READY\n' }); const pr = TO.evaluateForProcessWithDeps(t, { argv: [G.SUPERVISED_FLAG], env: { [G.SUPERVISED_ENV]: G.SUPERVISED_ENV_VALUE }, probe: cleanProbe, nowMs: NOW, headSha: HEAD }); ok(pr.test_only === true && pr.production === false && pr.executable === false, 'R5-8: injected process helper reports test_only:true / production:false / executable:false'); ok(!has(pr, /^M: /) && !has(pr, /^R: /) && has(pr, /^B: /) && !has(pr, /^P13: /), 'injected valid provenance: no M/R/P13; fictional authorization pins still refused on B'); }
{ const pr = TO.evaluateForProcessWithDeps(t, { argv: [G.SUPERVISED_FLAG], env: { [G.SUPERVISED_ENV]: G.SUPERVISED_ENV_VALUE }, probe: () => run({ porcelain: ' M x\n' }), nowMs: NOW, headSha: HEAD }); ok(has(pr, /^R: .*not clean/), 'dirty-tree probe through the process core => R with provenance detail'); }
ok(has(TO.evaluateForProcessWithDeps(t, { argv: [G.SUPERVISED_FLAG], env: {}, probe: () => run(), nowMs: NOW, headSha: HEAD }), /^M: /) && has(TO.evaluateForProcessWithDeps(t, { argv: [], env: { [G.SUPERVISED_ENV]: G.SUPERVISED_ENV_VALUE }, probe: () => run(), nowMs: NOW, headSha: HEAD }), /^M: /) && has(TO.evaluateForProcessWithDeps(t, { argv: [G.SUPERVISED_FLAG], env: { [G.SUPERVISED_ENV]: 'true' }, probe: () => run(), nowMs: NOW, headSha: HEAD }), /^M: /), 'process core: flag-only / env-only / generic-truthy => M');
rm(t);
const prodSrc = G.evaluateEpoch2ForProcess.toString();
ok(G.evaluateEpoch2ForProcess.length === 1 && /process\.argv/.test(prodSrc) && /process\.env/.test(prodSrc) && /runReadinessProbe/.test(prodSrc) && prodSrc.indexOf('runReadinessProbe') < prodSrc.indexOf('currentHead') && prodSrc.indexOf('currentHead') < prodSrc.indexOf('Date.now()') && /executable: r\.allowed === true && r\.readinessProvenance\.valid === true/.test(prodSrc) && /production: true/.test(prodSrc), 'PRODUCTION entry: single arg, runs the probe, re-reads HEAD/time, and exposes executable only when allowed + provenance-valid');
ok(!('parseReadinessOutput' in G) && !('_evaluateEpoch2ForProcessWithDeps' in G) && !('evaluateForProcessWithDeps' in G) && TO.test_only === true, 'R5-8: fixture helpers exist only under __testOnly');
const guardSrc = fs.readFileSync(path.join(__dirname, 'ci-intake-guard.js'), 'utf8'); const modSrc = fs.readFileSync(path.join(__dirname, 'lib', 'epoch2-intake-authorization.js'), 'utf8'); const probeSrc = fs.readFileSync(path.join(__dirname, 'lib', 'epoch2-readiness-probe.js'), 'utf8'); const fwSrc = fs.readFileSync(path.join(__dirname, 'lib', 'intake-final-write.js'), 'utf8');
ok(![guardSrc, probeSrc, fwSrc, modSrc].some((x) => /\.__testOnly\b/.test(x)), 'no production module uses a __testOnly surface (member access absent everywhere in production code)');
const spawnRe = new RegExp('spa' + 'wnSync\\(', 'g'); const probeForbidden = new RegExp(['run-candidate-' + 'intake', 'executeFinal' + 'Write', 'acqu' + 'ire'].join('|'));
const gitSpawnRe = new RegExp('spa' + "wnSync\\('git'");
ok((probeSrc.match(spawnRe) || []).length === 2 && gitSpawnRe.test(probeSrc) && /READINESS_SOURCE\)\]/.test(probeSrc) && !probeForbidden.test(probeSrc), 'probe lib spawns exactly git and the readiness tool — never discovery, runner or writer');
const modForbidden = new RegExp(['child_' + 'process', 'spa' + 'wnSync\\(', 'exec' + 'Sync', 'executeFinal' + 'Write', 'run-candidate-' + 'intake'].join('|'));
ok(!modForbidden.test(modSrc), 'gate module never spawns or invokes discovery/final write');

console.log('== MV-6 / RV4-1 / R5-7: CI guard decision, selected artifacts, conflict boundaries ==');
t = mkRepo(); ok(G.decideEpoch2GuardCase(t, { nowMs: PRE }).pass === true, 'guard: no 002 => E2 PASS');
ok(G.decideEpoch2GuardCase(t, { nowMs: POST }).pass === true, 'guard: post-cutoff, no 002, infrastructure pinned => E2 PASS (nothing to verify; intake unauthorized)'); rm(t);
t = withAuth(); { const d = G.decideEpoch2GuardCase(t, { nowMs: POST }); ok(d.pass === false && /fails integrity verification: B:/.test(d.why), 'guard: 002 carrying fictional infrastructure pins => E2 FAIL'); } rm(t);
t = withAuth((tt) => editJson(tt, P.auth002, (x) => { x.pins.experiment_freeze.sha256 = 'e'.repeat(64); })); ok(G.decideEpoch2GuardCase(t, { nowMs: POST }).pass === false, 'guard: drifted pin => FAIL'); rm(t);
t = withAuth((tt) => fs.writeFileSync(path.join(tt, P.auth002), '{')); ok(/malformed/.test(G.decideEpoch2GuardCase(t, { nowMs: POST }).why), 'guard: malformed 002 => FAIL naming malformed'); rm(t);
ok(/decideEpoch2GuardCase\(ROOT\)/.test(guardSrc), 'ci-intake-guard.js calls decideEpoch2GuardCase(ROOT) with the real clock');
const withSel = (mut) => mkRepo((tt) => { writeJson(tt, P.selected, { premature: true }); if (mut) mut(tt); });
t = withSel(); ok(stateI(t) === 'RECONCILIATION_REQUIRED' && G.decideEpoch2GuardCase(t, { nowMs: PRE }).pass === false && has(pfOf(t), /^P12: /), 'premature selected artifact, no 002 => RECONCILIATION_REQUIRED; guard FAIL; P12'); rm(t);
t = withSel((tt) => writeJson(tt, P.auth002, finalRec())); ok(stateI(t, SUPR) === 'RECONCILIATION_REQUIRED', 'selected artifact + valid 002 + no marker => RECONCILIATION_REQUIRED'); rm(t);
t = mkRepo((tt) => writeJson(tt, 'governance/experiments/stage0-public-experiment-v1/candidate-slate.v2.SELECTED.json', {})); ok(stateI(t) === 'RECONCILIATION_REQUIRED' && G.decideEpoch2GuardCase(t, { nowMs: PRE }).pass === false, 'lookalike selected path => RECONCILIATION_REQUIRED; guard FAIL'); rm(t);
// R5-7 conflict boundaries
t = withAuth((tt) => writeJson(tt, 'governance/gates/epoch2-owner-authorization.json', finalRec())); ok(has(evalI(t), /^B: conflicting\/noncanonical .*epoch2-owner-authorization/) && G.decideEpoch2GuardCase(t, { nowMs: POST }).pass === false, 'content claimant (id 002) under a nonmatching filename => conflict'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/some-record.json', { gate: 'CANDIDATE_INTAKE_EXECUTION', epoch: 2 })); ok(has(evalI(t), /^B: conflicting/), 'epoch 2 + intake gate (no id) => conflict'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/note.json', { scope: { what_is_authorized: G.OWNER_AUTH_SCOPE } })); ok(has(evalI(t), /^B: conflicting/), 'R5-7: nonstandard JSON carrying the exact canonical Epoch 2 scope => conflict'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/note2.json', { scope: { completion_marker_path: P.marker002 } })); ok(has(evalI(t), /^B: conflicting/), 'R5-7: nonstandard JSON carrying the canonical 002 completion-marker path => conflict'); rm(t);
t = withAuth((tt) => fs.writeFileSync(path.join(tt, 'governance/gates/intake-execution-002-final.json'), '{ broken')); ok(has(evalI(t), /^B: conflicting.*malformed/), 'malformed file whose NAME claims the namespace => fails closed'); rm(t);
t = withAuth((tt) => writeJson(tt, 'governance/gates/build07-report-authorization.json', { artifact_class: 'GOVERNANCE_EXECUTION_AUTHORIZATION', gate: 'REPORT_PUBLICATION', epoch: 1, authorization_id: 'report-publication-001', authorized: true }));
{ const r = evalI(t); ok(!has(r, /^B: /) && r.allowed === true, 'R5-7: unrelated GOVERNANCE_EXECUTION_AUTHORIZATION (other gate, epoch 1) does NOT conflict'); } rm(t);
t = withAuth(); ok(!has(evalI(t), /^B: /), 'lawful gates dir raises no false conflict'); rm(t);

console.log('== Addendum 002: permanent ZERO for Epoch 2 ==');
const addDoc = (at) => ({ artifact_class: 'SOURCE_REGISTRY_ADDENDUM', activation: { ratified: true, ratified_at: at } });
t = withAuth((tt) => writeJson(tt, P.addendum, addDoc('2026-08-01T00:00:00Z'))); { const r = evalI(t); ok(r.allowed === true && r.rd19b4_contribution === 'ZERO', 'backdated self-declared addendum on disk => ignored; ZERO; core gate unaffected'); } rm(t);
t = withAuth((tt) => writeJson(tt, P.addendum, addDoc('2026-09-03T00:00:00Z'))); ok(evalI(t).rd19b4_contribution === 'ZERO', 'post-cutoff addendum => ZERO'); rm(t);
ok(!('addendum_002' in JSON.parse(fs.readFileSync(path.join(ROOT, P.freeze), 'utf8')).candidate_selection_methodology.recorded_public_pins), 'recorded freeze carries no addendum pin => permanently ABSENT for Epoch 2');

// self-scan + real-repo untouched
const src = fs.readFileSync(__filename, 'utf8');
const forbidden = [new RegExp('require\\([^)]*candidate-' + 'intake'), new RegExp('spawn' + 'Sync|child_' + 'process'), new RegExp('executeFinal' + 'Write\\s*\\('), new RegExp('acquire' + '-live|require\\([\'"]https?[\'"]\\)|fet' + 'ch\\(|axi' + 'os')];
ok(forbidden.every((re) => !re.test(src)), 'no test invokes the runner, spawns a process, calls the final-write executor, or touches the network');
const real002 = JSON.parse(fs.readFileSync(path.join(ROOT, P.auth002), 'utf8'));
ok(G.validateAuthorizationShapeV2(real002, 'intake-execution-002.json').length === 0, 'real production 002 is exact-shape valid against the recorded infrastructure pins');
ok(G.deriveEpoch2State(ROOT, { nowMs: Date.now() }).state === 'OWNER_AUTHORIZED', 'real production state is OWNER_AUTHORIZED without supervision or live readiness');
const realEval = G.evaluateEpoch2FromRepo(ROOT, { nowMs: Date.now(), supervisedMode: false, readinessAggregate: null });
ok(realEval.allowed === false && has(realEval, /^M: /) && has(realEval, /^R: /), 'real production authorization remains refused without owner-present supervision and live READY provenance');
ok(!fs.existsSync(path.join(ROOT, P.marker002)) && !fs.existsSync(path.join(ROOT, FW.EPOCH2_SELECTED_SLATE_PATH)), 'real repository untouched by tests: no marker and no selected artifact');
console.log(`\nEPOCH2 AUTHORIZATION GATE SUITE (REV5): ${n - fails} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
