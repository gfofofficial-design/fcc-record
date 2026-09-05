# Epoch 2 C0 Shortage Closure and C1 Preparation

**STATUS: PREPARATION ONLY — C0 reconciliation is not yet recorded; C1 is not authorized.**

This runbook preserves the outcome of the supervised C0 attempt without claiming evidence that the pinned runner failed to save. It also defines the boundary for preparing the pre-declared C1 rerun. It does not amend the ratified methodology, selection controls, source registry, cutoff, or rerun schedule.

## 1. Established C0 facts

- The owner ran the supervised Epoch 2 candidate-intake command once from a fresh, clean clone at public HEAD `4811528a34e980dc015b643ff1734bcf6fde8ece`.
- The authorization gate suite reported **227 passed, 0 failed**.
- Live acquisition readiness reported **READY** after `TALLY_API_KEY` was supplied in the process environment. The key was not placed in chat or a repository file.
- The runner reported `SHORTAGE_EVENT` with `N/H1/H2/H3/S1/S2/S3` unsatisfied.
- The runner emitted the pre-declared checkpoints C1 `2026-09-10T00:00:00.000Z`, C2 `2026-09-17T00:00:00.000Z`, and C3 `2026-09-24T00:00:00.000Z`.
- Post-run verification showed a clean worktree, no `candidate-slate.v2.selected.json`, and no `intake-execution-002.completed.json`.
- No candidate slate, Capital Instrument, or capital activity resulted.

## 2. Evidence limitation that must remain public

The pinned runner printed the observed identities and result, then returned on shortage before its write transaction. It did not persist a byte-exact, hashed full pool and did not write a completion marker. The complete terminal scrollback was not captured byte-for-byte.

The C0 record must therefore say exactly what is known and must not reconstruct missing candidates from a later network view. A later acquisition cannot become C0 evidence because public source contents may have changed. If the original scrollback is recovered, publish it only as a new append-only evidence artifact and cite this limitation; never replace the reconciliation record.

## 3. Single-use disposition

`intake-execution-002` authorized one supervised execution attempt, not one successful slate. The owner invoked that attempt. The safe and transparent disposition is **consumed**. The command must not be run again under authorization `002`, even though its original completion-marker implementation handled only a successful selected slate.

The prepared reconciliation draft is:

`tools/templates/epoch2-c0-shortage-reconciliation-001.draft.json`

Moving a finalized version to `governance/gates/epoch2-c0-shortage-reconciliation-001.json` requires explicit owner authorization and separate review. Recording it grants no rerun authority.

## 4. C1 infrastructure requirements

Before C1 may be authorized, reviewed code must make shortage and success equally durable:

1. Refuse every execution before `2026-09-10T00:00:00.000Z`.
2. Refuse reuse of `intake-execution-002` permanently.
3. Require a clean worktree and bind readiness to the exact public HEAD used for execution.
4. Require the exact owner-present flag/environment pair and live aggregate `READY`.
5. Use C1 as the effective observation timestamp for the identical Steps 1-prime through 4-prime rerun and preserve C0 as the schedule origin.
6. Persist a complete, deterministically ordered observed pool with source class, source id, canonical id, source-native opening timestamp, eligibility disposition, and reason.
7. Persist exact control counts and deficits—not only the combined text `N/H1/H2/H3/S1/S2/S3`.
8. Hash and read-back verify every output before writing a single-use completion marker.
9. On a partial write, hash mismatch, malformed artifact, or stale HEAD, enter `RECONCILIATION_REQUIRED`; never retry with the same authorization.
10. Pin the reviewed schema, runner, gate, selection code, result writer, readiness tooling, CI guard, and public infrastructure commit in the separate C1 authorization.

## 5. C1 authorization boundary

The template `tools/templates/intake-execution-003-c1.draft.json` is deliberately non-executable. A final `intake-execution-003.json` must not be created until all infrastructure requirements above pass adversarial tests and exact public hashes are available.

The final owner authorization, if later granted, must authorize exactly one supervised C1 rerun and nothing else. It must not change N=15, H1-H3, S1-S3, the source registry, the benchmark exclusions, or any frozen selection rule.

## 6. Current stop condition

Do not run candidate intake again. The next safe engineering step is an infrastructure-only change set implementing the C1 write-once result transaction and its adversarial tests. After that change is reviewed and public, a separate pin-and-authorization step may be prepared for owner approval.
