# FCC STAGE 0 — CANDIDATE SELECTION METHOD v0.3 (DRAFT — NOT RATIFIED)

Status: **DRAFT FOR OWNER RATIFICATION REVIEW.** Supersedes v0.2 (sha256 `751953212fa1f17d0041fc6f3d36c570dae66d25c62d4ac16ed4f9849aaf5927`) **only** in the sections marked SUPERSEDED below; every other v0.2 provision is carried forward unchanged by reference and is not reproduced. Nothing in this draft is in force. No repository was modified, no intake run, no data pulled, no slate written, no freeze changed, no cutoff computed.

**Why this document exists (cited, not narrated):** Epoch 1 under v0.2 closed as `STRUCTURAL_METHODOLOGY_INFEASIBILITY` — see `governance/gates/stage0-epoch1-infeasibility-001.json` (sha256 `d93aaa52d424f48dca63226738b0fa172b879c2b2d3adcda739e2c38a3530fef`, recorded at public commit `35c5ae93d452b8943e0f3cedecbda89aea6ae9c6`) and the evidence it pins. **Authoritative corrected result:** SHORT 14 / MEDIUM 0 / LONG 0 at both 21d and 42d lookback at the frozen cutoff `2026-08-31T00:00:00.000Z` (bounded reconstruction, sha256 `541f45161c8f779f7e3c4c486050fff881252adc2b41c498b6dfa9554aa5e908`). **Historical original diagnostic:** 7 / 0 / 0 (sha256 `73e73bacd785ffb575fbe1a96c4541e9e8c9bdb4669798e7a046fbefc76b8694`), whose A2 activity evaluation was defective; it is preserved permanently as history and is not the final Epoch 1 result. That record is permanent and is the sole reason for this version.

---

## EXACT CHANGES (v0.2 → v0.3)

- **D-1 (§3, §2 Step 3 item 2) — SUPERSEDED.** The single eligibility test "has a source-published fixed resolution date" is replaced by a **pre-registered Source-Class Resolution Observable** drawn from a closed type system (§3A) and a per-class whitelist (§1.6). Nothing outside the whitelist is an observable.
- **D-2 (§4 A/C, Experiment Spec §3/§17 item 9) — SUPERSEDED.** The exact 5/5/5 horizon split is replaced by a **two-dimensional slate control** (§4A′): horizon-diversity constraints **and** source-class-diversity constraints, both mechanical, both checked at slate-freeze time. Horizon **band definitions** (≤14 / 15–45 / 46–90 days, measured from the cutoff) are **unchanged** — bands are not re-drawn after seeing data.
- **D-3 (§4 C) — SUPERSEDED.** Shortage handling: `EXTEND_LOOKBACK` is retained **only** for count shortages within the SHORT band (the only case where a wider opening window can add supply). Any horizon- or diversity-constraint shortage triggers a **pre-declared, formula-scheduled re-run sequence** with a hard cap, then epoch closure — never operator discretion (§4C′).
- **D-4 (§2 Step 0) — EXTENDED, formula unchanged.** The cutoff formula is byte-for-byte the frozen v0.2 formula. Its input (2) becomes the explicit `ratified_at` timestamp of the **v0.3 ratification record** (`candidate-selection-ratification.v2.json`); the record existing on public `main` with `ratified:true` are prerequisites of (2), not its timestamp. New: **Epoch 2 anti-carry-over rule** — any item whose source-native opening timestamp is ≤ the Epoch 1 cutoff is mechanically excluded from the Epoch 2 pool (§2 Step 1′).
- **D-5 (new §9) — Anti-post-hoc protections for Epoch 2**, binding on the owner and on this document itself.
- **D-6 (§4 E) — CLARIFIED, unchanged mechanism.** Horizon is **not** a difficulty proxy. The AI Standing Adversary difficulty quota (Experiment Spec §3, ≥20% material) is carried forward as the sole, independent difficulty control.
- **Carried forward unchanged (by reference to v0.2 by hash):** §1 registry membership and §1.5 acquisition interfaces (incl. ratified addenda 001), §2 Steps 1–2 and 5–8, §3 items 1, 3, 4, 6, 7, §4B ordering + tie-break, §4D overflow, §5 community proposals, §6 adversarial review findings, §8 reproducibility assessment; frozen constants `LOOKBACK_DAYS = 21`, `MIN_FILING_LAG = 3`, horizon ceiling 90.

---

## 1.6 · SOURCE-CLASS RESOLUTION OBSERVABLE WHITELIST (new — pre-registered)

A **Source-Class Resolution Observable** is the only thing that can give a candidate a `resolution_date`. To qualify, an observable MUST be, all at once: fixed or mechanically derivable **before** candidate filing; independently reconstructable by a third party from the named authoritative source; non-discretionary; externally resolvable; falsifiable; tied to a named authoritative source in §1/§1.5; defined **in this document before the Epoch 2 cutoff**; and never selected after viewing whether it helps any specific candidate qualify.

| Class | Allowed observable(s) | Type (§3A) | Required source field(s) | If absent |
|---|---|---|---|---|
| **A1 Snapshot** | proposal **end** timestamp | `OBS_SOURCE_NATIVE_DATE` | `proposal.end` (unix seconds) from `hub.snapshot.org/graphql` | item has no observable → **not a candidate** |
| **A2 Cactus/Tally** | (i) proposal **end** timestamp; (ii) **execution ETA** — only where the governor exposes it as deterministic on-chain state | (i) `OBS_SOURCE_NATIVE_DATE`; (ii) `OBS_SOURCE_NATIVE_EXECUTION_DATE` | (i) `Proposal.end{timestamp}`; (ii) the governor's on-chain `eta`/`proposalEta(proposalId)` (OpenZeppelin Governor + TimelockController / Compound-Bravo family) as reflected in the proposal's `QUEUED` state — reconstructable from the chain; Tally API fields are convenience, the chain is authority | (ii) absent or governor not timelocked → **no execution observable**; (i) still applies |
| **B1 SEC EDGAR** | **statutory decision deadline** derived mechanically from a source-published trigger date | `OBS_RULE_DERIVED_DATE` | see §1.7 formula table; trigger date must itself be a published field of the named authority; the RD-19b4 trigger surface exists only via `source-registry-addendum-002` (DRAFT) | filing type not in §1.7 → **not a candidate**; addendum-002 not ratified before cutoff → **ZERO CONTRIBUTION** for RD-19b4 |
| **F1 named issuer CIKs** | identical to B1 (issuer whitelist changes **scope**, not deadline calculation) | `OBS_RULE_DERIVED_DATE` | as B1, scoped to the six ratified CIKs (`f1-cik-addendum-001.json`) | as B1 |
| **B2 CFTC** | a deadline present in a **structured** field of the frozen surfaces (press release / enforcement index); no prose | `OBS_SOURCE_NATIVE_DATE` | a machine-addressable date element on the frozen surface; §1.5 deterministic parser must name the element | prose-only date → **ZERO CONTRIBUTION** |
| **C1 Coinbase / C2 Kraken** | none unless a deterministic **structured** future checkpoint exists on the ratified feed | — | ratified RSS item structured date field only (`pubDate` is a *publication* date, not a resolution date, and does **not** qualify) | **ZERO CONTRIBUTION** (current state) |
| **D1 L2BEAT** | none — stage changes are recorded, not scheduled | — | — | **ZERO CONTRIBUTION** |
| **D2 DefiLlama** | none — no operator-authored thresholds ("TVL will exceed X by Y") ever | — | — | **ZERO CONTRIBUTION** |
| **E1 Ethereum upgrade schedule** | **published activation epoch/timestamp** once fixed in authoritative upgrade metadata | `OBS_SOURCE_NATIVE_DATE` | §1.8 authority hierarchy; the fork's activation `timestamp`/`epoch` field, not a target-month statement | unfixed ("targeting Q1") → **not a candidate** |
| **G1 Polymarket / G2 Kalshi** | **never** — benchmark-only | — | — | never candidates |

No class may use an observable type not listed in its row. No "operator-defined" observable exists.

## 1.7 · RULE-DERIVED DATES — FROZEN FORMULA TABLE (B1/F1)

A `RULE_DERIVED_DATE` is a fixed date computed by a **frozen formula** from a **source-published trigger date**. The formula text, the statute, and the trigger field are frozen here; the operator selects nothing.

| Formula id | Filing/notice type | Trigger date (source-published) | Statute / rule | Derived observable(s) | Notes |
|---|---|---|---|---|---|
| `RD-19b4-45` | Proposed rule change by a national securities exchange (Form 19b-4) — incl. exchange-traded product listing rules | Date of publication of the notice in the **Federal Register** | Exchange Act §19(b)(2), 15 U.S.C. 78s(b)(2) | Commission action-or-extension deadline = trigger + 45 days; if extended, + 90 days | **Requires a §1.5 surface addendum**: the trigger field is the Federal Register structured `publication_date` (federalregister.gov API), joined to the SEC SRO file number; it is not on EDGAR full-text. The surface is drafted prospectively and candidate-independently as `source-registry-addendum-002.json` (DRAFT). **Until addendum-002 is ratified on public `main` BEFORE the Epoch 2 cutoff, B1/F1 contribute ZERO rule-derived candidates**; ratification at or after the cutoff does not apply to Epoch 2. |
| `RD-19b4-240` | as above | as above | 15 U.S.C. 78s(b)(2)(B)(ii) | Outer statutory deadline = trigger + 240 days (deemed-approved backstop) | Naturally populates MEDIUM/LONG bands. |

**Distinction, frozen:** a `SOURCE-PUBLISHED DATE` is read from the source; a `RULE-DERIVED FIXED DATE` is computed by one of the formulas above from a source-published trigger. Both are reconstructable; neither involves judgment. **No other formula is admitted** without a ratified v0.3.x addendum adopted before a cutoff. Candidate semantics under `RD-*`: "Will the Commission approve [rule change X] on or before [derived date]?" — a qualification-stance instrument under Doctrine §B1, resolved by the Commission's published order or by expiry.

## 1.8 · E1 AUTHORITY HIERARCHY — WHAT "FIXED" MEANS

Authority order for an Ethereum upgrade activation date: (1) the fork's `timestamp`/`epoch` as merged into `ethereum/execution-specs` (network upgrade metadata) or `ethereum/consensus-specs` fork configs; (2) the network-upgrade meta-EIP in `ethereum/EIPs` once its `activation` field carries a concrete mainnet timestamp/epoch. A date is **fixed** only when a concrete mainnet activation value exists in (1) or (2) at the pinned commit of that repository at cutoff time; announcements, blog posts, client release notes, and "targeting" language are **not** observables. Candidate semantics: "Will [upgrade] activate on mainnet at [fixed timestamp]?" — resolves against chain state.

---

## 2 · CANDIDATE INTAKE PROCEDURE — Epoch 2 amendments only

**Step 0 — Cutoff trigger (formula UNCHANGED, inputs re-bound; canonical rule).** `CUTOFF_TIMESTAMP = 00:00:00 UTC exactly 2 calendar days after the LATER of (1) the AD-3 VERIFIED timestamp (`build03-1-ad3-status.v2.json` → `verified_at` = `2026-08-29T23:27:52Z`, satisfied) and (2) the explicit `ratified_at` timestamp of `candidate-selection-ratification.v2.json`.` Input (2) has two PREREQUISITES — the file exists on public `main` and `ratified == true` — and one TEMPORAL INPUT, its full ISO-8601 UTC `ratified_at`; existence and `ratified:true` are never the timestamp source. This is the single canonical rule (`EPOCH2_CUTOFF_RULE_CANONICAL_V03`) carried identically by `methodology-supersession-001`, `experiment-freeze.v2`, `candidate-selection-ratification.v2` and `intake-execution-002`. Additionally required before any Epoch 2 computation: `experiment-freeze.v2.json` exists and validates, and `methodology-supersession-001.json` exists. The cutoff is never owner-selected and is computed only by tooling. `INTAKE_BLOCKED` fallback semantics unchanged.

**Step 1′ — Collect the raw pool + anti-carry-over (two-pronged, Revision 1).** Unchanged collection, then mechanically mark INELIGIBLE any item for which **either**:
1. its source-native stable identity appears in the prior epoch's **observed-item exclusion set** (`governance/evidence/stage0-epoch<N>-observed-item-set-001.json`), **or**
2. its source-native opening/creation/publication timestamp is **≤ the prior epoch's cutoff** — for Epoch 2: `≤ 2026-08-31T00:00:00.000Z`.
**Epoch 1 finding (recorded, not assumed):** both Epoch 1 diagnostic runs — the original at public commit `ab414bf8b8704b4257fceaf13780be966d154755` and the corrected reconstruction at `9c42f81d0d6bb877f139b15fe38a5ba77a433618` (tool sha256 `a615f17ff03d9ec418288cdd973ea439459e4b985471d8d2437a36201dc54a94`) — acquired with `created ≤ cutoff` bound to the cutoff itself (tool code, not run time), so every item it observed satisfies prong 2; and its raw output contains **no per-item identifiers** (the tool strips them before printing), so a per-item set for Epoch 1 **cannot be generated without fabrication** and is not. For Epoch 1 → Epoch 2, prong 2 is therefore exhaustive and prong 1 is satisfied by the published *observed-scope set* (`stage0-epoch1-observed-scope-set-001.json`, sha256 `51320e7a4742f1c0c404e54ed761e56bcb29d2d7fd6a62d7e1bfa46ab7a4cf41`) wherever identity exists (A1 space ids; A2 included, fetched-inactive and excluded governor ids) and vacuously for the unprinted proposal items. **Forward requirement (§9 clause 9):** every future epoch diagnostic MUST print per-item stable ids so prong 1 is literally constructible.

**Step 3′ — Eligibility (item 2 SUPERSEDED):**
1. Source ∈ registry, acquisition confirmed where conditional. *(unchanged)*
2. **Carries a whitelisted Source-Class Resolution Observable (§1.6/§3A), with all required fields present and the observable's type recorded on the item.** *(supersedes "source-published fixed resolution date")*
3–7. Unchanged (qualification-stance shape; no Federation subject/source; `MIN_FILING_LAG ≤ days_to_resolution ≤ 90`, measured from the cutoff; AI LINT once drafted).

**Step 4′ — Bucket by unchanged bands; check the two-dimensional control (§4A′) instead of exact counts.**

Steps 5–8 unchanged.

---

## 3A · OBSERVABLE TYPE SYSTEM (closed)

| Type | Authority | Calculation | Immutability | Resolution procedure | Rejection behavior | Audit evidence |
|---|---|---|---|---|---|---|
| `OBS_SOURCE_NATIVE_DATE` | the source's own published field, at the pinned acquisition time | none — read verbatim | if the source later changes the value, the **original** is kept and the change is recorded as a correction event, never silently adopted | compare real-world outcome at the recorded date via the source's own terminal state (vote result, activation, order) | field missing/unparseable → item has no observable | raw field value + acquisition timestamp + source URL/id in the pool record |
| `OBS_SOURCE_NATIVE_EXECUTION_DATE` | on-chain governor/timelock state | read `eta` from chain (Tally mirror is convenience only) | chain-final; a cancelled/expired queue resolves the instrument, never re-dates it | resolve on execution tx or expiry at `eta` | governor not timelocked / not queued → no execution observable | chain id + governor address + proposal id + block of the QUEUED event |
| `OBS_RULE_DERIVED_DATE` | a §1.7 frozen formula applied to a source-published trigger | `trigger_date + N days` exactly as frozen; no rounding rules beyond calendar-day arithmetic in UTC | formula text frozen; a later official extension yields a **new** derived observable recorded as a supersession, never an edit | resolve on the authority's published action or on expiry of the derived date | filing type not in §1.7, trigger field absent, or surface not ratified → not a candidate | formula id + trigger field value + trigger source URL + computed date |

No fourth type. No freeform "operator-defined" observable. Any proposal to add a type or formula is a v0.3.x addendum ratified **before** a cutoff and never during an epoch.

---

## 4A′ · TWO-DIMENSIONAL SLATE CONTROL (SUPERSEDES exact 5/5/5)

**Objective (unchanged from v0.2 §5 / Experiment Spec §5):** the operator must be unable to load the slate with only easy, near-term governance votes. v0.2 pursued this with a single lever (exact horizon counts) that the registered sources cannot satisfy. v0.3 pursues it with two levers, each derived from the objective and the source mechanics — **not from the Epoch 1 observed set** (14 SHORT governance-vote items under the authoritative reconstruction; 7 under the historical original diagnostic), which is excluded from Epoch 2 by Step 1′ in any case.

**Bands (unchanged definitions):** SHORT ≤14d · MEDIUM 15–45d · LONG 46–90d, `days_to_resolution` from the cutoff.

**Constraints on a slate of N filed instruments (N = 15 target, carried forward):**

| # | Constraint | Value | Derivation from objective / mechanics |
|---|---|---|---|
| H1 | No horizon band may hold a **majority** | each band ≤ ⌊N/2⌋ (=7 of 15) | "no single bucket may dominate" is the spec's own standing principle (Experiment Spec §3); "majority" is the least arbitrary reading of "dominate". |
| H2 | Every band must be **non-trivially represented** | each band ≥ 2 | A band satisfied by a single item could be met by one lucky candidate; two is the minimum that shows the band was genuinely sourced. |
| H3 | At least **one-third** of the slate resolves beyond SHORT | non-SHORT ≥ ⌈N/3⌉ (=5 of 15) | Directly encodes the anti-"near-term skew" objective while remaining feasible once §1.6/§1.7 observables supply MEDIUM/LONG. |
| S1 | No source **class** may hold a majority | each class (A–F) ≤ ⌊N/2⌋ (=7) | Prevents the "all governance votes" slate — the precise failure mode Epoch 1 exposed — without a per-class quota. |
| S2 | Minimum number of **distinct contributing classes** | ≥ 3 of the 6 candidate classes | Half the registry: enough to make a slate composition reflect the registry rather than one source's activity, without demanding classes that structurally produce zero (C/D). |
| S3 | Governance-vote observables (`A1`/`A2` `OBS_SOURCE_NATIVE_DATE`) capped | ≤ 7 of 15 combined | Restates S1 for the one observable type that trivially fills SHORT; needed because A1 and A2 are separate sources but the same mechanic. |

All constraints are checked mechanically at slate-freeze time. They are **jointly feasible in principle** with the §1.6 whitelist (e.g. 7 governance SHORT/MEDIUM + 2+ E1 LONG + 2+ RD-19b4 MEDIUM/LONG + B2 structured items) and **do not guarantee** that 15 eligible candidates exist at any given cutoff — see §4C′.

## 4C′ · SHORTAGE HANDLING (SUPERSEDED)

- **Count shortage within SHORT only:** `EXTEND_LOOKBACK` to 42d is retained (a wider opening window can add SHORT supply). It is **not** applied to MEDIUM/LONG (proven ineffective by construction — infeasibility record finding 1).
- **Any §4A′ constraint unsatisfied at the cutoff C₀:** record `SHORTAGE_EVENT` (which constraints, by how much) and enter the **pre-declared re-run schedule**: C₁ = C₀ + 7 days, C₂ = C₀ + 14 days, C₃ = C₀ + 21 days — each a full identical re-run of Steps 1′–4′ with its own lookback window and its own hashed pool publication. **Maximum three re-runs.** If constraints remain unsatisfied after C₃: the epoch closes with a terminal record (`STRUCTURAL_METHODOLOGY_INFEASIBILITY` or `SUPPLY_SHORTAGE`, as the evidence shows) — **never** operator discretion, never a reduced-N slate, never a relaxed constraint.
- The re-run dates are formula-derived from C₀ and declared here; the owner does not choose them. Each re-run's pool and result are published.

## 4E′ · DIFFICULTY (clarified, mechanism unchanged)

Epoch 1 analysis found that horizon had been carrying an implicit difficulty proxy ("near-certain, near-term"). v0.3 states explicitly: **horizon is not difficulty.** The independent control — the AI Standing Adversary quota (≥20% of filed instruments carry a materially non-trivial counter-thesis, Experiment Spec §3) — is carried forward unchanged and applied after §4A′, with the same deterministic bucket-by-bucket substitution. A SHORT instrument may be hard; a LONG one may be trivial; neither fact changes the other control.

---

## 9 · ANTI-POST-HOC PROTECTIONS FOR EPOCH 2 (new, binding)

1. No Epoch 1 candidate carries into Epoch 2 automatically — enforced by Step 1′.
2. No candidate observed in the Epoch 1 diagnostic may be manually grandfathered. There is no grandfathering path in this document.
3. The §1.6 whitelist, §1.7 formulas, §1.8 authority hierarchy, and §4A′ thresholds are ratified **before** the Epoch 2 cutoff exists; none may change during an epoch.
4. The Epoch 2 cutoff is formula-derived (§2 Step 0), never owner-selected.
5. Fresh discovery begins only after the cutoff instant; no Epoch 2 data pull precedes ratification.
6. The Epoch 1 evidence — the historical original diagnostic (7/0/0, sha256 `73e73bac…8694`) and the authoritative corrected reconstruction (14/0/0, sha256 `541f4516…e908`) — and the infeasibility record (sha256 `d93aaa52…0fef`) remain public permanently at commit `35c5ae93d452b8943e0f3cedecbda89aea6ae9c6` and are cited by `methodology-supersession-001.json`. The historical figure is never represented as the final Epoch 1 result.
7. No threshold in §4A′ is calibrated to the known Epoch 1 candidate set; each is derived in the table from the objective and from mechanics knowable before Epoch 1 ran. (Check: the authoritative Epoch 1 eligible set — 14 SHORT governance-vote items, one source class — would **fail** H1, H2, H3, S1, S2 and S3 under this document; the historical 7-item set fails H2, H3, S2. This document rescues neither. No constant was changed when the authoritative count replaced the historical one.)
8. Any source or surface added after inspecting a particular candidate is prohibited unless the class rule was independently justified here and frozen before the cutoff. The only surface addition contemplated (§1.7 Federal Register / SEC SRO surface for `RD-19b4-*`) is justified by statute, not by any candidate; it is drafted as `source-registry-addendum-002.json` (DRAFT, candidate-independent, mechanical) and may be ratified only BEFORE the Epoch 2 `CUTOFF_TIMESTAMP`, never during an epoch. Unratified, it contributes ZERO.
9. **Diagnostic identity requirement (Revision 1).** Every Epoch ≥2 scope/shortage diagnostic must emit, for each acquired item, its source class, source-native stable id, and source-native opening timestamp, so that an observed-item exclusion set can be generated mechanically from the raw bytes for any subsequent epoch. A diagnostic that omits them cannot ground an exclusion set and the epoch that follows it must rely on the timestamp prong alone — which is lawful only if that diagnostic's acquisition was itself bounded to its cutoff, as Epoch 1's was.

## 7 · REMAINING OWNER DECISIONS (v0.3 draft)

1. Ratify §1.6/§1.7/§1.8 as drafted, or strike specific rows (striking is permitted before ratification; adding after ratification is not).
2. Decide whether to ratify the `RD-19b4-*` surface addendum (`source-registry-addendum-002.json`, drafted) — it must be ratified BEFORE the Epoch 2 cutoff or not at all for Epoch 2; without it, B1/F1 contribute zero and LONG supply depends on E1 alone.
3. Confirm N = 15 remains the target (Experiment Spec v0.3 draft carries it forward; see its §17).
4. Confirm the §4A′ constants (H1–H3, S1–S3) or return them for re-derivation **before** any cutoff — never after.

## 8 · REPRODUCIBILITY ASSESSMENT (v0.3 draft)

Every observable is either read verbatim from a named source field or computed by a frozen formula from such a field; every constraint is arithmetic over the published pool; every re-run date is derived from C₀. A third party with the pinned commit can reconstruct the pool, the observables, the buckets, the constraint check, and the shortage disposition without contacting the operator.

---
*End of v0.3 DRAFT. Not ratified. Not in force.*
