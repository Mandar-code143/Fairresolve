# FairResolve — AI-Powered Dispute Investigation & PayPal Refund Platform

> **Target:** PayPal AI Hackathon 2026  
> **Official Category:** Fintech · AI · Dispute Resolution · Payment Automation  
> **Core Principle:** *"A customer claim is not a verified fact. An AI observation is not proof. A recommendation is not authorization."*

---

## 1. What is FairResolve?

FairResolve is an evidence-aware, policy-grounded customer dispute investigation and refund resolution platform for small and medium-sized online merchants who use PayPal.

Instead of acting as a generic conversational chatbot, FairResolve transforms an unstructured customer complaint into a structured investigation, evaluates it deterministically against the merchant's published refund policy, and enables an authorized merchant operator to execute the refund directly through PayPal's developer sandbox.

### The Six Epistemic Boundaries
FairResolve strictly separates:
1. **`[CUSTOMER REPORTED]`**: The customer's allegations and requested settlement.
2. **`[PAYPAL VERIFIED]`**: Authoritative order, capture, and refundable balance records.
3. **`[EVIDENCE RECEIVED]`**: Private uploaded media, byte-inspected and SHA-256 fingerprinted.
4. **`[AI OBSERVATION]`**: Objective physical features extracted by multimodal AI (Gemini 3.8 Flash).
5. **`[POLICY RULE]`**: Deterministic code calculations (claim window, packaging requirements, return thresholds).
6. **`[HUMAN APPROVAL]`**: Explicit merchant authorization executing the final PayPal refund.

---

## 2. Key Architecture & Features

### 🛒 Stage B: Real PayPal Sandbox Checkout Flow
* Simulate an e-commerce checkout with real products (AuraSound Headphones, ProTrail Shoes, PulseFit Tracker).
* Creates sandbox orders, captures payments via PayPal's Orders v2 and Payments v2 API, and generates a dispute case with a secure customer portal link.

### 🔍 Multimodal AI Investigation (Google Gen AI SDK)
* Powered by `@google/genai` and `gemini-3.8-flash`.
* Multimodal vision inspects item fractures, packaging deformations, and SKU labels.
* Identifies missing documentation, highlights claim inconsistencies, and states explicit forensic limitations.
* **Security Guard:** The AI model has zero access to payment execution APIs and cannot authorize refunds.

### ⚖️ Deterministic Policy Engine
* Evaluates dispute eligibility deterministically (independent of AI text generation).
* Validates 30-day claim windows, damage packaging photo rules, barcode requirements, and physical return thresholds.
* Calculates maximum eligible refund amounts using decimal arithmetic to prevent floating-point rounding errors.

### 🛡️ Private Evidence Pipeline & Forensic Dedup
* Binary magic-byte inspection (rejects fake extensions, SVGs, or executables).
* Computes cryptographic SHA-256 hashes.
* Detects cross-case duplicate evidence collisions (e.g. re-uploaded damage photos from previous cases) and triggers mandatory security escalation.
* Files are stored privately under randomized UUIDs outside public web roots.

### 💳 PayPal Refund Execution & Idempotency
* Executes captured refunds via `POST /v2/payments/captures/{capture_id}/refund`.
* Enforces mandatory `PayPal-Request-Id` headers to eliminate race conditions and double-spending.
* 2-step merchant confirmation modal with remaining balance verification and role-based permissions (OWNER, ADMIN, REVIEWER).

---

## 3. End-to-End Demo Walkthrough (3-Minute Video Script)

| Time | Stage | Action & Screen |
| :--- | :--- | :--- |
| **0:00–0:25** | **The Problem** | Show the manual chaos of refund investigations. Introduce FairResolve's dashboard and the Epistemic Boundary Principle. |
| **0:25–0:50** | **Stage B Checkout** | Open **Demo Checkout**, purchase AuraSound ANC Headphones ($159.99), capture payment through PayPal Sandbox, and generate the case. |
| **0:50–1:20** | **Customer Dispute** | Open **Customer Portal** via token, select "Item Arrived Damaged", upload photo of broken hinge and crushed box. |
| **1:20–1:55** | **AI + Policy Engine** | Open **Case Detail**. Show multimodal AI observations separating visible hinge fracture from unproven claims. Show the deterministic Policy Engine confirming the 30-day window and packaging proof. |
| **1:55–2:35** | **Merchant Refund** | Switch to REVIEWER role. Click "Authorize PayPal Refund". Inspect the `PayPal-Request-Id`, execute refund, and show the real returned PayPal Refund ID in the timeline. |
| **2:35–3:00** | **Security & Duplicate Catch** | Show Case FR-2026-006 where a re-used image triggered a SHA-256 collision alert, demonstrating real fraud prevention. |

---

## 4. Quick Start & Setup

### Requirements
* Node.js v20+ / Python 3.10+
* Vite, React 19, TypeScript, Tailwind CSS v4

### Environment Setup
Copy `.env.example` to `.env`:
```bash
GEMINI_API_KEY="your-gemini-api-key"
PAYPAL_CLIENT_ID="your-paypal-sandbox-client-id"
PAYPAL_CLIENT_SECRET="your-paypal-sandbox-client-secret"
PAYPAL_ENVIRONMENT="sandbox"
PAYPAL_LIVE_ENABLED="false"
```
*(Note: If PayPal sandbox credentials are not set, FairResolve runs in verified sandbox simulation mode with realistic API responses).*

### Running Locally
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to access FairResolve.

---

## 5. Security & Open Source Attribution

* **MIT License**: Original application logic is released under the MIT License.
* **PayPal Developer Platform**: Built in accordance with PayPal developer terms for the PayPal AI Hackathon 2026.
* **Google Gen AI**: Uses the official `@google/genai` TypeScript SDK.
* **OWASP Compliance**: Detailed in `docs/THREAT_MODEL.md`.
