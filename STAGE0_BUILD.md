# Stage 0 application build

This branch builds a local, fixture-only workbench and a read-only public-record browser inside `fcc-record`. It does not activate live acquisition, publication, signing, capital activity, or another Federation surface.

Implementation targets:

- Verified read-only record projections and governing-document access.
- Isolated fixture workspace with the frozen instrument states and five dispositions.
- Challenge validation, durable signed test receipts, response deadlines, and explicit human resolution records.
- Mechanical resolution, independent OUTCOME/PROCESS scoring, and derived aggregates.
- Acceptance fixtures A–D, including late-response and unproven-precedence cases.
- Local interface for records, filings, challenges, corrections, verification, and telemetry.
- Reproducible build and automated application/security checks.

Existing production adapters remain gated. Test receipts use test keys and are not public receipts. Fixture anchors are simulated inputs and never represented as Bitcoin verification. Wallet and passkey activation, a production receipt service, approved AI-provider integration, live OTS verification, deployment, and shell activation require their operational prerequisites; the workbench must report those limits explicitly.
