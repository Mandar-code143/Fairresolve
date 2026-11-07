# FairResolve Security Policy & Institutional Hardening Standards

## 1. Security Architecture Overview

FairResolve is built on the principle of least privilege, defense-in-depth, and strict epistemic boundary enforcement. Because FairResolve bridges unstructured customer claims with financial payment gateways (PayPal Sandbox Orders v2 & Payments v2), multiple defensive perimeters are strictly enforced.

---

## 2. Cryptographic Security Standards

### Password Storage & Key Derivation
- **Algorithm**: `crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })`.
- **Salt**: 32 bytes of cryptographically secure pseudo-random entropy generated via `crypto.randomBytes(32)` per user account.
- **Verification**: Timing-safe memory comparison using `crypto.timingSafeEqual` prevents side-channel timing attacks.
- **Complexity Enforced**: Minimum 10 characters, requiring uppercase, lowercase, and numeric digits.

### Session Security & Cookie Hardening
- **Token Entropy**: 32-byte (256-bit) cryptographically random hex tokens.
- **Database Storage**: Tokens are hashed with SHA-256 before database insertion; plaintext tokens are never stored at rest.
- **Cookie Flags**:
  - `HttpOnly`: Prevents client-side JavaScript access / XSS token exfiltration.
  - `Secure`: Transmitted strictly over HTTPS in production.
  - `SameSite=Lax` / `Strict`: Prevents Cross-Site Request Forgery (CSRF).
  - Explicit 7-day expiration with server-side revocation on sign-out.

### Tamper-Evident SHA-256 Audit Hash Chaining
- Every dispute lifecycle event is linked into an immutable hash chain:
  `currentHash = SHA256(previousHash | caseId | eventType | timestamp | JSON(details))`
- Any post-hoc modification to an event payload or sequence order immediately invalidates the cryptographic chain and triggers an alert.

---

## 3. Financial Safety & PayPal Gateway Guardrails

1. **Hardcoded Live Environment Block**:
   ```typescript
   if (process.env.PAYPAL_ENVIRONMENT === 'production' || process.env.PAYPAL_LIVE_ENABLED === 'true') {
     throw new Error('SECURITY HALT: FairResolve prototype must run strictly in sandbox environment.');
   }
   ```
   Production credentials and live charges are blocked at the engine constructor level.
2. **Strict Idempotency via `PayPal-Request-Id`**:
   Every refund disbursement requires a stable cryptographic `PayPal-Request-Id` to prevent double-spending or replay attacks during network retries.
3. **Integer Minor-Unit (Cents) Financial Math**:
   All financial fields (`grossAmount`, `refundedAmount`, `refundableAmount`) are converted to integer minor units (cents) via `toCents()` to eliminate IEEE 754 floating-point drift.
4. **Distinction of Pending from Succeeded Refunds**:
   PayPal refunds returned in `PENDING` status are never prematurely credited as `COMPLETED`. The case enters `REFUND_PENDING` until clearance is confirmed.

---

## 4. Evidence Processing & Pipeline Hardening

1. **Magic-Byte Inspection**: Reject file extensions that do not match real header bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `52 49 46 46`).
2. **Decompression Bomb Protection**: Maximum dimensions capped at 8000x8000 pixels and 30 Megapixels.
3. **EXIF & Metadata Stripping via Sharp**: Images are decoded and re-encoded into clean raster buffers, stripping geolocation GPS coordinates, camera serial numbers, and embedded payloads.
4. **Cryptographic SHA-256 Fingerprinting**: Detects cross-dispute duplicate image collisions and triggers fraud escalation holds.

---

## 5. AI Prompt Injection Defense & Epistemic Guardrails

1. **Adversarial Input Sanitization**: Customer descriptions, filenames, and captions are stripped of delimiter tokens (`<|im_start|>`, ````), and adversarial injection phrases are neutralized.
2. **Zero Execution Authority**: The AI model has no tools or permissions to authorize refunds, approve claims, or alter database balances.
3. **Strict Zod Output Validation**: All model outputs are validated against `AIInvestigationSchema` before consumption; malformed responses fall back safely to deterministic baselines.

---

## 6. Vulnerability Reporting

To report a suspected security vulnerability in FairResolve, please email the security maintainers or open a private security advisory on GitHub. We investigate all valid reports within 24 hours.
