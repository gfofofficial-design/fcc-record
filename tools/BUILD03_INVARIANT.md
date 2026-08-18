# NON-CODE IMPLEMENTATION INVARIANT — RECORDED FOR BUILD 03
Not implemented in BUILD 02.1. Persistent hold orchestration is explicitly out of scope for this pass.

**Invariant:** Before any production Lock Run reaches canonicalization/hash generation, the orchestrator MUST establish that the Filing-Log-reserved `instrument_id` has no active `PUBLICATION_RECONCILIATION_HOLD`.

The pure guard already exists and is proven (`tools/lib/lock-run-expiry.js`, `assertSecondHashAllowed`, Fixture M). It is currently invoked only inside tests, against an in-memory `heldStatesById` map constructed by the test itself. When BUILD 03 introduces real witness orchestration and therefore a real, persistent record of hold state per instrument ID, `assertSecondHashAllowed` (or its equivalent) must become an **unavoidable precondition** on the production Lock Run entry point — called against the authoritative persistent hold state, not an in-memory test fixture, before `prepareLockRun` is permitted to proceed to canonicalization. This is what makes Case B's "prohibit generation of another hash for that instrument ID" a real production guarantee rather than a proven-but-unwired capability.
