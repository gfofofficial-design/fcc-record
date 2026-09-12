# FCC Stage 0 local workbench

The interface runs locally and has no production record-writing or publishing endpoint. It is not a deployed public FCC surface.

From the repository root in PowerShell:

```powershell
$env:PATH = 'C:\GFOF\.venvs\fcc-record\Scripts;' + $env:PATH
npm run test:app
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Python on PATH must have the pinned dependencies in `requirements.txt`; the Node dependencies are installed with `npm ci`.

`npm run verify:production` performs anonymous, read-only GitHub verification of the current committed record and the byte-exact manifest entries. Pass a full published commit with `npm run verify:production -- <full-sha>` when the current development commit is not public. It sends no credentials and cannot publish anything. Results are saved under `.fcc-local/production-readback.json` and displayed in System / telemetry with their checked commit and observation time. A match proves byte equality at that observation, not original publication time, source truth, Bitcoin anchoring, or execution readiness.

The real-record views read committed Git blobs. The fixture workspace is stored separately under ignored `.fcc-local/stage0/`; it retains signed test receipts and uses `FCC-TEST-*` identifiers. A–D fixtures are loaded explicitly and never replace existing work. The test signing key is local to that workspace and must never be used as a production intake key. No site routes expose it.

The build writes asset hashes and a committed-record projection to `.fcc-local/stage0-build/`. The local server serves the source assets and provides the isolated fixture API; the output is not a standalone production deployment package.

Supported local flows: record/document inspection; fixture creation; challenge receipt, validation and consolidation; explicit fixture adjudication; numeric criterion evaluation and separate outcome/process scoring; A–D acceptance cases; hash/chain/scoring verification; local corrections and telemetry.

Production prerequisites are intentionally inactive: live witnesses, OTS proof validation and anchoring, production receipt publication and queue workers, verified wallet/passkey identities, approved AI adversary integration, deployment and shell activation. Test anchors, identities, evidence and receipts do not establish those properties. Unsupported resolution procedures fail rather than being inferred.
