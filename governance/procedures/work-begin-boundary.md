# WORK-BEGIN BOUNDARY — RATIFIED PROCEDURE
Owner + ChatGPT final ratification, recorded here per Doctrine §F3's intent-registration requirement. This is a procedural/auditable boundary — it does not and cannot claim to detect private human thought.

## THE RULE
An FCC assessment **begins** at the first assessment-specific substantive act after topic selection. Public Filing Log registration MUST occur **before** that act.

**Pre-assessment (may occur before registration):** topic receipt, topic-selection/triage.
**Assessment-specific substantive acts (registration MUST already be independently observable before any of these):** evidence retrieval or collection · analysis · thesis drafting · scoring · benchmark selection · model/AI analysis · judgment formation · assessment-specific research execution · creation of an assessment-specific workspace, task, branch, evidence directory, model session, or research job.

**Enforceable sequence:** proposal/triage → decision to open assessment → REGISTER INTENT → public Filing Log authority → assessment-specific work.

## MECHANICAL ENFORCEMENT (this build)
No assessment-specific tooling (evidence collection, drafting, scoring) exists yet in `fcc-record` — that is future work. What this build provides is the **reusable precondition gate** every future assessment-specific tool must call before proceeding: `tools/filing-log.js`'s `assertWorkPermitted(filingId, verifiedEvents)`. It refuses unless a `filing-opened` event for that `filingId` is present in an already hash-chain-verified event set — i.e., unless the registration is independently observable. Future BUILD work that adds real evidence-gathering, drafting, or scoring tooling must call this gate as a hard precondition; this build does not retroactively gate tooling that does not yet exist, but the gate itself is built, tested, and ready (Fixtures — see `tools/run-filing-log-tests.js`).
