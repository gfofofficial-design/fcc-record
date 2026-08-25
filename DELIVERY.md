# DELIVERY ARCHIVE: SOURCE SNAPSHOT — .git intentionally excluded

This archive is a source snapshot only. It does not contain `.git`, and no
git history is delivered or independently inspectable from it. Any local
development history that exists in the build environment is NOT evidence
delivered to the owner and should not be treated as such.

**Recommended genesis procedure** (verified working in the required
clean-room test for this build): extract this archive, run `git init`,
commit the complete tree as one commit — that commit becomes the actual
public genesis of `fcc-record` when pushed to GitHub. Genesis contents
already include the controlling frozen document hashes and evidence under
`governance/frozen/` and `governance/evidence/`.

## BUILD 03 contents (this snapshot)

Witness / commit-point / OTS orchestration per the ratified BUILD 03
architecture (AD-1..AD-4 + sequencing clarification):
`tools/lock-run-orchestrator.js` (P1–P12 production entry point; P4
persistent-hold gate + AD-1 strengthened dual-witness prior-publication
probe, fail-closed; crash/startup recovery; exact-byte retry/catch-up),
`tools/lib/lock-run-journal.js` (fsync+atomic persistent journal at
git-ignored `staging/lock-runs/`), `tools/lib/witness-transports.js`
(mock-only transports; production constructors THROW),
`tools/lib/witness-classifier.js` (SUCCESS/FAILURE/UNCERTAIN; AD-4
anonymous-readback-normative git; AD-3 production Telegram classifier
GATED — throws), `tools/lib/commit-point.js`,
`tools/lib/instrument-events.js` (witness receipts inside the frozen
hash-chained event vocabulary), `tools/lib/ots-wrapper.js` (append-only
proof versioning `{seq}-{state}-{ulid}.ots`; cause A/B anchor classifier;
TERMINAL anchor gate; production stamping THROWS), `tools/lib/ulid.js`,
and `tools/run-build03-tests.js` (Fixtures A–P + invariant battery; CI
job `build03-witness-battery`).

NOTHING in this build publishes anywhere: no real git push, no Telegram
send, no OTS submission, no production credentials — all structurally
unconstructible in this snapshot.

## BUILD 04 contents (this snapshot)

Stage 0 Experiment Freeze governance artifact at
`governance/experiments/stage0-public-experiment-v1/` per the ratified
`FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_2.md` section 17. NOT a Capital
Instrument -- no `FCC-I-*` identifier, no BUILD 03 witness/publication
pipeline involvement of any kind. Every mechanically-specifiable rule
(15-instrument / 5-5-5 horizon distribution, EXTERNAL_CHALLENGER_DEPTH
primary metric, minimum/strong/failure thresholds, day-45 kill rule,
privacy prohibition, two-case affiliation timing rule, promotion
methodology) is frozen and machine-verified
(`tools/verify-experiment-freeze.js`, `tools/run-build04-tests.js`).
`governance/experiments/` is now append-only protected
(`tools/lib/append-only-law.js`), same as `record/` and
`governance/frozen/`.

`freeze_status: BLOCKED` -- honestly, not fabricated. Two owner-level
gaps remain open: (1) the candidate/source-selection methodology
(spec section 4) has no named concrete source list or procedure yet,
so `candidate-slate.json`'s 15 slots are all honest placeholders, and
(2) calendar dates are deliberately unchosen per the spec's own
launch-timing rule. Neither the candidate content nor the dates were
invented to fill the gap.

## BUILD 04.1 contents (this snapshot)

Integrates the ratified `FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md` (final,
C-3-corrected, sha256 `751953212fa1f17d0041fc6f3d36c570dae66d25c62d4ac16ed4f9849aaf5927`)
into the BUILD 04 Experiment Freeze and builds the candidate-intake
machinery -- WITHOUT running intake, since the ratified cutoff formula's
first trigger condition (BUILD 03.1 AD-3 -> VERIFIED) has not been met.

New: `governance/gates/build03-1-ad3-status.json` (AD-3 status record,
currently UNRESOLVED -- the sole authoritative source the cutoff formula
reads for condition 1; append-only protected, same as every other
governance record); `governance/experiments/stage0-public-experiment-v1/
FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md` (imported, hash-verified);
`candidate-selection-ratification.json` (records the methodology's
ratification -- trigger condition 2); `tools/lib/intake-cutoff.js` (pure,
frozen +2-day cutoff formula, zero parameterization, zero third-condition
code path); `tools/lib/candidate-intake.js` (pure mechanics: dedup,
POSSIBLE_DUPLICATE flagging, eligibility, horizon bucketing, deterministic
ordering, duplicate-skip, shortage/overflow, difficulty-quota substitution
-- all per the ratified methodology, zero network I/O); `tools/
run-candidate-intake.js` (the ONLY lawful entry point for a real intake
pass; computes the cutoff FIRST and refuses before touching any adapter or
pipeline function if not authorized -- proven against real repo state,
which genuinely refuses since AD-3 is UNRESOLVED); `tools/
run-build04-1-tests.js` (45 fixtures); `governance/schemas/v1/
experiment-freeze.schema.json` extended with the `RATIFIED_AWAITING_CUTOFF`
methodology status.

`governance/gates/` is now append-only protected, same rationale as
`governance/experiments/`.

`freeze_status` remains `BLOCKED` -- honestly. The methodology gap that
blocked BUILD 04 is resolved; the new (expected, not a defect) blocker is
that intake genuinely has not run and cannot run yet. `candidate-slate.json`
remains 100% untouched placeholder. Live acquisition adapters (real
Snapshot/EDGAR/L2BEAT/etc. HTTP calls) are deliberately NOT implemented --
building untested live adapters before intake is authorized would be dead,
unverifiable code, mirroring how BUILD 03 held real witness transports
behind AD-3 until that gate was separately authorized.
