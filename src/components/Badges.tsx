import React from 'react';
import { CaseStatus, PolicyEvaluationResult } from '../types';

export type AuditSourceType =
  | 'CUSTOMER_REPORTED'
  | 'PAYPAL_VERIFIED'
  | 'MERCHANT_PROVIDED'
  | 'EVIDENCE_RECEIVED'
  | 'AI_OBSERVATION'
  | 'POLICY_RULE'
  | 'HUMAN_APPROVAL';

interface SourceBadgeProps {
  source: AuditSourceType;
  className?: string;
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({ source, className = '' }) => {
  switch (source) {
    case 'CUSTOMER_REPORTED':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200/80 tracking-wide uppercase ${className}`}
        >
          Customer Reported
        </span>
      );
    case 'PAYPAL_VERIFIED':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/80 tracking-wide uppercase ${className}`}
        >
          PayPal Verified
        </span>
      );
    case 'MERCHANT_PROVIDED':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200/80 tracking-wide uppercase ${className}`}
        >
          Merchant Provided
        </span>
      );
    case 'EVIDENCE_RECEIVED':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/80 tracking-wide uppercase ${className}`}
        >
          Evidence Received
        </span>
      );
    case 'AI_OBSERVATION':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/80 tracking-wide uppercase ${className}`}
        >
          AI Observation
        </span>
      );
    case 'POLICY_RULE':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200/80 tracking-wide uppercase ${className}`}
        >
          Policy Rule
        </span>
      );
    case 'HUMAN_APPROVAL':
      return (
        <span
          className={`inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200/80 tracking-wide uppercase ${className}`}
        >
          Human Approval
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
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          Ready for Review
        </span>
      );
    case 'REFUNDED':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          Refunded
        </span>
      );
    case 'NEEDS_MORE_INFORMATION':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
          Needs More Info
        </span>
      );
    case 'ESCALATED':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
          Escalated / Security
        </span>
      );
    case 'APPROVED_PENDING_REFUND':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
          Approved (Pending Refund)
        </span>
      );
    case 'REFUND_SUBMITTED':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
          Refund Submitted
        </span>
      );
    case 'REFUND_FAILED':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          Refund Failed
        </span>
      );
    case 'REJECTED':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
          Rejected
        </span>
      );
    case 'NEW':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          New
        </span>
      );
    case 'ANALYZING':
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 animate-pulse">
          Analyzing...
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
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
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Eligible for Merchant Review
        </div>
      );
    case 'MORE_INFORMATION_REQUIRED':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          More Information Required
        </div>
      );
    case 'INELIGIBLE_UNDER_CONFIGURED_POLICY':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          Ineligible Under Policy
        </div>
      );
    case 'MANUAL_REVIEW_REQUIRED':
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-50 text-red-800 border border-red-200 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          Manual Review Required
        </div>
      );
    default:
      return null;
  }
};
