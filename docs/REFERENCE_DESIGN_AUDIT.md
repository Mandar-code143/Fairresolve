# FairResolve — Reference Design Audit & UX Standards

## 1. Executive Summary

FairResolve is an enterprise fintech SaaS platform built to investigate merchant dispute claims and safely execute merchant-authorized PayPal refunds. 

Unlike generic consumer dashboards or AI chat interfaces, FairResolve is an operational dispute resolution platform. Every user interface element must convey financial clarity, unambiguous status provenance, and strict epistemic separation:

1. **Customer Allegation ≠ Verified Fact**
2. **Uploaded Image ≠ Conclusive Timing or Origin of Damage**
3. **AI Observation ≠ Automated Payment Authorization**
4. **Policy Eligibility ≠ Merchant Financial Authorization**
5. **Refund Request ≠ Executed PayPal Settlement**
6. **Sandbox Simulation ≠ Live Currency Movement**

---

## 2. Benchmark Architecture: PayPal Business & Enterprise Fintech

Our reference UI benchmark is modeled on the PayPal Developer Dashboard, PayPal Resolution Center, and modern enterprise fintech platforms (Stripe Radar, Adyen Dispute Manager, Mercury Financial).

### Key Architectural Characteristics
- **Deep Navy Header (`#003087`, `#0F172A`)**: Communicates security, stability, and institutional trust.
- **Vibrant Action Accent (`#0070BA`, `#00457C`)**: PayPal Signature Blue for interactive elements, primary buttons, and navigational focus.
- **Cool Neutral Canvas (`#F8FAFC`, `#F1F5F9`)**: Clean, low-fatigue workspace allowing dense tables and evidence matrices to stand out.
- **High-Contrast Data Typography**: Clear tabular numbers, uppercase monospace identifiers (`case-101`, `CAP-782910`, `FR-2026-001`), and distinct status tags.
- **Epistemic Badging Hierarchy**: Distinct semantic colorways for evidence provenance, AI observations, policy compliance, and payment settlement.

---

## 3. Epistemic Tagging Standards

Every data point shown on screen must be explicitly categorized so that merchants are never misled:

| Tag Label | Background | Text Color | Border | Meaning / Source |
|---|---|---|---|---|
| `CUSTOMER REPORTED` | `#FEF3C7` (amber-100) | `#92400E` (amber-800) | `#FDE68A` | Unverified allegation submitted by buyer |
| `PAYPAL VERIFIED` | `#EFF6FF` (blue-50) | `#1D4ED8` (blue-700) | `#BFDBFE` | Authentic cryptographic order/capture from PayPal Sandbox API |
| `AI OBSERVATION` | `#FAF5FF` (purple-50) | `#7E22CE` (purple-700) | `#E9D5FF` | Vision or language model observation; purely advisory |
| `POLICY ELIGIBLE` | `#ECFDF5` (emerald-50) | `#047857` (emerald-700) | `#A7F3D0` | Deterministic policy engine criteria passed |
| `MERCHANT ACTION` | `#F1F5F9` (slate-100) | `#334155` (slate-700) | `#CBD5E1` | Explicit human operator review or authorization |
| `SIMULATION MODE` | `#FFFBEB` (yellow-50) | `#B45309` (yellow-700) | `#FCD34D` | Labeled demonstration simulation when credentials unset |

---

## 4. Breakpoint & Responsive Target Verification

The entire platform is responsive and rigorously styled for the following viewports:

1. **Large Desktop (1920 × 1080)**: Full 3-column split view (Case Metadata + Evidence Inspection + Decision Matrix).
2. **Standard Laptop (1366 × 768 / 1280 × 720)**: Dense 2-column view with collapsible evidence tray and high vertical efficiency.
3. **Tablet (768 × 1024 / 1024 × 768)**: Stacked investigation view with quick tab navigation and touch-friendly controls.
4. **Mobile (390 × 844 iPhone 14 / 360 × 800 Android)**: Single-column dispute card view, bottom-sheet review modal, and responsive complaint submission portal.
