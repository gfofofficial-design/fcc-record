# AWS staging intake integration

This is a locally tested AWS SDK integration, not a deployed service. Only `FCC-TEST-*` instruments and a staging environment are accepted. No production keys, governance files, public receipts, identities, or witness publications are created or changed.

## Implemented

`tools/aws-staging-intake.handler` accepts an API Gateway HTTP API v2 POST event with JSON and a random `Idempotency-Key` (32–128 URL-safe characters). Clients must retain that key and reuse it after a timeout. The key is a bearer retry secret: use cryptographic randomness and do not log it. Reusing a key with different canonical submission bytes returns 409. Parseable test submissions with incomplete challenge fields are retained for later triage. Invalid transport envelopes, invalid JSON, and non-test instrument IDs receive explicit errors before acknowledgement.

The service hashes RFC 8785 submission bytes, requests an Ed25519 signature from KMS using `ED25519_SHA_512` and `RAW`, verifies it against the configured public key, and atomically writes the submission, signed receipt, and pending outbox entry to DynamoDB. Only then does it return 202. Concurrent requests and uncertain transaction outcomes recover the original receipt using a strongly consistent read. Storage or signing failures return 503 without a receipt; the client retries with the same key.

SQS receives only the receipt ID. Queue failure does not remove the durable outbox entry or move the original receipt timestamp. `tools/aws-staging-intake.dispatch` scans pending entries, including every pagination page, and retries delivery. Repeated dispatch intentionally permits duplicates. Sending to SQS never marks an entry publicly admitted. No TTL, deletion, public publisher, or consumer is implemented; pending entries remain pending. The scan is suitable for bounded staging volume only and needs indexing/checkpointing before production scale.

## Staging deployment contract — not yet provisioned

- Dedicated FCC AWS account, selected region, and an authenticated staging endpoint. Do not expose this handler as unauthenticated public intake; identity validation and abuse controls are not implemented.
- Node.js Lambda with the repository's pinned npm dependencies included. Handler: `tools/aws-staging-intake.handler`; separate scheduled dispatcher: `tools/aws-staging-intake.dispatch`.
- DynamoDB table named `fcc-staging-intake`, string partition key `pk`, on-demand billing, point-in-time recovery, deletion protection, and no TTL. Enable backups and restrict delete permissions. Retain the table on infrastructure teardown.
- SQS standard queue named `fcc-staging-receipts` in the same account and region as the signing key. Queue expiration must never be used as receipt retention; DynamoDB is the source for retries. Leave dispatch scheduling disabled until the staging test window to avoid repeated delivery without a consumer.
- A dedicated staging KMS Ed25519 signing key and its exported public key. Keep production key material separate. Availability and compatibility must be tested in the chosen region.
- Intake IAM permissions scoped to this table (`GetItem`, `PutItem` through transactions), this key (`Sign`), and this queue (`SendMessage`). Dispatcher role needs only table `Scan` and queue `SendMessage`; it must not receive signing permissions. Neither role needs GitHub publication credentials.

Required environment variables: `FCC_ENVIRONMENT=staging`, `FCC_INTAKE_TABLE`, `FCC_RECEIPT_QUEUE_URL`, `FCC_INTAKE_KEY_ARN` (immutable key ARN, not alias), `FCC_INTAKE_PUBLIC_KEY_PEM`, `FCC_INTAKE_KEY_VERSION=FCC-TEST-KEY-1`. Normal AWS role credentials and region configuration are supplied by Lambda; no embedded AWS credentials.

## Validation and remaining work

Run `npm run test:aws`. Tests use in-memory AWS command fakes and ephemeral Ed25519 test keys. They cover signature verification, concurrent retries, retained malformed challenge fields, atomic persistence failures, ambiguous commits, queue recovery, and staging boundaries. They do not establish real AWS IAM, durability, regional KMS support, or deployment correctness.

Before staging: supply account and region, create reviewable infrastructure configuration with cost controls, resolve the pre-existing npm audit findings in Ajv and fast-uri, and test real SDK interoperability using staging keys. Before production: implement and validate authenticated identity intake, public receipt publication and reconciliation, queue consumption, operational telemetry, backups/recovery, and production activation controls. The existing 7-day response clock remains tied to the provisional receipt; this integration does not adjudicate challenges.
