import React from 'react';
import { CaseStatus, PolicyEvaluationResult } from '../types';
import { ShieldCheck, AlertTriangle, Eye, CheckCircle2, Clock, Ban, Lock } from 'lucide-react';

export type AuditSourceType =
  | 'CUSTOMER_REPORTED'
  | 'PAYPAL_VERIFIED'
  | 'MERCHANT_PROVIDED'
  | 'EVIDENCE_RECEIVED'
  | 'AI_OBSERVATION'
  | 'POLICY_RULE'
  | 'HUMAN_APPROVAL'
  | 'SIMULATION_MODE';

interface SourceBadgeProps {
  source: AuditSourceType;
  className?: string;
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({ source, className = '' }) => {
  switch (source) {
    case 'CUSTOMER_REPORTED':
      return (
        <span
          title="Unverified allegation submitted by customer"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/80 tracking-wide uppercase ${className}`}
        >
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          Customer Claim
        </span>
      );
    case 'PAYPAL_VERIFIED':
      return (
        <span
          title="Direct cryptographic confirmation from PayPal Sandbox API"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 tracking-wide uppercase ${className}`}
        >
          <ShieldCheck className="w-3 h-3 text-blue-600" />
          PayPal Verified
        </span>
      );
    case 'MERCHANT_PROVIDED':
      return (
        <span
          title="Authenticated merchant operator record"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/80 tracking-wide uppercase ${className}`}
        >
          <Lock className="w-3 h-3 text-indigo-600" />
          Merchant Record
        </span>
      );
    case 'EVIDENCE_RECEIVED':
      return (
        <span
          title="Photographic or document evidence processed with Sharp & SHA-256 fingerprint"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/80 tracking-wide uppercase ${className}`}
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          Evidence Fingerprinted
        </span>
      );
    case 'AI_OBSERVATION':
      return (
        <span
          title="Visual or language model observation. Non-binding and advisory."
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 tracking-wide uppercase ${className}`}
        >
          <Eye className="w-3 h-3 text-purple-600" />
          AI Observation
        </span>
      );
    case 'POLICY_RULE':
      return (
        <span
          title="Evaluated by deterministic rule engine"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 tracking-wide uppercase ${className}`}
        >
          Policy Rule
        </span>
      );
    case 'HUMAN_APPROVAL':
      return (
        <span
          title="Explicit human review and authorization"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 tracking-wide uppercase ${className}`}
        >
          Merchant Authorized
        </span>
      );
    case 'SIMULATION_MODE':
      return (
        <span
          title="Demonstration simulation mode when live credentials are unconfigured"
          className={`inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-yellow-50 text-yellow-800 border border-yellow-200 tracking-wide uppercase ${className}`}
        >
          Demo Simulation
        </span>
      );
    default:
      return null;
  }
};

export const CaseStatusBadge: React.FC<{ status: CaseStatus }> = ({ status }) => {
  switch (status) {
    case 'READY_FOR_REVIEW':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          Ready for Review
        </span>
      );
    case 'REFUNDED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          Fully Refunded
        </span>
      );
    case 'PARTIALLY_REFUNDED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
          Partially Refunded
        </span>
      );
    case 'REFUND_PENDING':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3 h-3 mr-1 animate-pulse" />
          Refund Pending Clearance
        </span>
      );
    case 'NEEDS_MORE_INFORMATION':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          Needs More Info
        </span>
      );
    case 'ESCALATED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          Escalated / Security
        </span>
      );
    case 'APPROVED_PENDING_REFUND':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
          Approved (Pending Refund)
        </span>
      );
    case 'REFUND_SUBMITTED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
          Refund Submitted
        </span>
      );
    case 'REFUND_FAILED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          Refund Failed
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
          Rejected
        </span>
      );
    case 'NEW':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          New
        </span>
      );
    case 'ANALYZING':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
          Analyzing...
        </span>
      );
    case 'CLOSED':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
          Closed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
          {status}
        </span>
      );
  }
};

export const PolicyOutcomeBadge: React.FC<{ result: PolicyEvaluationResult['result'] }> = ({
  result,
}) => {
  switch (result) {
    case 'ELIGIBLE_FOR_MERCHANT_REVIEW':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
          <span className="font-mono text-emerald-700">[PASS]</span>
          Eligible for Merchant Review
        </div>
      );
    case 'MORE_INFORMATION_REQUIRED':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
          <span className="font-mono text-amber-700">[HOLD]</span>
          More Information Required
        </div>
      );
    case 'INELIGIBLE_UNDER_CONFIGURED_POLICY':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold">
          <span className="font-mono text-slate-600">[FAIL]</span>
          Ineligible Under Policy
        </div>
      );
    case 'MANUAL_REVIEW_REQUIRED':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-50 text-red-800 border border-red-200 text-xs font-semibold">
          <span className="font-mono text-red-700">[ALERT]</span>
          Manual Review Required
        </div>
      );
    default:
      return null;
  }
};
