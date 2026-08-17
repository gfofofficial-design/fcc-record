# FCC ID NAMESPACE REGISTRY
Frozen per architecture v0.1.2 §"D-6" / build-sequence step 1. Defined before build; not amendable except via the frozen Doctrine §P procedure.

| Namespace | Format | Scope | Notes |
|---|---|---|---|
| Instruments | `FCC-I-000001` | six-digit, zero-padded, sequential, never reused | Capital Instruments |
| Filings | `FCC-F-000001` | six-digit, zero-padded, sequential, never reused | Filing Log entries |
| Corrections | `FCC-C-000001` | six-digit, zero-padded, sequential, never reused | FCC corrections log |
| Proposals | `FCC-P-000001` | six-digit, zero-padded, sequential, never reused | Public proposal queue |
| Events / annexes / challenges / receipts | ULID | 26-char Crockford base32, monotonic, collision-resistant | Concurrent-object identifiers |
| Wallet identity | `wallet:{pubkey}` | raw public key, hex or base58 per chain convention | Signature-based |
| Account identity | `acct:{ulid}` | ULID | WebAuthn/passkey registrations |
| Standing Adversary Procedure | `sap-v#` | integer version | Versioned, prospective amendment only |
| Intake keys | `key-v#` | integer version | Versioned, rotation-capable |
| Test/fixture namespace | `FCC-TEST-*` | any suffix | CI-quarantined; never enters `record/` |

Counters are six digits (`000001`…`999999`), zero-padded, monotonic, never reused even on deletion or correction of the referenced object.
