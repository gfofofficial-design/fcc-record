# FCC STAGE 0 — PUBLIC EXPERIMENT SPEC v0.3 (DRAFT DELTA — NOT RATIFIED)

Status: **DRAFT FOR OWNER RATIFICATION REVIEW.** This is a **delta** to v0.2 (sha256 `ef9dab7654e48ec18867706168ea640e46910814923193674fb847160ca89ec6`). Only the provisions listed under SUPERSEDED change; **every other section of v0.2 is carried forward unchanged by hash reference** and is not reproduced here. Nothing in this draft is in force.

## WHY (cited)
Epoch 1 closed as `STRUCTURAL_METHODOLOGY_INFEASIBILITY` (`governance/gates/stage0-epoch1-infeasibility-001.json`, sha256 `d93aaa52d424f48dca63226738b0fa172b879c2b2d3adcda739e2c38a3530fef`, recorded at public commit `35c5ae93d452b8943e0f3cedecbda89aea6ae9c6`; authoritative corrected result SHORT 14 / MEDIUM 0 / LONG 0, historical original 7 / 0 / 0 preserved as history): the exact 5/5/5 horizon split ratified in v0.2 §3 / §17 item 9 / AD-E4 is unsatisfiable over the registered source classes. Epoch 2 is a **new experiment epoch** under Candidate Selection Method v0.3.

## SUPERSEDED PROVISIONS

**§3 (Instrument eligibility) — horizon bullet only.** Replace the exact-split bullet with: *"Slate composition control (anti-cherry-pick, detailed in §5; constants ratified in §17 item 9): the Stage 0 slate is governed by the two-dimensional control of Candidate Selection Method v0.3 §4A′ — horizon-diversity constraints (H1: no band majority; H2: every band ≥2; H3: ≥⅓ non-SHORT) **and** source-class-diversity constraints (S1: no class majority; S2: ≥3 contributing classes; S3: governance-vote observables ≤7) — all mechanical, checked at slate-freeze time. Horizon band definitions (≤14 / 15–45 / 46–90 days from the cutoff) are unchanged. The standing principle that no single band may dominate is preserved and now made precise as 'no majority'."* The **difficulty bullet is unchanged** and is the sole difficulty control (horizon is not a difficulty proxy — Method v0.3 §4E′).

**§3 — resolution observable.** Where v0.2 §3 and the Method required a "source-published fixed resolution date", v0.3 requires a **whitelisted Source-Class Resolution Observable** (Method v0.3 §1.6/§3A). Candidate semantics may therefore include: "will the Commission approve X by [statutory date]", "will [upgrade] activate at [fixed timestamp]", "will [queued proposal] execute by [on-chain eta]" — each a qualification-stance instrument under Doctrine §B1.

**§5 item 2 (Anti-cherry-picking controls).** "Horizon and difficulty quotas (§3)" → "Two-dimensional slate control (Method v0.3 §4A′) and the difficulty quota (§3)". Items 1 and 3 unchanged.

**§17 item 9 (Experiment Freeze contents).** "15 instruments / 90 days, 5 short / 5 medium / 5 long" → *"15 instruments / 90 days; slate composition per Method v0.3 §4A′ (H1–H3, S1–S3), recorded in `experiment-freeze.v2.json` as `slate_control`."* The 60%-cap language of v0.2 §3 remains superseded (now by H1's no-majority rule).

**§24 AD-E4.** RESOLVED → **SUPERSEDED by AD-E4′**: *"15 instruments / 90 days; two-dimensional slate control per Method v0.3 §4A′; calendar dates frozen immediately before launch (unchanged)."*

**§17 (freeze artifact) — lineage.** The Epoch 2 freeze is `experiment-freeze.v2.json` (schema v2); `experiment-freeze.json` (v1) is permanent history. The Epoch 2 slate is `candidate-slate.v2.json`; `candidate-slate.json` (v1) is permanent history.

**§19 (What would invalidate the experiment) — addition, not replacement.** Add: *"Any change to Method v0.3 §1.6–§1.8 or §4A′ during an epoch; any grandfathering of an Epoch 1 candidate; any owner-selected cutoff or re-run date; any cutoff computed from a timestamp other than the canonical inputs (AD-3 `verified_at`, ratification.v2 `ratified_at`); any source-registry addendum ratified at or after the Epoch 2 cutoff being applied to Epoch 2."*

**§4 (Topic-selection methodology) — lineage note.** The Epoch 2 cutoff is governed by the single canonical rule `EPOCH2_CUTOFF_RULE_CANONICAL_V03` (Method v0.3 §2 Step 0; carried identically in `methodology-supersession-001`, `experiment-freeze.v2`, `candidate-selection-ratification.v2`, `intake-execution-002`). The RD-19b4 surface (`source-registry-addendum-002`, DRAFT) contributes ZERO unless ratified before that cutoff.

## CARRIED FORWARD UNCHANGED (by reference to v0.2 by hash)
§0 framing · §1 hypothesis (external challenger depth) · §2 non-hypotheses · §3 all bullets except the two above · §4 topic-selection methodology (delegates to the Method) · §5 items 1 and 3 · §6 benchmark capture (G1/G2 benchmark-only) · §7 lifecycle · §8 challenge mechanism · §9 substantive vs non-substantive · §10 measurement without incentives · §11 concession/correction · §12 engagement metrics (primary metric unchanged) · §13 accuracy not load-bearing · §14 calibration · §15 adversarial threat model · §16 Sybil/affiliation · §18 what may change · §20 negative-results publication · §21 report format · **§22 frozen thresholds unchanged** (minimum 5/2; strong 10/4/≥25%) — no structural reason to amend engagement thresholds arises from a candidate-supply defect · §23 capital-experiment gate (no capital, no trading) · §25–§26.

## 15-INSTRUMENT TARGET — ANALYSIS
The 15 target is **not** structurally coupled to the broken design: the defect was the *distribution* constraint against the *observable* definition, not the count. With §1.6/§1.7 observables, 15 is feasible in principle; if not met at a cutoff, Method v0.3 §4C′ governs (three pre-declared re-runs, then epoch closure) — never a reduced-N slate by discretion. **Carried forward: N = 15.**

---
*End of v0.3 DRAFT DELTA. Not ratified. Not in force.*
