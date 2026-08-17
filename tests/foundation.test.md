# FCC BUILD 01 — CI FOUNDATION TEST LOG
Adversarial results, run 2026-08-17 in the build environment (single Linux runner; true cross-OS execution requires the GitHub Actions matrix defined in `.github/workflows/ci.yml`, exercised once the repo is pushed — see BUILD 01 report).

| Test | Attack | Expected | Result |
|---|---|---|---|
| Frozen-doc hash verification | Tamper 1 byte in a frozen governing doc | FAIL (mismatch) | **PASS** — caught, exit 1 |
| Append-only guard | Modify a frozen doc across a diff range | FAIL (violation) | **PASS** — caught, exit 1 |
| Append-only guard | Delete an existing `record/` file | FAIL (violation) | **PASS** — caught, exit 1 (after test-harness self-correction; see BUILD 01 report) |
| Append-only guard | Pure addition (no mutation) | PASS | **PASS** — exit 0 |
| Secret scan | Commit a real PEM private key | FAIL (leak) | **PASS** — caught, exit 1 |
| Secret scan | Clean tree (only the scanner script itself, containing pattern literals) | PASS (no false positive) | **PASS** — exit 0 (after excluding the scanner's own file; see BUILD 01 report) |
| ID uniqueness | Two files claiming the same `FCC-I-000001` | FAIL (duplicate) | **PASS** — see below |
| Byte preservation | `.gitattributes` `-text` on `record/**`, `governance/frozen/**`, `governance/keys/**`; `.ots binary` | Policy present, no silent CRLF transform | **PASS** |
| Test-namespace quarantine | `FCC-TEST-*` file placed under `record/` | Should be flagged/rejected by CI (not this foundation script alone — see note) | **DESIGNED, not exercised** — quarantine enforcement requires the full schema/lint pipeline (out of BUILD 01 scope); this build only guarantees `FCC-TEST-*` never appears in a genuine commit history because none was committed to `main` |
