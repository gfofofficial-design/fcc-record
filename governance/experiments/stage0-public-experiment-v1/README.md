# FCC STAGE 0 EXPERIMENT FREEZE — governance/experiments/stage0-public-experiment-v1/

**This is a governance artifact, not a Capital Instrument.** It carries no `FCC-I-*` identifier, is never routed through the BUILD 03 witness/commit-point/OTS pipeline, and creating or reading it triggers no Telegram, git-witness, or OTS activity of any kind.

## Purpose

Freezes, before Instrument #1 can ever be filed, every mechanically-specifiable rule of the Stage 0 public experiment defined in `FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_2.md`: instrument count and horizon distribution, the primary metric, success/strong-success/failure thresholds, the day-45 kill rule, the privacy and affiliation rules, and the promotion methodology. Once complete, this directory becomes append-only protected — the same law that protects `record/` and `governance/frozen/` now also protects everything committed here (extends `governance/experiments/` into the append-only guard's protected-root set — a mechanical implementation of the ratified AD-E3 requirement that "existing append-only protections should govern subsequent changes/corrections").

## Files

- `FCC_STAGE0_PUBLIC_EXPERIMENT_SPEC_V0_2.md` — the ratified controlling specification, hash-verified on import.
- `FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md` — the ratified candidate-selection methodology (final, C-3-corrected), hash-verified on import.
- `candidate-selection-ratification.json` — records the methodology's ratification; its existence is trigger condition 2 of the frozen cutoff formula.
- `experiment-freeze.json` — the freeze artifact itself; validates against `governance/schemas/v1/experiment-freeze.schema.json`.
- `candidate-slate.json` — the 15-slot structure (5 short / 5 medium / 5 long horizon), every slot an honest, unfilled placeholder.
- `known-affiliation-baseline.json` — structural placeholder for the pre-experiment Federation-affiliation identity list.

Trigger condition 1 (AD-3 status) lives outside this directory at `governance/gates/build03-1-ad3-status.json`, since it is a BUILD 03.1 gate record, not an experiment-specific artifact.

## Current status: **freeze_status: BLOCKED**

Every mechanically-specifiable rule in this freeze is complete and verified (`node tools/verify-experiment-freeze.js`, `node tools/run-build04-tests.js`, `node tools/run-build04-1-tests.js`). The candidate/source-selection methodology gap is now **RESOLVED** — `FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2.md` (sha256 `751953212fa1f17d0041fc6f3d36c570dae66d25c62d4ac16ed4f9849aaf5927`) is ratified and imported, and `candidate-selection-ratification.json` records that ratification. Two items remain genuinely open, mechanically enforced, not fabricated:

1. **Intake has not run.** The ratified methodology's own frozen cutoff formula (`CUTOFF_TIMESTAMP = 00:00:00 UTC + 2 days after the LATER of` AD-3 → VERIFIED, methodology ratification) requires BUILD 03.1's AD-3 decision to reach `VERIFIED` — see `governance/gates/build03-1-ad3-status.json`, currently `UNRESOLVED`. `tools/run-candidate-intake.js` is the only lawful entry point for a real intake pass; it computes this cutoff first and refuses (`INTAKE_NOT_AUTHORIZED`) before touching any acquisition adapter if it isn't reached — verified against the real repo state by `tools/run-build04-1-tests.js` Fixture Z. `candidate-slate.json` therefore remains 100% honest placeholder.
2. **Calendar dates** — deliberately not chosen this pass, per the spec's own Launch-timing rule.

Neither gap blocks anything else in this artifact from being complete and enforced now.
