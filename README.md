# FairResolve — Evidence-Aware AI Dispute Investigation & PayPal Refund Platform

> **Target:** Independent Fintech SaaS Platform · PayPal Developer Platform Sandbox  
> **Primary Integrations:** PayPal Developer Platform (Sandbox Orders v2 & Payments v2), Google Gemini 2.5/3.8 Flash (`@google/genai`)  
> **Core Principle:** *"A customer claim is not a verified fact. An uploaded image is not proof of the timing or cause of damage. An AI observation is not authorization. A refund request is not an executed settlement."*

---

## 1. Executive Overview

**FairResolve** transforms unstructured e-commerce customer complaints into structured, evidence-aware, policy-grounded investigations and helps online merchants make defensible resolution decisions before executing explicitly authorized refunds through PayPal.

FairResolve is an operational merchant dispute-resolution application with strict epistemic boundaries and institutional fintech safeguards.

### The Six Epistemic Boundaries
FairResolve strictly separates:
1. **`[CUSTOMER REPORTED]`**: The customer's allegations and requested settlement.
2. **`[PAYPAL VERIFIED]`**: Authoritative order, capture, and refundable balance records from PayPal Sandbox.
3. **`[EVIDENCE RECEIVED]`**: Private uploaded media, byte-inspected, EXIF-stripped, and SHA-256 fingerprinted.
4. **`[AI OBSERVATION]`**: Objective physical features extracted by multimodal AI (Gemini 2.5/3.8 Flash). Non-binding and advisory.
5. **`[POLICY RULE]`**: Deterministic code calculations (claim windows, packaging requirements, return thresholds).
6. **`[HUMAN APPROVAL]`**: Explicit merchant authorization executing the final PayPal refund.

---

## 2. Full-Stack Architecture & Security Hardening

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       FAIRRESOLVE FINTECH ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────────┘
         │
         ├── Frontend Client (React 19 + TypeScript + Vite 8 + Tailwind CSS 4)
         │   ├── Modern PayPal Business Design System (Palette #003087, #0070BA, #0F172A)
         │   ├── Epistemic Tagging System (Customer Claim vs. PayPal Verified vs. AI)
         │   ├── Responsive Viewports (1920x1080, 1366x768, 1280x720, 768x1024, 390x844)
         │   └── In-Memory Session State (Zero localStorage Token Vulnerabilities)
         │
         ├── Express 4 API Gateway & Security Perimeter
         │   ├── Helmet Security Headers & Cross-Origin Isolation
         │   ├── HttpOnly, Secure, SameSite=Lax/Strict Session Cookies
         │   ├── Express Rate Limiters (Auth, Refund, Upload, and Global tiers)
         │   └── Timing-Safe scrypt Password Verification (N=16384, r=8, p=1, 32-byte salt)
         │
         ├── Core Business Engines
         │   ├── PayPal Sandbox Gateway (Orders v2 Create/Capture, Payments v2 Refund)
         │   │   ├── Strict Idempotency via stable PayPal-Request-Id
         │   │   ├── Genuine 2-Stage Checkout (Order Creation -> Buyer Approval -> Capture)
         │   │   └── Webhook Signature Verification with Fail-Closed Cryptographic Checks
         │   │
         │   ├── AI Multimodal Investigation Engine (Google Gen AI SDK @google/genai)
         │   │   ├── Strict Zod Schema Validation on Model Outputs
         │   │   ├── Defensive Prompt Neutralization against Prompt Injections
         │   │   └── Honest Deterministic Fallback Baseline when Unconfigured
         │   │
         │   ├── Deterministic Policy Engine
         │   │   ├── Integer Minor-Unit (Cents) Arithmetic to eliminate float rounding errors
         │   │   ├── Business Day Calculation (M-F) for Carrier Transit Windows
         │   │   └── Immutable Policy Versioning & Reproducible Reason Codes
         │   │
         │   ├── Private Evidence Pipeline
         │   │   ├── Magic-Byte Signature Verification (JPEG, PNG, WEBP)
         │   │   ├── Sharp Re-encoding, EXIF Stripping, and Decompression Bomb Defense (8000x8000)
         │   │   └── SHA-256 Fingerprinting with Cross-Claim Collision Detection
         │   │
         │   └── Tamper-Evident SHA-256 Hash-Chained Audit Ledger
         │       ├── Block-chained previousHash -> currentHash linking every event
         │       └── On-demand and Automated Cryptographic Integrity Verification
         │
         └── Persistence & Worker Layer
             ├── Dual Database Architecture: Native PostgreSQL 16 Pool + ACID JSON WAL Engine
             └── Durable Transactional Outbox Background Worker with Lease Locks & Exponential Backoff
```

---

## 3. Enforced RBAC Privilege Matrix

FairResolve enforces strict role-based access control across all API endpoints:

| Capability | OWNER | ADMIN | REVIEWER | ANALYST | VIEWER |
|---|:---:|:---:|:---:|:---:|:---:|
| Authorize & Execute PayPal Refunds | **YES** | **YES** | **YES** | NO | NO |
| Publish & Edit Refund Policies | **YES** | **YES** | NO | NO | NO |
| Execute AI Multimodal Investigation | **YES** | **YES** | **YES** | **YES** | NO |
| Upload & Fingerprint Evidence | **YES** | **YES** | **YES** | **YES** | NO |
| Invite Team Members & Grant Roles | **YES** | **YES** | NO | NO | NO |
| View Cases & Audit Trails | **YES** | **YES** | **YES** | **YES** | **YES** |

---

## 4. Automated Test Suite

FairResolve includes a comprehensive Vitest automated test suite covering unit logic and security boundaries:

```bash
npm test
```

### Verified Test Suites (21/21 Passing):
1. **`tests/unit/auth.test.ts`**:
   - scrypt password hashing with 32-byte salt uniqueness.
   - Timing-safe password verification (`crypto.timingSafeEqual`).
   - Password strength complexity checks.
   - High-entropy session generation with SHA-256 token hashing.
   - Session revocation.
   - RBAC permission hierarchy validation.
2. **`tests/unit/policyEngine.test.ts`**:
   - Minor unit (cents) integer conversion and arithmetic precision.
   - Business day calculation excluding weekends.
   - Policy eligibility criteria evaluation (`R-WINDOW`, `R-DMG-EVID`).
   - Evidence deduplication collision detection (`R-DEDUP`).
   - Late claim rejection (`INELIGIBLE_UNDER_CONFIGURED_POLICY`).
   - Decimal-exact partial refund limits.
3. **`tests/unit/auditLedger.test.ts`**:
   - Sequential SHA-256 block hash chaining (`previousHash` -> `currentHash`).
   - Integrity verification passes on uncorrupted chains.
   - Post-hoc payload tampering detection and exact block index localization.
4. **`tests/integration/securityNegative.test.ts`**:
   - 401 Unauthorized on unauthenticated requests.
   - 401 Unauthorized on forged/invalid tokens.
   - 403 Forbidden on unauthorized VIEWER attempting refund.
   - 400 Bad Request on refund amounts exceeding refundable balance.
   - 403 Forbidden on expired customer dispute links.

---

## 5. Getting Started

### Prerequisites
- Node.js v20+ or v22+
- pnpm v9+ or npm v10+

### Environment Configuration
Copy `.env.example` to `.env`:
```bash
# Server Port
PORT=3000
NODE_ENV=development
DEMO_MODE=true

# PayPal Sandbox Credentials (get from developer.paypal.com)
PAYPAL_CLIENT_ID="your-paypal-sandbox-client-id"
PAYPAL_CLIENT_SECRET="your-paypal-sandbox-client-secret"
PAYPAL_ENVIRONMENT="sandbox"
PAYPAL_LIVE_ENABLED="false"
PAYPAL_WEBHOOK_ID="WH-SANDBOX-DEFAULT"

# Google Gemini API Key (get from ai.google.dev)
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL="gemini-2.5-flash"

# Optional: PostgreSQL Database URL
DATABASE_URL="postgres://fairresolve:fairresolve_secret@localhost:5432/fairresolve"
```
*(Note: If credentials are not set, FairResolve runs in verified Sandbox Simulation mode with labeled demo provenance).*

### Running Locally
```bash
# Install dependencies
pnpm install

# Run type check and tests
npm run lint
npm test

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the FairResolve platform.

---

## 6. Docker & Container Deployment

FairResolve includes a multi-stage production Dockerfile and Docker Compose environment with integrated PostgreSQL 16 and automated database migrations:

```bash
# Build and start all services (App + PostgreSQL)
docker compose up --build -d

# Check service health
docker compose ps
curl http://localhost:3000/health/ready
```

---

## 7. License & Attribution

- **License**: MIT License.
- **PayPal Developer Platform**: Built in compliance with PayPal developer security terms for the PayPal AI Hackathon 2026.
- **Google Gen AI**: Built with the official `@google/genai` SDK.
