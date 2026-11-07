import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  CreditCard,
  ShoppingBag,
  ExternalLink,
  DollarSign,
} from 'lucide-react';
import { Case, Order } from '../types';
import { CaseStatusBadge, SourceBadge } from './Badges';

interface DashboardViewProps {
  cases: Case[];
  orders: Order[];
  onSelectCase: (caseId: string) => void;
  onNavigate: (tab: string) => void;
  isSandboxConfigured: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  cases,
  orders,
  onSelectCase,
  onNavigate,
  isSandboxConfigured,
}) => {
  // Compute KPI metrics
  const totalCases = cases.length;
  const readyForReview = cases.filter((c) => c.status === 'READY_FOR_REVIEW').length;
  const awaitingEvidence = cases.filter(
    (c) => c.status === 'AWAITING_EVIDENCE' || c.status === 'NEEDS_MORE_INFORMATION'
  ).length;
  const escalated = cases.filter((c) => c.status === 'ESCALATED').length;
  const refundedCases = cases.filter((c) => c.status === 'REFUNDED').length;

  const totalRefundedGross = cases.reduce((acc, c) => {
    const caseTotal = c.refundAttempts
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((sum, r) => sum + r.amount, 0);
    return acc + caseTotal;
  }, 0);

  // Recent 5 disputes
  const recentCases = [...cases]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Top Banner / Hero Cockpit Summary (Compact & Streamlined) */}
      <div className="bg-white rounded-xl px-5 py-3.5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono font-semibold tracking-wider uppercase text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
              Merchant Cockpit
            </span>
            <span className="text-slate-300 text-xs">·</span>
            <span className="text-[11px] font-mono text-slate-500">
              PayPal Developer Sandbox
            </span>
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
            Dispute Resolution & Payment Gateway Cockpit
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-normal">
            Evidence-aware investigations, deterministic policy checks, and merchant-authorized PayPal refunds.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate('checkout')}
            className="px-3.5 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Simulate Checkout</span>
          </button>
          <button
            onClick={() => onNavigate('cases')}
            className="px-3.5 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1.5"
          >
            <span>Case Inbox</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics Strip (Compact, High-Density, Zero-Wrap on all screens) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {/* Open Cases */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 block truncate">Total Active Cases</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">
              {totalCases}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold shrink-0">
              DISPUTES
            </span>
          </div>
        </div>

        {/* Ready for Review */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-blue-200 bg-blue-50/20 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-blue-700 block truncate">Ready for Review</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-blue-700 font-mono tabular-nums leading-none">
              {readyForReview}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold shrink-0">
              REVIEW
            </span>
          </div>
        </div>

        {/* Awaiting Evidence */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 block truncate">Awaiting Evidence</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-amber-700 font-mono tabular-nums leading-none">
              {awaitingEvidence}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold shrink-0">
              PENDING
            </span>
          </div>
        </div>

        {/* Security Escalations */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 block truncate">Escalated / Security</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-red-700 font-mono tabular-nums leading-none">
              {escalated}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-red-50 text-red-700 border border-red-200 font-semibold shrink-0">
              ALERT
            </span>
          </div>
        </div>

        {/* Refunds Executed */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 block truncate">Refunds Executed</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-emerald-700 font-mono tabular-nums leading-none">
              {refundedCases}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold shrink-0">
              SETTLED
            </span>
          </div>
        </div>

        {/* Total Refunded Gross */}
        <div className="bg-white px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500 block truncate">Refunded Volume</span>
          <div className="flex items-baseline justify-between mt-1 gap-1.5">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">
              ${totalRefundedGross.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold shrink-0">
              USD
            </span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Recent Cases Table & Operational Safeguards Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Cols: Priority Case Queue */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Priority Investigation Queue</h2>
              <p className="text-[11px] text-slate-500">
                Sorted by review readiness and deterministic policy evaluation
              </p>
            </div>
            <button
              onClick={() => onNavigate('cases')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1 shrink-0"
            >
              <span>View all ({totalCases})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {recentCases.map((c) => {
              const order = orders.find((o) => o.id === c.orderId);
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectCase(c.id)}
                  className="px-4 sm:px-5 py-2.5 hover:bg-slate-50/80 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {c.caseNumber}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-medium text-slate-700 truncate">
                        {c.customerName}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Order {c.orderNumber}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-1 italic">
                      "{c.customerDescription}"
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                      <span className="capitalize font-medium">
                        Issue: {c.issueType.replace('_', ' ')}
                      </span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">
                        Amount: ${order ? order.grossAmount.toFixed(2) : '0.00'}
                      </span>
                      <span>·</span>
                      <span>{c.evidence.length} file(s)</span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 shrink-0 pt-1.5 sm:pt-0 border-t sm:border-0 border-slate-100">
                    <CaseStatusBadge status={c.status} />
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 1 Col: PayPal Gateway Status & Architecture Safeguards */}
        <div className="space-y-4">
          {/* PayPal Sandbox Status Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase font-mono tracking-wider">
                  PayPal Gateway Status
                </h3>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                SANDBOX
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Gateway Mode:</span>
                <span className="font-mono font-medium text-slate-900 text-[11px]">
                  {isSandboxConfigured ? 'Live PayPal Sandbox' : 'Sandbox Simulated'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Live Payments Guard:</span>
                <span className="font-mono text-emerald-700 font-semibold text-[11px]">
                  ENFORCED (Sandbox Only)
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Idempotency Protection:</span>
                <span className="font-mono text-blue-700 font-medium text-[11px]">PayPal-Request-Id</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">Verified Sandbox Orders:</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {orders.length}
                </span>
              </div>
            </div>

            <button
              onClick={() => onNavigate('paypal')}
              className="mt-3 w-full py-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition-colors text-center block"
            >
              Inspect PayPal Integration & Keys
            </button>
          </div>

          {/* Principle of FairResolve Box */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 text-white shadow-sm">
            <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 block mb-1">
              Core Operating Principle
            </span>
            <h4 className="text-xs font-bold text-white mb-1.5">
              Claims ≠ Facts · Observations ≠ Authorization
            </h4>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Customer allegations, observable damage features, and deterministic store policies are strictly separated. AI never authorizes or executes payments autonomously.
            </p>
            <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
              <span>Policy v2.1</span>
              <button
                onClick={() => onNavigate('docs')}
                className="text-blue-400 hover:text-blue-300 font-medium"
              >
                Read Threat Model →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
