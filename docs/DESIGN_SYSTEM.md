# FairResolve — Design System Specification

## 1. Palette & Design Tokens

### Primary Brand (PayPal Enterprise Standards)
- **PayPal Navy 900**: `#001C6A` (Darkest brand navy)
- **PayPal Navy 800**: `#003087` (Brand primary navy)
- **PayPal Blue 600**: `#0070BA` (Interactive primary blue)
- **PayPal Blue 500**: `#009CDE` (Accent & focus blue)
- **Slate 950**: `#0B0F17` (Deep neutral background)
- **Slate 900**: `#0F172A` (Navigation & top header)
- **Slate 100**: `#F1F5F9` (Subtle card border & divider)
- **Slate 50**: `#F8FAFC` (Canvas background)

### Functional & Status Colors
- **Success / Settled**:
  - Light: `#ECFDF5` (emerald-50)
  - Base: `#059669` (emerald-600)
  - Text: `#065F46` (emerald-800)
- **Warning / Review Needed**:
  - Light: `#FFFBEB` (amber-50)
  - Base: `#D97706` (amber-600)
  - Text: `#92400E` (amber-800)
- **Danger / Failed / Ineligible**:
  - Light: `#FEF2F2` (rose-50)
  - Base: `#DC2626` (rose-600)
  - Text: `#991B1B` (rose-800)
- **Advisory / AI Insights**:
  - Light: `#FAF5FF` (purple-50)
  - Base: `#9333EA` (purple-600)
  - Text: `#6B21A8` (purple-800)

---

## 2. Typography

- **Primary Sans**: Inter, system-ui, -apple-system, sans-serif
- **Data & Identifiers Mono**: JetBrains Mono, SF Mono, Menlo, monospace
- **Scale**:
  - `text-[10px]` — Epistemic badges, timestamps, minor unit labels
  - `text-xs` (12px) — Table data, metadata captions, secondary tabs
  - `text-sm` (14px) — Body text, form labels, card summaries
  - `text-base` (16px) — Card titles, primary navigation
  - `text-lg` (18px) — Section headers
  - `text-2xl` (24px) — Dashboard KPI metrics, primary case numbers

---

## 3. UI Component Specifications

### Epistemic Badge Component
Badges must always display an icon, bold uppercase text, and an explicit tooltip clarifying the data origin:
- `[ICON] PAYPAL VERIFIED` (Blue)
- `[ICON] CUSTOMER CLAIM` (Amber)
- `[ICON] AI OBSERVATION` (Purple)
- `[ICON] POLICY ELIGIBLE` (Emerald)
- `[ICON] DEMO SIMULATED` (Yellow)

### Financial Metric Displays
- Always format currency with currency code: `$149.99 USD`.
- Always indicate gross amount, refunded amount, and refundable balance clearly.
- Calculations must be transparently displayed (e.g. `$149.99 gross - $50.00 refunded = $99.99 remaining`).

### Action Controls & RBAC Guards
- If a user's role lacks permission for an action (e.g. `VIEWER` attempting a refund or policy edit), the action button must be visibly disabled or hidden with a tooltip: `"Action requires REVIEWER or OWNER role. Current role: VIEWER"`.
- Refund execution must require explicit two-step confirmation with human notes and confirmation of amount.

---

## 4. Accessibility & Contrast

- Strict compliance with WCAG 2.2 AA.
- Minimum contrast ratio 4.5:1 for normal text and 3:1 for large text.
- Full keyboard accessibility for modal dialogs with Escape key listeners and focus trapping.
- ARIA live announcements for status updates, uploads, and refund notifications.
