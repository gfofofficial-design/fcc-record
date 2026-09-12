# Production integration

## Integrated: anonymous GitHub artifact verification

Run `npm run verify:production -- <full-public-commit-sha>` from this repository. The local Git object database supplies the expected bytes; the frozen byte-exact manifest is checked before any network request. All committed `record/` artifacts, the manifest, and its listed artifacts are fetched anonymously from immutable URLs in `gfofofficial-design/fcc-record`.

The reader enforces the repository, full commit SHA, allowed artifact paths, request timeout, response-size bound, and four-request concurrency limit. Redirects and credentials are disabled. A missing artifact, changed byte, rate limit, timeout, or failed request never produces VERIFIED. Each file gets an explicit result.

The saved report is local, replaceable telemetry, not a governance record or an authorization. Its observation time comes from the local clock. Telemetry distinguishes the checked commit from the current checkout; it does not silently carry forward a successful check to a new commit. CI uses mocked responses and performs no production writes.

Saved telemetry is checked against a freshly derived plan for the current local commit before the application displays VERIFIED. Missing, duplicate, inconsistent, or mismatched evidence is INVALID_REPORT; observations for another commit are STALE. This checks report consistency only: the local report is unsigned and does not prove a fresh network observation. Run the verification command again for a new observation.

## Still inactive

The AWS staging intake handler and durable outbox dispatcher are implemented with mocked-service tests; see `AWS_STAGING_INTAKE.md`. No AWS resources have been provisioned and no public receipt consumer or publisher is active.

- Git and Telegram witness publication and independently scoped publication credentials.
- Public challenge receipt signing, durable hosted queues, and public receipt publication.
- Verified production identities and approved AI-provider integration.
- Live OpenTimestamps submission and Bitcoin proof verification.
- Public deployment, real-record mutations, and Federation shell activation.

Those capabilities must be integrated and separately validated before activation. Anonymous GitHub readback is one observability prerequisite, not permission to operate the production pipeline.
