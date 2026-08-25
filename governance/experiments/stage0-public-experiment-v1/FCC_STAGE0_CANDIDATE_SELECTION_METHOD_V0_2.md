# FCC_STAGE0_CANDIDATE_SELECTION_METHOD_V0_2

Status: FINAL RATIFICATION CORRECTION PASS OUTPUT — C-3 ONLY (supersedes the prior v0.2 draft). Design only — no repository modified, no `candidate-slate.json` populated, no intake run, no calendar dates chosen, no Instrument #1, no publication. This pass touches ONLY the §2 Step 0 cutoff-trigger mechanism; C-1, C-2, C-4, C-5, C-6, and C-7 are unchanged from the prior draft and not reopened.

---

## EXACT CHANGES (v0.1 → v0.2)

- **C-1**: Registry accounting corrected: **10 candidate-generating sources (Classes A–F) + 2 benchmark-only sources (Class G) = 12 named sources total.** A2's identity corrected to `Cactus (formerly Tally), tally.xyz` — verified live: Tally rebranded to Cactus in 2026, same platform and domain, stable governance space URLs and proposal IDs unchanged.
- **C-2**: §2 Step 2 (dedup) rewritten. Semantic "same real-world question" merging is no longer treated as mechanically objective and can never destructively merge. New `POSSIBLE_DUPLICATE` flag (mechanically detected, never silently merged) plus a deterministic skip rule for when two flagged candidates both rank into selected positions.
- **C-3**: §2 Step 0 (cutoff) rewritten, then **finally frozen** in this pass. Operator discretion over *when* to run intake is removed entirely, replaced with a mechanical trigger function of exactly two objective, publicly-logged readiness conditions — permanently closed, with no future-gate escape hatch and an explicit `INTAKE_BLOCKED` (never silent-reschedule) fallback for genuine execution-time blockers.
- **C-4**: §4B (ordering) rewritten. Source-class priority rank removed. New order: source's own opening/announcement timestamp ascending, then the same SHA-256 tie-break. Source-diversity risk discussed; no new discretionary quota introduced.
- **C-5**: New §1.5 (acquisition interfaces) added — every Class A–F source now specifies its exact enumerable acquisition mechanism, with two sources (B2, C1/C2) honestly downgraded rather than pretended reconstructible.
- **C-6**: §1 Class C entries and §3 eligibility checklist corrected — roadmap-only items were previously "weighted down"; they are now mechanically ineligible under the unchanged horizon rule (Step 3, item 2: no source-published resolution date), with no separate weighting language remaining.
- **C-7**: `LOOKBACK_DAYS = 21` and `MIN_FILING_LAG = 3 calendar days` are ratified and **no longer owner-adjustable** — removed from §7's "remaining owner decisions" and now stated as frozen constants inline wherever they're used.

Everything else (source list membership in A–F, the eligibility checklist's other items, the shortage/overflow mechanics, the difficulty-quota substitution mechanism, community-proposal treatment) is unchanged from v0.1 and not reproduced with commentary below except where a correction touches it directly.

---

## 1 · SOURCE REGISTRY (12 total: 10 generating + 2 benchmark-only) — corrected

### Class A — Protocol governance systems
**A1. Snapshot (snapshot.org)** — unchanged from v0.1.
**A2. Cactus (formerly Tally), tally.xyz** — same platform, same domain, same governance-space URLs and proposal-ID scheme as when it operated under the Tally name; only the product name/branding changed. All other fields (observable events, horizon, verifiability, risk) unchanged from v0.1's A2 entry.

### Class B — Regulatory dockets / agency actions
**B1. SEC EDGAR** — unchanged.
**B2. CFTC Press Releases + Enforcement Actions index** — unchanged in substance; acquisition tier downgraded, see §1.5.

### Class C — Exchange / issuer announcements
**C1. Coinbase**, **C2. Kraken** — unchanged in substance (delisting/status-change sub-class only is usable; roadmap sub-class is now flatly ineligible per C-6, not merely deprioritized); acquisition tier downgraded, see §1.5.

### Class D — Public blockchain / on-chain state
**D1. L2BEAT**, **D2. DefiLlama** — unchanged in substance; acquisition surfaces specified in §1.5.

### Class E — Protocol upgrade / governance schedules
**E1. Ethereum core-upgrade schedule** — unchanged in substance; acquisition surfaces specified in §1.5.

### Class F — ETF / fund / public filing records
**F1. SEC EDGAR, named issuer CIKs** — unchanged.

### Class G — Benchmark-only, never a candidate/resolution source
**G1. Polymarket**, **G2. Kalshi** — unchanged.

---

## 1.5 · ACQUISITION INTERFACES (new, per C-5)

For every Class A–F source: the exact enumerable mechanism, and how pagination, edits, timestamps, and canonical identifiers are handled. General rule applied everywhere below: **timestamps are always the source's own published timestamp field, never locally inferred**; **canonical identifiers are always the source's own immutable ID**, used both for §2 Step 2 dedup and §4B ordering; **pagination is walked to exhaustion** within the lookback window using each API's native mechanism; **edits are handled by re-fetching the canonical identifier's current state at ordering/selection time**, retaining the original collection timestamp for audit alongside the latest fetched content.

- **A1 Snapshot**: public GraphQL API (`hub.snapshot.org/graphql`, documented, no key required). `proposals` query filtered by `space_in: [<frozen space list>]`, `created_gte`/`created_lte` bounding the lookback window, paginated via `first`/`skip`. Canonical ID = the proposal's own `id` (an IPFS-hash-derived string). Timestamps = `created`/`end` fields verbatim.
- **A2 Cactus (tally.xyz)**: public GraphQL API (`api.tally.xyz/query`, documented, free API key required — obtainable by any third party, not an FCC-exclusive credential). `proposals` query by `governorId`, cursor-paginated. Canonical ID = the proposal's on-chain `id`. Timestamps = the query's `createdAt`/voting-period-end fields verbatim.
- **B1 SEC EDGAR**: full-text search API (`efts.sec.gov/LATEST/search-index`, JSON, documented, no key required) filtered by `forms` and `dateRange`, paginated via `from`; supplemented by per-company submissions JSON (`data.sec.gov/submissions/CIK##########.json`) for issuer-scoped tracking. Canonical ID = the filing's `accession number`. Timestamps = the filing's own `filingDate`.
- **B2 CFTC** — **acquisition tier: DOWNGRADED, not removed.** No documented bulk API or feed for press releases/enforcement actions was found (verified by search; CFTC's only confirmed public API covers Commitments-of-Traders market data, unrelated to this use). Retained via two deterministic-but-weaker surfaces: (a) sequential numeric press-release ID space (`cftc.gov/PressRoom/PressReleases/{seq}-{yy}`), walked by incrementing `seq` for the current two-digit year and checking for a valid page (a mechanical brute-force enumeration, not a query, but still reproducible by an independent party with no judgment involved); (b) a fixed-structure HTML table parse of the Enforcement Actions index page. Canonical ID = the press-release number (e.g., `9198-26`) or the enforcement-action's own case identifier. **Disclosed limitation**: this tier is more fragile than the others (a page-structure change could silently break enumeration) — flagged honestly rather than presented as equivalent to an API.
- **C1 Coinbase, C2 Kraken** — **acquisition tier: DOWNGRADED, conditional.** No documented bulk API or confirmed dated-archive index was found for either exchange's delisting/status-change announcements (these are blog/support-center posts). Per C-5's instruction to downgrade rather than pretend reconstructibility: **these two sources contribute zero candidates to any given intake run unless the operator confirms, at execution time, a concrete dated feed or dated archive index for the specific announcement subdomain being used** (e.g., a confirmed RSS/Atom feed on the relevant blog, or a confirmed paginated support-center index with stable per-post dates and URLs). This confirmation is a binary, logged, non-discretionary gate — either a reproducible feed is confirmed and cited (with its URL, entered into the frozen source registry as an addendum) or the class contributes nothing that run. It is not a judgment call about which posts "count"; it's a yes/no about whether a reproducible enumeration mechanism exists at all.
- **D1 L2BEAT**: primary surface = L2BEAT's public open-source configuration repository (github.com/l2beat/l2beat), accessed via the GitHub REST API `commits` endpoint filtered by path (the specific tracked project's config file) and date range. Stage-classification and risk-tier changes are recorded as commits to these files. Canonical ID = the commit SHA. Timestamps = the commit's own `committer.date`. Secondary/corroborating surface = L2BEAT's public API (`api.l2beat.com`) for current-state snapshots.
- **D2 DefiLlama**: public API (`api.llama.fi`, documented, no key required), historical TVL and category endpoints with per-datapoint timestamps. Canonical ID = protocol slug + datapoint timestamp.
- **E1 Ethereum upgrade schedule**: primary surface = the GitHub API `commits`/`releases` endpoints on the relevant public specification-tracking repository (e.g., `ethereum/execution-specs` or the network-upgrade meta-EIP), giving an immutable commit/release SHA and timestamp for schedule changes. Secondary/corroborating surface = the Ethereum Foundation blog's RSS/Atom feed for the human-readable announcement, where one is confirmed to exist at execution time (same binary confirm-or-contribute-nothing rule as C1/C2, applied here as a *secondary* corroboration source only — E1's primary GitHub surface does not depend on this confirmation).
- **F1 SEC EDGAR, named issuer CIKs**: identical mechanism to B1, scoped to a fixed, pre-declared list of issuer CIKs (BlackRock/iShares, Fidelity, Grayscale, VanEck, ARK, Bitwise — the same six named in the v0.1 research). Canonical ID and timestamps as in B1.

---

## 2 · EXACT CANDIDATE INTAKE PROCEDURE — corrected

**Step 0 — Cutoff trigger (mechanically determined and now FULLY FROZEN, per the final C-3 correction).** `CUTOFF_TIMESTAMP` is never a discretionary "operator presses go" moment, and the trigger set itself is closed — nothing can be added to it later.

**`CUTOFF_TIMESTAMP = 00:00:00 UTC exactly 2 calendar days after the LATER of:`**
1. BUILD 03.1's AD-3 gate status transitioning to `VERIFIED` in its own governance record; and
2. Candidate Selection Method v0.2's ratification being recorded (the event closing the red-team correction pass).

**No subsequently added prerequisite may move, reset, recompute, postpone, or otherwise alter this timestamp.** The `(c)` provision in the prior draft — allowing a future gate to add a new trigger condition — is removed entirely; the trigger set above is exhaustive and permanent for this ratified methodology. A later gate cannot retroactively insert itself into this computation, no matter how legitimate the new prerequisite is.

**`INTAKE_BLOCKED` handling.** If some other legitimate prerequisite (not part of the frozen trigger set) prevents intake from actually executing at the computed `CUTOFF_TIMESTAMP`, the correct and only response is to record status `INTAKE_BLOCKED` at that timestamp, with the specific blocking reason logged. **The cutoff is never silently recomputed, postponed, or substituted to route around the blockage.** Resuming or restarting candidate selection after an `INTAKE_BLOCKED` event requires its own separately authorized experiment/freeze gate that visibly addresses the failed run — a fresh, explicit `CUTOFF_TIMESTAMP` computation under a new, equally-frozen rule, not a quiet retry of the old one. This makes a blocked run a visible, gated event rather than an invisible extension the operator could use to wait for a more favorable day.

`CUTOFF_TIMESTAMP` is therefore a deterministic function of exactly two events that are public and logged *before* anyone is looking at the crypto/finance market environment with intake in mind — the operator cannot see "the market looks favorable today" and choose to run intake, because the date was already fixed by the later of those two conditions, two days prior, regardless of what the market is doing, and no third path exists to move it. This remains fully compatible with the base spec's rule that calendar dates aren't chosen until production prerequisites (explicitly including BUILD 03.1) are ready, because AD-3 verification is one of the exactly-two trigger conditions.

**Step 1 — Collect the raw pool.** Unchanged from v0.1, using the corrected acquisition interfaces (§1.5) and the now-frozen `LOOKBACK_DAYS = 21` (no longer adjustable, per C-7).

**Step 2 — Deduplicate — corrected, per C-2.**
- **Automatic, destructive merge** is permitted ONLY when two raw items share an **identical canonical source identifier** (§1.5's per-source definition), or match an **explicitly frozen cross-source equivalence key** — a pre-declared, mechanically-testable equality rule pairing specific identifier patterns across two named sources as always referring to the same real-world filing/proposal (e.g., a specific, pre-declared mapping between an EDGAR accession number field and a corresponding exchange rule-filing number, if and when such a mapping is explicitly ratified in a future gate). **No cross-source equivalence key is ratified in this document** — the mechanism exists but starts empty, so in practice automatic merge currently fires only on identical-ID duplicates (e.g., the same EDGAR filing appearing twice in one collection pass).
- **Semantic similarity is never a merge basis.** Instead, a mechanical (not human-judgment) similarity test flags two candidates `POSSIBLE_DUPLICATE` of each other when ALL of: (a) they reference the same underlying asset/entity identifier (ticker, contract address, or CIK); AND (b) their source-published resolution dates fall within a frozen ±3-calendar-day window of each other; AND (c) a Jaccard similarity of their normalized resolution-question keyword sets is ≥ 0.6 (a frozen, disclosed threshold — approximate by construction, and disclosed as such in §6). Both flagged candidates are **retained in the published candidate pool**, cross-referencing each other's identifiers; neither is merged, dropped, or silently altered.
- **Deterministic handling when two `POSSIBLE_DUPLICATE` candidates both rank into selected positions** (within the same or different buckets): the ordered list (§4B) is walked normally. When a candidate would be selected and it carries an active `POSSIBLE_DUPLICATE` flag against another candidate that is **already selected and ranks earlier** in the frozen order, the later-ranked one is **skipped for selection** (not deleted — remains published, tagged `POSSIBLE_DUPLICATE_SKIPPED`, referencing the earlier-ranked candidate it deferred to) and bucket-filling continues to the next eligible, non-conflicting candidate in the frozen order. This rule is symmetric, history-independent (always defers to whichever ranks earlier under the already-fixed §4B order — never a case-by-case judgment), and requires no operator input. **Disclosed limitation**: the similarity test is approximate and can both over-flag (two genuinely distinct candidates skipped unnecessarily) and under-flag (two genuinely duplicate candidates both selected because they fell outside the ±3-day/0.6-Jaccard window) — named honestly in §6, not engineered away.

**Step 3 — Eligibility filters — corrected item 2, per C-6.** Unchanged sequence, with the horizon-date item now explicit that it is the sole and sufficient reason roadmap-only exchange announcements are rejected:
1. Source ∈ the 10 Class A–F registry entries (with C1/C2's conditional acquisition-confirmation gate from §1.5 applied at collection time, before this filter is even reached)?
2. **Has a source-published, fixed resolution/decision date?** A roadmap-only exchange listing signal (no stated target date, no binding commitment) fails this filter on its own terms — it is not "weighted down" or scored lower; it simply does not have the date this filter requires, exactly the same as any other source's undated item would fail here. No exchange-specific carve-out or special-case language exists anywhere in this document anymore.
3–7. Unchanged from v0.1 (qualification-stance shape; no $GFOF/Dossier/Federation; horizon 3–90 days using the now-frozen `MIN_FILING_LAG = 3`; passes existing AI LINT).

**Step 4 — Horizon bucketing.** Unchanged, pure arithmetic.

**Step 5 — Deterministic ordering.** Corrected, see §4B below.

**Step 6 — Select, respecting the §2 Step 2 duplicate-skip rule.** Unchanged otherwise.

**Step 7 — Difficulty-quota check and substitution.** Unchanged from v0.1.

**Step 8 — Publish.** Unchanged; the full pool now additionally carries `POSSIBLE_DUPLICATE` / `POSSIBLE_DUPLICATE_SKIPPED` tags and, for B2/C1/C2, an explicit acquisition-confirmation record for that run.

---

## 3 · ELIGIBILITY ALGORITHM

Unchanged sequence from v0.1 except item 2's framing, corrected above (§2 Step 3). Restated checklist:
1. Source ∈ registry (with acquisition confirmed for that run, where conditional)?
2. Has a source-published fixed resolution date? *(this alone is what rejects roadmap-only items)*
3. Qualification-stance shaped?
4. No $GFOF/Dossier/Federation subject or source?
5. `days_to_resolution` between `MIN_FILING_LAG` (3, frozen) and 90?
6. Passes frozen AI LINT once drafted?
7. Survives → ELIGIBLE.

---

## 4 · HORIZON BUCKETING, ORDERING, TIE-BREAK, SHORTAGE/OVERFLOW, DIFFICULTY QUOTA

**A — Horizon bucketing.** Unchanged, pure arithmetic.

**B — Deterministic ordering within a bucket — corrected, per C-4.** Sort eligible candidates by, in order:
1. **The item's own source-published opening/announcement timestamp, ascending** (earliest first) — no source-class priority of any kind. A Class C delisting notice, a Class A governance proposal, and a Class B docket entry that opened on the same bucket are now ordered purely by which happened first in the real world, never by which source class an operator (or this document's author) rated as more trustworthy.
2. **Deterministic hash tie-break** (unchanged mechanism): `SHA256(canonical_source_identifier || CUTOFF_TIMESTAMP)`, ascending. Used only when two items share the exact same opening timestamp to calendar-day granularity.

**Source-diversity risk, disclosed (per C-4's instruction to explain, not compensate with a new quota).** Removing the source-class rank means a bucket's composition now depends entirely on which sources happen to produce timestamped items first within the lookback window — if, in a given run, Class A (governance) happens to be unusually active while Class B (dockets) is quiet, a bucket could skew heavily toward on-chain governance candidates with no docket-sourced items at all. **No new discretionary diversity quota is introduced to correct this**, per the explicit instruction that one is not required by frozen law. This is named as a real, accepted risk: source-class composition is now an emergent property of real-world event timing within a given intake window, not a designed target. If this proves problematic in practice (e.g., a run produces a 15-candidate slate from only 2 of the 6 non-benchmark classes), that is visible in the published pool's own composition and is exactly the kind of observation a future gate could act on — it is not silently absorbed or hidden by this methodology.

**C — Shortage handling.** Unchanged from v0.1, using the now-frozen `LOOKBACK_DAYS = 21` as the base window before any doubling.

**D — Overflow handling.** Unchanged from v0.1, now also respecting the §2 Step 2 duplicate-skip rule when walking past a selected slot.

**E — Difficulty-quota interaction.** Unchanged from v0.1 (existing, unmodified AI Standing Adversary flag; deterministic bucket-by-bucket substitution).

---

## 5 · COMMUNITY-PROPOSAL TREATMENT

Unchanged from v0.1 — a suggestion enters the same raw pool at Step 1 with no reserved slot, no bypass of any rule above (including the new dedup and ordering corrections), and is ineligible outright if it cannot be mapped to one of the 10 registry sources with a confirmed acquisition surface for that run.

---

## 6 · ADVERSARIAL REVIEW — RE-RUN AGAINST THE CORRECTED RULES

1. **Source-registry composition.** *Closure unchanged from v0.1*: frozen, published, 7 classes, no class exceeding 3 sources.
2. **Cutoff timing.** *Closure now COMPLETE (final C-3 correction)*: the operator has zero timing lever of any kind, and — unlike the prior draft — no future gate can add a new trigger condition either. The trigger set is exactly two events (AD-3 → VERIFIED; this methodology's own ratification), permanently closed. If some other real prerequisite blocks execution at the computed timestamp, the mechanical response is `INTAKE_BLOCKED`, never a silent recompute — so even an operator who *wanted* to wait for a better market day by inventing a plausible-sounding blocker gets a visible, logged block requiring its own new authorized gate to resume, not a quiet reschedule. This fully closes the residual v0.1 disclosed as "when to press go," and closes the narrower residual the prior v0.2 draft still carried (a future gate quietly adding a new trigger condition).
3. **Horizon assignment.** Unchanged, still pure arithmetic.
4. **Candidate eligibility.** Unchanged, still a short-circuit checklist with logged reasons; C-6 removes the last piece of exchange-specific special-case language.
5. **Duplicate treatment.** *Closure changed by C-2*: previously the risk was "operator merges an inconvenient candidate into a convenient one under cover of 'semantic similarity.'" Now: merging is restricted to identical IDs or an explicitly frozen (currently empty) equivalence-key table, and semantic similarity can only ever produce a flag plus a symmetric, order-dependent skip — never a merge, never a silent drop. *New residual, disclosed*: the Jaccard/date-window similarity test itself is approximate and could be gamed at the margin by an operator who, when supplying a community-suggested topic's keywords (§5), phrases them to dodge the 0.6 threshold and avoid a `POSSIBLE_DUPLICATE` flag against an inconvenient existing candidate — bounded by the fact that the *flagging* test runs on both candidates' *source-published* text, not operator-supplied paraphrase, wherever a direct source quote is available; residual is real only where a community suggestion's own wording is the sole text being matched, and is disclosed rather than hidden.
6. **Benchmark availability.** Unchanged from v0.1.
7. **Difficulty classification.** Unchanged from v0.1 (existing frozen adversary process, not a new lever).
8. **Bucket shortages.** Unchanged from v0.1, still fully mechanical.
9. **Tie-breaks.** *Closure strengthened*: with source-class rank removed (C-4), one entire layer of the ordering that still carried a one-time human judgment (which class ranks above which) is gone. The remaining order (timestamp, then hash) has zero human-set parameters.
10. **Abandoned candidates.** Unchanged from v0.1.
11. **NEW (surfaced by this correction pass) — acquisition-confirmation gaming.** *Attack*: an operator could claim "no reproducible feed confirmed" for C1/C2 in a run where the easily-discoverable exchange announcements would have produced an inconvenient candidate, versus confirming a feed exists in a run where it would help. *Closure*: the confirm/deny act itself is binary, logged, and cited (a URL, if confirmed) — a false "not confirmed" claim when a feed demonstrably exists is checkable by any third party attempting the same confirmation, exactly as any other claim in this system is checkable; this is the same class of residual as attack 1 (who names the sources) — a one-time, logged, externally-checkable human input, not a hidden per-run lever.

**Overall residual, restated honestly**: three logged, externally-checkable human touchpoints remain — which sources to name (unchanged from v0.1), the acquisition-confirmation binary for C1/C2/E1's secondary surface (new, but logged and checkable), and the approximate similarity threshold's exact value (new, disclosed as approximate). The cutoff-timing residual is now **fully** closed — including the narrower "a future gate could add a new trigger condition" gap the first v0.2 draft still left open, which this final correction removes by permanently freezing the trigger set at exactly two events. No purely mechanical system can close all three remaining items without either inventing false precision (pretending an approximate similarity test is exact) or removing sources that are otherwise legitimate and valuable (Coinbase/Kraken delisting notices are real, useful signal when a feed does exist) — the corrected design chooses honest disclosure and external checkability over either of those worse alternatives.

---

## 7 · REMAINING OWNER DECISIONS

None block ratification. `LOOKBACK_DAYS` and `MIN_FILING_LAG` are no longer owner-adjustable (C-7) and have been removed from this list. The only remaining open item is operational, not architectural: confirming (or not) a concrete feed URL for C1/C2 and E1's secondary surface at the time intake actually runs — which is not a decision made now, but a binary check performed mechanically at execution time per §1.5.

---

## 8 · REPRODUCIBILITY ASSESSMENT

Strengthened relative to the prior draft. Every step from raw collection through final selection is now either arithmetic, an exact-ID string comparison, an explicitly-scoped approximate similarity test whose formula and threshold are fully disclosed, or a fixed hash — and the cutoff-timing step is now a deterministic function of exactly two permanently-frozen logged events, with no path (not even a future gate) to alter the computed timestamp once the trigger set is ratified; a genuine execution-time blocker produces a visible `INTAKE_BLOCKED` record and requires a fresh, separately-authorized gate to resume, rather than a silent recompute. An independent party given the same registry, the same two trigger-condition resolution timestamps, and the same eligibility rules can reconstruct substantially the same candidate pool, including the same `POSSIBLE_DUPLICATE` flags and the same selection order — down to the specific skip decisions, since those follow deterministically from the frozen order and the disclosed similarity formula, and down to whether the run happened at all, since `INTAKE_BLOCKED` is as reconstructible a fact as a successful run.

# CANDIDATE-SELECTION FREEZE READINESS: **YES**

STOPPED. No repository modified. No candidate slate populated. No intake run. No calendar dates chosen. No Instrument #1. No publication.
