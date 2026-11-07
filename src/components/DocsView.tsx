import React from 'react';
import {
  BookOpen,
  ShieldCheck,
  CreditCard,
  Scale,
  Lock,
  GitBranch,
  Terminal,
  Layers,
  FileCode,
} from 'lucide-react';

export const DocsView: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8 text-slate-800">
      {/* Title */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono font-semibold uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            System Architecture & Security
          </span>
          <span className="text-xs text-slate-400">·</span>
          <span className="text-xs font-mono text-slate-500">OWASP Threat Model</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          FairResolve Architecture & Security Dossier
        </h1>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          Operational blueprint of the evidence-aware dispute investigation engine, deterministic policy rules,
          and PayPal payment integration built for the PayPal AI Hackathon 2026.
        </p>
      </div>

      {/* Section 1: The Core Operating Principle */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-5 h-5 text-blue-600" />
          1. The Epistemic Boundary Principle
        </h2>
        <div className="p-4 bg-slate-900 text-white rounded-lg text-xs space-y-2">
          <p className="font-semibold text-blue-400">
            "A customer claim is not a verified fact. An AI observation is not proof. A recommendation is not authorization."
          </p>
          <p className="text-slate-300 leading-relaxed">
            FairResolve fundamentally distinguishes between six epistemic categories:
          </p>
          <div className="grid grid-cols-2 gap-2 pt-2 text-[11px] font-mono">
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-purple-300">
              [CUSTOMER REPORTED] Allegations & text
            </span>
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-blue-300">
              [PAYPAL VERIFIED] Captures & balances
            </span>
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-emerald-300">
              [EVIDENCE RECEIVED] Inspected image files
            </span>
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-amber-300">
              [AI OBSERVATION] Non-authoritative facts
            </span>
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
              [POLICY RULE] Deterministic engine
            </span>
            <span className="p-1.5 rounded bg-slate-800 border border-slate-700 text-teal-300">
              [HUMAN APPROVAL] Irrevocable payment
            </span>
          </div>
        </div>
      </div>

      {/* Section 2: Case State Machine */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4 text-xs">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-purple-600" />
          2. Validated Case State Machine
        </h2>
        <p className="text-slate-600 leading-relaxed">
          Cases follow deterministic transitions validated on the server. The frontend cannot inject
          arbitrary states.
        </p>

        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed text-slate-800">
{`NEW
  ↓
AWAITING_EVIDENCE
  ↓ (Evidence uploaded)
ANALYZING
  ↓ (Multimodal AI + Deterministic Policy Evaluation)
┌─────────────────────────┬─────────────────────────┐
↓                         ↓                         ↓
READY_FOR_REVIEW   NEEDS_MORE_INFO              ESCALATED (Hash collision)
  ↓                       ↓
APPROVED_PENDING_REFUND   REJECTED
  ↓ (Idempotent PayPal-Request-Id)
REFUND_SUBMITTED
  ↓
REFUNDED (or REFUND_FAILED)`}
        </div>
      </div>

      {/* Section 3: OWASP Threat Model & Security Controls */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4 text-xs">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          3. Security Safeguards & Threat Protections
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <Lock className="w-4 h-4 text-blue-600" />
              Upload Inspection & Quarantine
            </h3>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Accepts strictly JPEG, PNG, and WEBP. Validates file magic bytes (e.g. FF D8 FF). Computes
              cryptographic SHA-256 hashes to detect duplicate photos re-used across claims. Stores
              files in private isolated directories with random UUID names.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              PayPal Idempotency & Balance Guards
            </h3>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Every refund call requires a stable <span className="font-mono">PayPal-Request-Id</span>.
              Remaining refundable balance is calculated server-side from captured transaction records.
              Client-submitted amounts are hard-capped.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              Prompt Injection Defense
            </h3>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Customer text, filenames, and extracted image labels are isolated into quotation blocks and
              explicitly marked as untrusted allegations. The model has zero tool-calling access to payment
              gateways or database mutation APIs.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
              <Layers className="w-4 h-4 text-purple-600" />
              RBAC & Fresh Authorization
            </h3>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Five distinct operational roles (OWNER, ADMIN, REVIEWER, ANALYST, VIEWER). Refund approval
              is strictly forbidden for VIEWER and ANALYST roles. Every merchant action is logged to the
              immutable timeline.
            </p>
          </div>
        </div>
      </div>

      {/* Section 4: PayPal AI Hackathon Checklist */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-3 text-xs">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-sky-600" />
          4. Hackathon Rules & Submission Compliance
        </h2>
        <p className="text-slate-600 leading-relaxed">
          This prototype complies with the official PayPal AI Hackathon requirements:
        </p>
        <ul className="space-y-1.5 text-slate-700">
          <li className="flex items-center gap-2">
            <span className="text-emerald-600 font-bold">✓</span>
            <span>Real PayPal developer integration with Orders v2 and Payments v2 refund captures</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-emerald-600 font-bold">✓</span>
            <span>Meaningful AI integration using Google Gen AI SDK (@google/genai) for multimodal investigation</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-emerald-600 font-bold">✓</span>
            <span>Deterministic merchant policy engine preventing black-box payment decisions</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-emerald-600 font-bold">✓</span>
            <span>Demonstration checkout simulator (Stage B) providing end-to-end sandbox purchase & dispute verification</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
