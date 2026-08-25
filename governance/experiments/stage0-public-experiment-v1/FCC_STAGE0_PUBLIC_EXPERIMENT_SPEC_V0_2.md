# FCC STAGE 0 PUBLIC EXPERIMENT SPECIFICATION v0.2

Status: SPECIFICATION-CORRECTION PASS OUTPUT (supersedes v0.1) — specification only. No code written, no repository modified, no publication of any kind, no capital, no tokens, no BUILD 04. This document consumes existing frozen FCC law (Doctrine v0.1.1, Blueprint v1.1.1, Instrument Spec v0.1.1, Stage 0 Implementation Architecture v0.1.2, BUILD 02/02.1 adjudications, BUILD 03 architecture/implementation, BUILD 03.1 gate) without amending any of it. Where this spec needs something frozen law doesn't provide, it says so and stops rather than inventing authority it doesn't have. **v0.1 → v0.2 changes:** primary metric replaced with the two-part absolute EXTERNAL CHALLENGER DEPTH metric (§12.0); AD-E1–AD-E4 all ratified/resolved (§17, §22, §24); affiliation timing correction added distinguishing prospective new-affiliation from retroactively-discovered pre-existing affiliation (§16). Full diff in the ratification response to this document.

---

## 0 · FRAMING

**The thesis, stated plainly:** FCC turns "trust me" into "check my record." Stage 0 exists to find out whether anyone outside the Federation actually wants to check.

**The single hardest design constraint, stated up front, because everything below serves it:** the founder wants this to work. That is not a flaw to manage politely — it is the primary threat model for this entire document. Every metric, every threshold, every rule below is written first by asking "how would a founder who wants a yes make this look like a yes without lying," and then closing that path mechanically. Section 15 makes this the explicit organizing structure rather than a section you can skim.

---

## 1 · HYPOTHESIS

**H1 (the hypothesis under test).** When FCC publishes falsifiable, timestamped, evidence-backed decision-accountability records for real crypto/finance questions — before their outcomes are known — a population of people who have no prior relationship with the Federation will (a) find the record, (b) engage with it in a way that has real cost to them (reading closely enough to challenge, or returning after the first visit), and (c) do so at a rate and depth that could not be explained by novelty, by Federation-internal promotion, or by chance.

**Falsification target, stated as its own sentence so it can't drift:** H1 is FALSE if, over 90 days and the 15 filed instruments, external engagement is statistically indistinguishable from what a Federation-run account posting *any* content — accurate, inaccurate, or fabricated — would generate through its own reach. If FCC cannot show engagement in excess of "we posted something and our own audience looked at it," the accountability-record thesis is not supported by Stage 0, regardless of how accurate the resolved instruments turn out to be.

**What "real external value" means operationally for this experiment:** not "people agree with FCC," not "FCC was right," but "people who didn't have to look, looked closely enough to either come back or push back."

---

## 2 · EXPLICIT NON-HYPOTHESES

Stage 0 tests NONE of the following, and no output of this experiment may be cited as evidence for or against them:

- Fund performance, investment returns, or any form of trading P&L.
- Assets under management, or FCC's capacity to attract capital.
- Trading skill, alpha generation, or forecasting edge as an investable product.
- $GFOF token economics, price, liquidity, or utility.
- Whether FCC's authored theses were *directionally correct* more often than chance — accuracy is measured (§10) but is explicitly disqualified as a standalone success signal (§10.1) because a perfectly accurate record nobody reads validates nothing about the product thesis, and an imperfectly accurate record that draws sustained independent scrutiny validates more.
- Whether the Federation, GFOF, or Dossier are good investments, good products, or trustworthy financial counterparties in any capital sense.

Any Stage 0 output referencing accuracy, hit-rate, or resolution outcomes must carry this disclaimer verbatim or in substance: *"This is not investment performance. FCC held no capital and made no trades in Stage 0."*

---

## 3 · INSTRUMENT ELIGIBILITY RULES

Built on frozen law already in force — this section adds Stage-0-experiment-specific tightening, not new categories.

- Instrument class: `qualification-stance` only, per the frozen Instrument Spec — no `allocation`-class instruments (already Stage-0-ineligible per Doctrine §B1, restated here for completeness, not amended).
- Every instrument must name a **primary source in the registry** (frozen Source Registry) and a **machine-evaluable `evaluation_procedure`** per the frozen Spec §D3/lint gate — no instrument enters the count (§4, §8) unless it passed the frozen hard-blocking AI LINT (criteria determinism, evidence dependency coverage, benchmark-menu compliance, ordering satisfiability, §B eligibility, 72h minimum horizon).
- **Topic domain restriction for Stage 0 specifically (new, scoped to this experiment only):** instruments must concern publicly observable, third-party-verifiable crypto/finance facts or events with a named external primary source — on-chain state, published market data, protocol governance outcomes, regulatory/exchange announcements, or similar. Instruments may **never** reference $GFOF, Dossier, or any Federation-controlled asset, wallet, or product as their subject (the frozen permanent exclusion, restated, not created).
- **Horizon distribution requirement (anti-cherry-pick control, detailed in §5; exact split ratified in §17 item 9):** the 15-instrument Stage 0 slate is exactly **5 short (≤14 days) / 5 medium (15–45 days) / 5 long (46–90 days)** — not a cap-based range but a frozen exact split, so there is no discretion left to skew the mix toward easy near-term resolutions. (The general principle — no single horizon bucket may dominate a slate — remains the standing rule for any future FCC experiment that doesn't specify its own exact split.)
- **Difficulty distribution requirement (new):** the standing adversary's counter-thesis (frozen §8 AI Standing Adversary) is generated for every instrument as usual. For Stage 0 specifically, at least 20% of the filed instrument set must carry a counter-thesis the AI adversary itself scores as presenting **material, non-trivial risk to the stated thesis** (the same triviality bar used for the TRIVIAL flag, §7 B4/D-7 — instruments that clear TRIVIAL by a wide margin cannot be the whole slate). This is mechanically checkable from the existing annex without inventing a new scoring system.

---

## 4 · TOPIC-SELECTION METHODOLOGY

- The full candidate list — every topic considered, filed or not — is registered in the Filing Log at the moment work begins on it (frozen §F3, unchanged). Stage 0 additionally requires: **the candidate list is drafted and locked to a hash BEFORE Instrument #1 is filed** (§17). Topics may still be added to the *proposal queue* during the experiment (frozen law already permits an open queue), but the *initial slate composition method* below cannot be altered once running.
- **Selection method (frozen, hashed before Instrument #1):** candidates are drawn from a fixed, pre-declared list of public data sources (named registries, named protocols, named market venues) using a fixed, pre-declared selection procedure — e.g., "the N most-recently-updated governance proposals across the named protocol list as of the freeze date, filtered only by the eligibility rules in §3." The procedure must be mechanical enough that a third party handed the same source list and freeze date could reconstruct approximately the same candidate set. A procedure that reduces to "the operator picked ones that seemed interesting" fails this requirement.
- The proposal queue (frozen, public, published triage) remains open throughout for community-suggested topics; suggestions may be filed as instruments under the same eligibility rules, but a suggested topic does not bypass §3 or the difficulty/horizon quotas.

---

## 5 · ANTI-CHERRY-PICKING CONTROLS

Mechanical, not aspirational:

1. **Slate hash-lock before Instrument #1 (§17).** The full candidate list (not just the filed instruments) is hashed and published before any instrument locks. Any candidate later abandoned is visible in the Filing Log with a reason (frozen §F3) — an operator cannot quietly drop a candidate that looks likely to embarrass FCC without it being a public, counted abandonment.
2. **Horizon and difficulty quotas (§3).** Structural, checked at slate-freeze time, not discretionary.
3. **Abandonment count is a first-class published statistic (frozen §14, unchanged) and is compared, in the final report (§21), against the size of the original hashed candidate list — not just the filed count.** A slate that started at 40 candidates and filed only the 15 easiest is visible arithmetic, not a narrative FCC controls.
4. **No instrument selection after any related market-moving event.** An instrument whose primary criterion depends on a fact that had already become public knowledge (price move, announcement, on-chain event) before the instrument's `filed_at` is a filing-time defect under existing frozen Spec §3.6 ordering rules and terminates INVALIDATED-BY-DOCTRINE (unchanged, restated as a Stage-0 tripwire the report must check explicitly, §21).
5. **Benchmark/consensus capture requirement (§6) is mandatory wherever a benchmark exists, not optional** — an operator cannot skip capturing a market-consensus baseline for an instrument where FCC's stance was obviously contrarian and inconvenient to have on record next to a Vegas-line-style comparison.

---

## 6 · BENCHMARK/CONSENSUS CAPTURE

Where an instrument's subject has an independently observable market or prediction-market price, poll, or published consensus estimate at the time of filing, that value **must** be captured and archived as part of the locked instrument body (or a same-run annex) — source, value, capture timestamp, capture method. This is not evaluative (Stage 0 makes no calibration claim about FCC beating the market — §10.1) — it exists solely so a third party can later ask "did FCC just restate the obvious consensus?" and get an answered-from-the-record answer rather than a contested one. Where no such benchmark exists for a given instrument, the instrument's annex states `benchmark: NONE AVAILABLE` explicitly — silence on this field is not permitted; an instrument cannot simply omit the question.

---

## 7 · INSTRUMENT LIFECYCLE

Unchanged from frozen law — Stage 0 adds no new states and no new lifecycle stage. Restated for this document's completeness: REGISTER INTENT (Filing Log, work-begin) → DRAFT → EVIDENCE → CRITERIA → SOURCE SELECTION → CONFLICT DISCLOSURE → AI LINT (hard-blocking) → TRIVIALITY REVIEW (pre-lock adversarial probe; authoritative TRIVIAL flag set on post-lock counter-thesis per the frozen two-step reading, D-7) → HUMAN REVIEW (owner sign-off) → LOCK (witness publication per BUILD 03; commit point per Correction 1) → OPEN → resolution at/after horizon, gated by anchor confirmation (frozen Spec §3.5/Arch §5) → TERMINAL. The Stage-0-specific additions are entirely upstream of LOCK (§3–§6 eligibility/selection/benchmark rules) and downstream of TERMINAL (§21 aggregate reporting) — nothing about the instrument state machine itself changes for this experiment.

---

## 8 · PUBLIC CHALLENGE MECHANISM

Unchanged from frozen §9 (dual-channel intake, provisional/public receipt split, 7-day response clock from provisional `received_at`, one meta-round, DISPUTED flag, no token gate). Nothing in this experiment spec touches challenge mechanics. Stage 0 adds only a measurement layer on top (§11–§12) and the substantive/non-substantive distinction below, which governs *counting*, not *processing* — every well-formed challenge is still processed identically regardless of how it is later counted for engagement-metric purposes.

---

## 9 · SUBSTANTIVE VS. NON-SUBSTANTIVE CHALLENGE

For engagement-metric purposes only (§12) — this distinction has **zero effect** on how a challenge is processed under frozen §9; every well-formed challenge still reaches PENDING and gets a resolution regardless of this classification.

A challenge counts as **SUBSTANTIVE** for the unique-challenger and challenge-rate metrics if it meets ALL of:
- Addresses the instrument's actual criteria, evidence, or sourcing (not a general comment, not off-topic, not purely rhetorical).
- Is specific enough that a resolution engine could evaluate it against the frozen §J categories (missing evidence, disclosure failure, ordering breach, etc.) without needing to first ask the challenger what they meant.
- Is not a resubmission of a previously RETURNED-MALFORMED or already-CONSOLIDATED challenge with no new content.

A challenge is **NON-SUBSTANTIVE** if it fails any of the above — e.g., "this seems wrong" with no stated basis, spam, or duplicate noise. Classification is made by the operator against this written rubric, at the same time as normal §J resolution, and is itself a public field on the challenge record (visible, so the classification itself is auditable and challengeable in the ordinary sense — a challenger can dispute their own SUBSTANTIVE/NON-SUBSTANTIVE tag as part of the existing meta-challenge round). This double-visibility is the mechanical defense against an operator quietly reclassifying inconvenient substantive challenges as noise to keep the count down, or inflating easy non-substantive ones to pad it.

---

## 10 · CHALLENGER MEASUREMENT WITHOUT TOKEN/FINANCIAL INCENTIVES

No reward, no token, no payment, no staking, no leaderboard prize attaches to challenging, per the hard constraints. Measurement (§12) uses only: identity-linked counts (frozen wallet-signature or WebAuthn identity, pseudonymous, per §10 of the Architecture — unchanged), first-challenge vs. repeat-challenge status per identity, and the substantive/non-substantive tag (§9). No identity is told, before or during the experiment, that being counted carries any benefit — this is stated as an operating rule so that if it is ever violated (e.g., an informal "top challengers get X" promise), that is itself a §15 integrity violation, not an ambiguous gray area.

---

## 11 · CONCESSION AND CORRECTION TREATMENT

Unchanged from frozen §J/§M/§13 (Corrections System). A concession on a challenge counts as a MISS for hit-rate purposes per the frozen §L3 rule (concessions score as misses, never excluded) — restated here because Stage 0's reporting (§21) depends on this frozen rule not being softened for this experiment. No new corrections class is created.

---

## 12 · ENGAGEMENT/ADOPTION METRICS

**12.0 PRIMARY METRIC — EXTERNAL CHALLENGER DEPTH (ratified correction).** A two-part absolute count, not a rate, so a single early spike cannot manufacture a favorable-looking percentage off a small denominator:
- **(a) Unique substantive external challengers** — count of distinct identities (§10) that filed at least one SUBSTANTIVE challenge (§9) during Stage 0, **excluding Federation-affiliated identities** (§16). Reported both as a raw count and as a share of total challenges filed, so padding via many non-substantive challenges from few identities is visible rather than hidden inside a headline number.
- **(b) Qualifying returning external challengers** — of the identities counted in (a), the count who engaged again (a further substantive challenge, or an independently loggable instrument-page view) **at least 7 days after their first engagement**. This is an absolute count, not a percentage of (a), so it cannot be inflated by shrinking the denominator.

Both (a) and (b) are load-bearing (§22). Return-engagement **percentage** (b ÷ a) is still calculated and published as a secondary diagnostic (12.2) — useful context, never itself a threshold.

**12.1 Challenge-rate metric.** SUBSTANTIVE challenges per filed instrument, and separately, the count/percentage of instruments that received **zero** substantive external challenges — a null result that must be reported, not folded into an average that hides it. (Strong-success also requires substantive external challenges on ≥25% of filed instruments — §22 — computed from this same data.)

**12.2 Return-engagement rate (secondary diagnostic only).** 12.0(b) ÷ 12.0(a), published for context. Explicitly NOT the primary metric and NOT independently load-bearing — retained here only as a ratio view of the two absolute counts that ARE load-bearing.

**12.4 Process-compliance metric.** Unchanged from frozen §12 (Process-Scoring Engine) — late-response rate, ordering defects, disclosure failures, benchmark-menu compliance, evidence defects, annex-integrity failures, completeness violations, all mechanically detected. Reported as-is; this metric is about FCC's own conduct, not external adoption, and is included because a "successful" experiment run by an operator who was quietly violating its own process rules to hit deadlines is not a successful experiment.

**12.5 External citation/reference measurement (AD-E2 RESOLVED).** Challenge behavior (§9/§12.0) is the **authoritative** engagement evidence for this experiment — this metric is supplemental only and never load-bearing (§13). Where deployed, measurement uses **only privacy-respecting supplemental analytics**: aggregate server referrer logs or a privacy-respecting analytics tool the owner already controls (no new vendor relationship authorized by this spec). Explicitly prohibited, unconditionally: fingerprinting, invasive identity collection, cross-site profiling, or any similar surveillance mechanism — this prohibition is not weighed against measurement value; it simply removes those methods from consideration. If reliable measurement under these constraints is unavailable, the metric is reported as **NOT MEASURED**, never estimated. Whether any such tooling is deployed at all remains an implementation choice outside this design gate's authority (it may require site/UI work not authorized here).

---

## 13 · WHY ACCURACY ALONE CANNOT ESTABLISH SUCCESS

Restated as its own numbered principle because it must survive independently of any other section: a hit-rate number, however calibrated, answers "was FCC's thesis-writing any good," not "does anyone outside FCC care whether FCC's thesis-writing is any good." A protocol nobody reads can still occasionally be right by chance or skill; that tells you nothing about product-market fit for an accountability layer, whose entire value proposition is that *other people rely on the record*. Accordingly: accuracy/calibration (§14) is measured, published, and never suppressed — but it is excluded by rule from every success/failure threshold in §22. A Stage 0 with 90% resolved-correct and zero unique external challengers is, under this spec, a **FAILURE**, stated as such in the final report, not a partial success.

---

## 14 · ACCURACY/CALIBRATION METHODOLOGY (measured, not load-bearing)

Standard terminal-disposition tally per frozen §14 aggregates (correct/incorrect/void/invalidated/trivial/disputed counts, hit-rate per §L3 with TRIVIAL excluded and concessions counted as misses). Where FCC issued anything resembling a confidence gradient (it is not required to, and Stage-0 instruments are binary/qualification-stance by frozen class definition, so in practice this reduces to a simple hit-rate, not a Brier score) — if any instrument in practice carries a stated confidence level in its thesis text, report calibration (predicted-vs-observed frequency by confidence bucket) using standard calibration-curve methodology; otherwise state plainly that calibration scoring does not apply to a binary qualification-stance slate and report only hit-rate. No manufactured precision: if the instrument count (15) is too small for a statistically meaningful calibration curve, the report says so rather than presenting a curve with n=3 per bucket as if it means something.

---

## 15 · THE ADVERSARIAL THREAT MODEL — DESIGNING AGAINST A FOUNDER WHO WANTS A YES

Format: FAILURE MODE → HOW IT WOULD LOOK → MECHANICAL DEFENSE (already specified above, cross-referenced) → RESIDUAL.

1. **Cherry-picked easy questions.** Looks like: a slate skewed toward near-certain, near-term, low-controversy resolutions. Defense: §3 horizon/difficulty quotas + §5.1 hashed pre-freeze candidate list larger than the filed set + §5.3 abandonment-count-vs-candidate-list comparison in the final report. Residual: the *initial* candidate-list construction method (§4) still has operator discretion in which source lists to name before freezing; bounded by requiring the method itself be published and mechanical enough for a third party to approximate — not eliminated, disclosed.
2. **Post-hoc thresholds.** Looks like: declaring success against a bar chosen after seeing the numbers. Defense: §17 freezes §22 thresholds (or, where indefensible, flags them OWNER DECISION REQUIRED and freezes the *chosen* value) before Instrument #1, hashed alongside the candidate list. §19's explicit no-retroactive-adjustment rule with a stated corrections-entry consequence if violated.
3. **Federation-member engagement masquerading as external adoption.** Looks like: FCC's own team, associates, or known community members generating the challenge/engagement counts. Defense: §16 (Sybil/affiliation) — mandatory affiliation-exclusion pass on every counted identity in 12.0–12.2, with the exclusion list itself published (who was excluded and why, without doxxing) so the exclusion can be checked, not just claimed.
4. **Repeated participants inflating counts.** Looks like: the same 3 people challenging 20 times each, reported as "20 challenges." Defense: 12.0(a) counts unique identities explicitly (an absolute count, not a rate a few people could game upward), 12.1 reports challenges-per-instrument alongside unique count so a concentration ratio is directly visible, not hidden inside a total.
5. **Selective promotion.** Looks like: FCC promotes only the instruments trending toward a favorable-looking resolution, starving the inconvenient ones of visibility, then later says "external interest was low" about the ones it starved. Defense: §17 freezes a promotion methodology (equal-visibility rule, §17 list item 4) before Instrument #1 — every filed instrument gets the same category of public listing/visibility (Capital Record surface, per frozen §17 architecture), and any deviation is itself a checkable §21 tripwire.
6. **Abandoned difficult instruments.** Looks like: an instrument that was going badly quietly disappears from the narrative. Defense: frozen §F3 abandonment is permanent, reasoned, and counted (unchanged) — §5.3 makes the comparison to the original candidate list explicit in the final report so abandonment can't just vanish into "we only ever planned 15."
7. **Favorable benchmark selection.** Looks like: capturing a benchmark source that happens to make FCC look prescient, or skipping capture where the benchmark would embarrass FCC. Defense: §6 makes benchmark capture *mandatory wherever available*, with an explicit `NONE AVAILABLE` field required when it isn't — silent omission is a visible gap, not an option.
8. **Ambiguous resolutions read favorably.** Looks like: a genuinely unclear outcome resolved in whichever direction flatters the thesis. Defense: unchanged frozen VOID rules (fallback exhaustion required, convenient-VOID rejected, anti-erasure informational-outcome requirement) — restated as still controlling; §21's final report must explicitly list every VOID/DISPUTED/ambiguous resolution with the reasoning, not fold them into a clean hit-rate.
9. **Metric substitution mid-experiment.** Looks like: when the primary metric looks weak, quietly leading with a secondary one instead in public communication. Defense: §17 freezes which metric is PRIMARY (§17 item 4) before Instrument #1; §19 requires the final report to lead with the frozen primary metric regardless of how it turned out, with secondary metrics reported alongside, never substituted for it.
10. **Changing methodology after losses.** Looks like: tightening eligibility rules, widening challenge windows, or adjusting quotas after seeing early resolutions go poorly. Defense: §17/§18 freeze; §19 explicitly enumerates this as an invalidating change, not a permitted refinement — if it happens anyway, the experiment's own rules require the report to say so and treat the run as compromised (§19).
11. **Emphasizing accuracy while adoption is zero.** Looks like: a report that leads with "90% correct" and buries "3 total external visitors." Defense: §13 (accuracy structurally excluded from every threshold) + §19's report-format requirement that adoption metrics are reported first and cannot be omitted or minimized regardless of accuracy.
12. **Definitional creep on "external."** Looks like: quietly counting a Federation associate's cousin, a paid contractor, or a friendly Discord regular as "external" because they hold no formal Federation title. Defense: §16's affiliation test uses behavioral/relationship criteria, not formal-title criteria, specifically to close this gap; residual acknowledged below.
13. **Silent threshold-adjacent rounding.** Looks like: "we got 4 unique challengers against a threshold of 5, but that's basically 5." Defense: §22 thresholds are stated as hard integers with no rounding language; §21's report format requires the raw number stated before any characterization of it.
14. **Declaring victory on a technicality after a genuinely weak run.** Looks like: hitting the letter of a minimum threshold via one of the above tricks while the spirit (real external interest) plainly wasn't there. Defense: §22 defines MINIMUM SUCCESS as a floor that unlocks *continued operation*, not a claim of thesis validation — §23 keeps thesis-validation and continued-operation as two separate, independently gated claims, so clearing the floor alone can never be reported as "the thesis was validated."

**Named residual, honestly stated (not engineered away):** no purely mechanical rule can fully close the gap between "person with no formal Federation affiliation" and "person meaningfully independent of the Federation's existing reach and goodwill." §16 narrows this with behavioral criteria and transparency requirements, but a founder's genuinely-organic-but-adjacent audience (someone who followed the founder on a personal account for unrelated reasons, then engages with FCC) will sometimes be miscounted in both directions. This is disclosed as the honest Stage-0 residual, the same way frozen §16 discloses annex-admission operator trust — not solved, bounded and stated.

---

## 16 · SYBIL / DUPLICATE-PARTICIPANT AND FEDERATION-AFFILIATION TREATMENT

**Sybil/duplicate identities.** Unchanged reputation architecture (frozen §10) already treats wallet and account identities as separate unless explicitly linked — no inference of common ownership. For Stage 0 counting purposes only: identities sharing strong behavioral correlation (near-identical challenge text submitted within a short window from multiple identities, or identities that self-disclose common control) are flagged for manual review and, if confirmed, counted once. This is a counting-time procedure, not a change to challenge processing (§8) — every challenge is still resolved on its merits regardless of how its filer is later counted.

**Federation affiliation — behavioral test, not formal-title test (closes gaming vector 12).** An identity is treated as FEDERATION-AFFILIATED and **excluded from external-facing metrics (12.0–12.2)** if any of: publicly known team member, contractor, or the identity named in [[robert-jordan]]'s role; has received compensation from the Federation in the prior 12 months; is a moderator/admin of a Federation-controlled community channel; or self-discloses affiliation. The exclusion list (pseudonymous identifiers, not real names) is published alongside the final report so the exclusion itself is auditable. **What this test cannot reach — stated honestly, not hidden:** a person with a real but informal relationship to the founder or Federation (a friend, a follower with no title, someone in the founder's existing audience) who has no *disclosed* affiliation. This is the named residual in §15 item 12/§15's closing paragraph — mitigated, not eliminated, by requiring self-disclosure as an ongoing rule (violating it is itself an integrity breach, §15) and by the returning-challenger count (12.0(b)) being harder to fake at scale through informal-but-undisclosed relationships than a single-visit count would be.

**Affiliation timing correction (ratified).** Two distinct cases, never conflated:
- **(A) New affiliation begins during Stage 0** (e.g., someone becomes a contractor mid-experiment): the exclusion applies **prospectively from the actual affiliation start date** — engagement genuinely logged before that date, while the person was genuinely external, is NOT retroactively stripped; engagement from the affiliation start date forward is excluded going forward.
- **(B) Previously-existing affiliation is discovered later** (a misclassification is caught after the fact — the person was affiliated the whole time but wasn't on the known-affiliation baseline): **historical external-engagement metrics ARE corrected back to the actual affiliation start date** — this is a correction of a misclassification against the already-frozen affiliation *rule* (§16 as written), not a retroactive change to the success *methodology* (§19's prohibition governs changes to the rule itself, not the ordinary correction of a factual misapplication of an unchanged rule). The correction is publicly recorded as a corrections-class entry (frozen §13 vocabulary) stating what was recounted and why. **Historical counts are never silently removed** — the corrections entry shows both the original count and the corrected count, so the correction itself is auditable rather than a quiet edit.

**Manufactured engagement via Federation's own accounts (hard rule).** The Federation's own official accounts, the founder's own accounts, and any account meeting the affiliation test above are prohibited from filing challenges, from artificially amplifying specific instruments over others, or from soliciting challenges from known associates during the experiment window. A violation, if it occurs and is disclosed or discovered, is logged as a corrections-class integrity incident (frozen §13 corrections vocabulary already covers this class) and the affected metric period is flagged in the final report, not silently corrected out.

---

## 17 · WHAT MUST BE FROZEN BEFORE INSTRUMENT #1 — THE EXPERIMENT FREEZE ARTIFACT (AD-E3 RESOLVED)

**Vehicle.** Stage 0 receives a **dedicated Experiment Freeze governance artifact**, not a Capital Instrument. It is **not** routed through the Capital Instrument witness/commit-point/OTS pipeline (BUILD 03) merely to create it — that pipeline exists for instruments under the frozen lifecycle, and the freeze is a governance document, not an instrument. Proposed location: `governance/experiments/stage0-public-experiment-v1/`. Once committed, it is protected by the same existing append-only law as every other governed artifact (frozen storage law, unchanged) — subsequent changes/corrections follow the ordinary corrections-entry discipline (§13/§19), not a special mechanism invented for this experiment. **Concrete implementation of how it is committed (which tool, which commit, exact file layout within that directory) remains outside this design gate's authority and belongs to a future implementation gate** — this section specifies *what* must be frozen and *where* it lives conceptually, not the mechanics of writing it.

**Contents, all committed together before Instrument #1 reaches LOCK:**

1. This final experiment specification's own content hash, so amendments to the experiment design itself are detectable.
2. The full initial candidate topic list (§4) — every candidate considered, not just those ultimately filed.
3. The candidate/source-selection methodology (§4) — the mechanical procedure itself, not just its output.
4. Primary metric designation (§12.0, EXTERNAL CHALLENGER DEPTH) and secondary metrics (§12.1–12.5), and that this designation cannot change mid-experiment (§19).
5. Minimum-success, strong-success, and failure thresholds (§22, ratified).
6. The promotion/visibility methodology (equal listing across all filed instruments, per §15 item 5).
7. The affiliation methodology (§16) and the known-affiliation baseline (the pre-experiment list of known-affiliated identities — updatable only by prospective addition during the experiment, §18, never by retroactive removal of someone once flagged, and subject to the §16 timing-correction rule for later-discovered pre-existing affiliation).
8. Experiment dates: the actual UTC start/end (§18-AD-E4 — frozen immediately before launch, not chosen in this design pass).
9. Instrument count and horizon distribution: **15 instruments / 90 days, 5 short (≤14d) / 5 medium (15–45d) / 5 long (46–90d)** (ratified, ties directly to and slightly refines §3's distribution rule — the 60%-cap language in §3 is now superseded by this exact 5/5/5 split for this experiment specifically; §3's general principle for any future FCC experiment is otherwise unchanged).
10. Appropriate content hashes for every item above that is itself a document (candidate list, methodology text, etc.), so each piece is independently verifiable against what was actually frozen.

**Launch timing (AD-E4 RESOLVED).** Actual calendar dates are **not selected in this design pass**. Day 1 begins only after all required experiment infrastructure and any unresolved production prerequisites (including, notably, BUILD 03.1's AD-3 Telegram production-classifier resolution, since Stage 0 instruments would need real witness publication to mean anything) are ready — not before. Immediately before launch, the actual UTC start/end dates are frozen into the Experiment Freeze artifact as item 8 above — a separate, later, narrow action, not part of this specification-design gate.

---

## 18 · WHAT MAY LEGITIMATELY CHANGE DURING THE EXPERIMENT

- The proposal queue may receive new community-suggested topics (frozen law, unchanged); filed instruments from the queue still obey §3 eligibility and count toward the *filed* total, not the frozen candidate-list baseline in §17 item 2.
- The Federation-affiliation list (§16) may grow (new team members, new contractors) — additions only, applied prospectively; a person cannot be added to the affiliation list retroactively to reclassify their past engagement, nor removed once flagged, without a corrections entry explaining why.
- Operational/administrative details not touching measurement — e.g., which specific server hosts analytics logging (§12.5) — may change without invalidating the run, provided the change doesn't alter what is counted or how.
- Ordinary instrument lifecycle events (challenges, resolutions, corrections) proceed exactly per unchanged frozen law throughout.

---

## 19 · WHAT WOULD INVALIDATE THE EXPERIMENT

Any of the following, if it occurs, means the final report must state the run as **COMPROMISED** rather than reporting clean pass/fail against §22, regardless of what the raw numbers show:

- Any change to the PRIMARY metric designation, any threshold in §22, the eligibility rules (§3), or the topic-selection method (§4) after §17's freeze.
- Retroactive removal of an already-abandoned or already-flagged-affiliated identity/instrument from the record.
- Any confirmed instance of Federation-account manufactured engagement (§16) that is not immediately disclosed and logged.
- Deletion or rewriting of any filed instrument's locked bytes or events (structurally impossible under frozen append-only law — listed here for completeness, since a violation of this would invalidate far more than just this experiment).
- Selective non-publication of a resolved instrument's outcome (frozen anti-erasure/negative-results requirement, §20).

---

## 20 · NEGATIVE-RESULTS AND FAILED-INSTRUMENT PUBLICATION REQUIREMENT

Every filed instrument's terminal disposition — RESOLVED-CORRECT, RESOLVED-INCORRECT, VOID, INVALIDATED-BY-DOCTRINE, DISPUTED, TRIVIAL — is published permanently, unchanged from frozen anti-erasure law, with no exception for outcomes embarrassing to FCC. The final Stage 0 report (§21) must list every filed instrument by disposition in one table — no instrument may be omitted from the summary table regardless of outcome.

---

## 21 · FINAL STAGE 0 REPORT FORMAT (required structure)

1. **Header:** experiment window (actual vs. frozen §17 item 8 dates), total instruments filed vs. size of the original hashed candidate list (§17 item 2), abandonment count and reasons.
2. **Primary metric result** (as designated in §17 item 4), stated first, raw number, against the frozen thresholds (§22) verbatim.
3. **Secondary metrics** (§12.1–12.5), each reported with raw counts before any characterization.
4. **Full instrument disposition table** (§20) — every filed instrument, no omissions.
5. **Accuracy/calibration section** (§14), explicitly labeled non-load-bearing per §13.
6. **Benchmark comparison table** (§6) where available, `NONE AVAILABLE` noted where not.
7. **Affiliation exclusion list** (§16), pseudonymous.
8. **Integrity incident log** — any §15/§19 events that occurred, disclosed regardless of impact on the headline numbers.
9. **Explicit conclusion statement** using the exact frozen-choice language from §22/§23 — "VALIDATED," "NOT VALIDATED," or "INCONCLUSIVE — [reason]" — with no fourth option and no hedged non-answer permitted.
10. **What changed vs. §18/§19**, if anything, stated plainly even if nothing did ("no changes occurred" is itself a required line, not an omission).

---

## 22 · FROZEN THRESHOLDS (AD-E1 RATIFIED)

**PRIMARY METRIC (designated per §17 item 4):** EXTERNAL CHALLENGER DEPTH (§12.0) — the two absolute counts (unique substantive external challengers; qualifying returning external challengers), never a rate. Chosen over a percentage-based metric specifically because a rate can be inflated by shrinking its own denominator (§15 item 13's rounding concern generalizes to rate metrics broadly) — an absolute-count primary metric is harder to game with a small, cherry-picked sample.

**MINIMUM SUCCESS CONDITION** (both required, by Day 90):
- ≥5 unique substantive external challengers (§12.0(a)), AND
- ≥2 qualifying returning external challengers (§12.0(b)).

**STRONG-SUCCESS CONDITION** (all three required):
- ≥10 unique substantive external challengers (§12.0(a)), AND
- ≥4 qualifying returning external challengers (§12.0(b)), AND
- Substantive external challenges occur on ≥25% of filed instruments (§12.1) — added specifically so a strong result can't rest on deep engagement with only one or two instruments while the rest of the slate goes untouched.

**FAILURE CONDITION:** The minimum-success condition (both parts) is not achieved by Day 90. Restated at the defensible floor beneath any threshold choice: zero unique substantive external challengers across all 15 instruments over the full 90 days is a failure under this or any reasonable minimum-success bar — a protocol that generated no externally-attributable engagement across 15 separate public artifacts over 90 days has not shown evidence external people care to check the record.

**KILL/PIVOT RULE (day-45 early-failure option, preserved unchanged).** If, at the **day-45 midpoint**, cumulative unique substantive external challengers = 0 AND no instrument has received any substantive external engagement at all (§9), the operator may (a) continue to day 90 for a complete negative result (permitted, and arguably the more honest choice — see §19's spirit), or (b) declare an early FAILURE conclusion and stop, provided the early-stop itself is logged with the day-45 numbers and does not retroactively soften what would otherwise have been reported. **There is never an early-success option** — early stopping is only ever an early, honestly-labeled failure, precisely to block the "declare victory the moment the numbers look decent, before they regress" gaming pattern.

---

## 23 · CAPITAL-EXPERIMENT GATE

Conditions required before FCC may claim Stage 0 **validated the product thesis** (§1) — ALL required, none sufficient alone:
- Minimum-success condition (§22, whichever bracket was frozen) met on the frozen primary metric.
- No invalidating event occurred (§19), or if one did, the report explicitly carries it and the conclusion is downgraded to INCONCLUSIVE regardless of the raw numbers.
- The full disposition table (§20) is published with no omissions.
- Accuracy is reported but explicitly NOT cited as supporting evidence for the validation claim (§13).

Conditions required before FCC may **propose** (not begin — propose, as its own separate future gate) a capital-bearing experiment:
- The above thesis-validation conditions, AND
- A separate, not-yet-designed specification for Stage-1 precedence attestation (frozen Spec §3.8, explicitly still GATED and untouched by this document) — capital-bearing activity requires an attestation mechanism this spec does not create and does not claim to satisfy.
- Explicit owner + adjudicator sign-off that Stage 0's engagement, even if it met §22's minimum bar, was large/sustained enough to justify the qualitatively larger commitment of real capital — a judgment call this spec deliberately does not pre-authorize mechanically, because manufacturing a formula for "engagement large enough to risk real money" would itself be exactly the kind of precision-without-evidence §15 warns against.
- Stage 0 clearing its floor is necessary but is explicitly stated here as NOT sufficient for a capital gate — that gate requires its own future authorization, its own design document, and cannot be triggered by this specification alone.

---

## 24 · ARCHITECTURE DECISIONS REQUIRED — ALL RESOLVED (v0.2 RATIFICATION)

**AD-E1 — RESOLVED.** Minimum/strong/failure thresholds ratified in §22.

**AD-E2 — RESOLVED.** Challenge behavior (§12.0) is authoritative; citation/referrer measurement (§12.5) is privacy-respecting-only, fingerprinting/cross-site-profiling prohibited unconditionally, NOT MEASURED if unavailable.

**AD-E3 — RESOLVED.** Dedicated Experiment Freeze governance artifact at `governance/experiments/stage0-public-experiment-v1/` (§17), not a Capital Instrument, not routed through the BUILD 03 witness pipeline; governed by existing append-only/corrections law.

**AD-E4 — RESOLVED.** 15 instruments / 90 days, 5 short / 5 medium / 5 long (§3, §17 item 9). Calendar dates deliberately not chosen this pass — frozen immediately before launch (§17, Launch timing), after infrastructure and outstanding production prerequisites (incl. BUILD 03.1 AD-3) are ready.

**No architecture decisions remain open in this specification.**

---

## 25 · IMPLEMENTATION READINESS: **NO — awaiting Experiment Freeze creation, not an architecture gap**

All four architecture decisions are resolved; nothing in this specification is blocked on undetermined design. Readiness is withheld only because the Experiment Freeze artifact (§17) does not yet exist, no candidate slate has been drafted, no calendar dates are chosen, and — per this pass's explicit instruction — none of that is created here. No frozen law was amended; every mechanism in this document consumes existing frozen primitives (Filing Log, challenge system, corrections, append-only storage, BUILD 03 witness/commit-point) without modification.

## 26 · NEXT PROPOSED GATE — DO NOT EXECUTE

**BUILD 04 IMPLEMENTATION PASS** (not authorized here): create the Experiment Freeze artifact per §17 (candidate slate, methodology, hashes), the promotion/visibility equal-listing mechanism, the affiliation-exclusion tracking (incl. the §16 timing-correction procedure), and the engagement-measurement tooling (§12) as actual code/tooling against this specification — still gated behind its own explicit authorization, still excluded from calendar-date selection and from any real publication until BUILD 03's remaining gates (AD-3 Telegram production activation, BUILD 03.1) are separately resolved.

**STOPPED.** No code written. No repository modified. No Experiment Freeze artifact created. No candidate list drafted. No calendar dates chosen. No instrument created. No publication of any kind. No BUILD 04.
