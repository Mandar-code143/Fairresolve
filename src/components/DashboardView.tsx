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
    <div className="space-y-6">
      {/* Top Banner / Hero Summary */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-semibold tracking-wider uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              Merchant Dispute Operations
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-mono text-slate-500">
              PayPal Developer Sandbox Integration
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Dispute Resolution & Payment Gateway Cockpit
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl mt-1">
            FairResolve transforms unstructured customer complaints into evidence-aware, policy-grounded
            investigations, then allows authorized merchants to execute verified refunds through PayPal.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onNavigate('checkout')}
            className="px-4 py-2.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/20"
          >
            <ShoppingBag className="w-4 h-4" />
            Simulate PayPal Checkout
          </button>
          <button
            onClick={() => onNavigate('cases')}
            className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-1.5"
          >
            Open Case Inbox
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Open Cases */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Total Active Cases</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {totalCases}
            </span>
            <span className="text-xs text-slate-400 font-mono">Disputes</span>
          </div>
        </div>

        {/* Ready for Review */}
        <div className="bg-white p-4 rounded-xl border border-blue-200 bg-blue-50/20 shadow-sm">
          <span className="text-xs font-semibold text-blue-700 block">Ready for Review</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-blue-700 font-mono tabular-nums">
              {readyForReview}
            </span>
            <span className="text-xs text-blue-600 font-mono">Needs Decision</span>
          </div>
        </div>

        {/* Awaiting Evidence */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Awaiting Info / Evidence</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-amber-700 font-mono tabular-nums">
              {awaitingEvidence}
            </span>
            <span className="text-xs text-amber-600 font-mono">Pending Docs</span>
          </div>
        </div>

        {/* Security Escalations */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Escalated / Security</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-red-700 font-mono tabular-nums">
              {escalated}
            </span>
            <span className="text-xs text-red-600 font-mono">Hash Collision</span>
          </div>
        </div>

        {/* Refunds Executed */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Refunds Executed</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">
              {refundedCases}
            </span>
            <span className="text-xs text-emerald-600 font-mono">PayPal Settled</span>
          </div>
        </div>

        {/* Total Refunded Gross */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Refunded Volume</span>
          <div className="flex items-baseline justify-between mt-1.5">
            <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              ${totalRefundedGross.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-mono">USD</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Recent Cases Table & Operational Safeguards Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Priority Case Queue */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Priority Investigation Queue</h2>
              <p className="text-xs text-slate-500">
                Customer disputes sorted by review readiness and policy evaluation
              </p>
            </div>
            <button
              onClick={() => onNavigate('cases')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
            >
              View all ({totalCases})
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-x-auto">
            {recentCases.map((c) => {
              const order = orders.find((o) => o.id === c.orderId);
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectCase(c.id)}
                  className="px-6 py-4 hover:bg-slate-50/80 cursor-pointer transition-colors flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {c.caseNumber}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-medium text-slate-600 truncate">
                        {c.customerName}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-mono text-slate-400">
                        Order {c.orderNumber}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-1 italic">
                      "{c.customerDescription}"
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                      <span className="capitalize font-medium">
                        Issue: {c.issueType.replace('_', ' ')}
                      </span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">
                        Amount: ${order ? order.grossAmount.toFixed(2) : '0.00'}
                      </span>
                      <span>·</span>
                      <span>{c.evidence.length} evidence attachment(s)</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <CaseStatusBadge status={c.status} />
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 1 Col: PayPal Gateway Status & Architecture Safeguards */}
        <div className="space-y-6">
          {/* PayPal Sandbox Status Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">PayPal Gateway Status</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                SANDBOX
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Gateway Mode:</span>
                <span className="font-mono font-medium text-slate-900">
                  {isSandboxConfigured ? 'Live PayPal Sandbox' : 'Sandbox Simulated'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Live Payments Guard:</span>
                <span className="font-mono text-emerald-700 font-semibold">
                  ENFORCED (Sandbox Only)
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Idempotency Protection:</span>
                <span className="font-mono text-blue-700 font-medium">PayPal-Request-Id</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-500">Verified Sandbox Orders:</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {orders.length}
                </span>
              </div>
            </div>

            <button
              onClick={() => onNavigate('paypal')}
              className="mt-4 w-full py-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg transition-colors text-center block"
            >
              Inspect PayPal Integration & Keys
            </button>
          </div>

          {/* Principle of FairResolve Box */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-5 text-white shadow-sm">
            <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 block mb-1">
              Core Operating Principle
            </span>
            <h4 className="text-sm font-bold text-white mb-2">
              Claims ≠ Facts · Observations ≠ Authorization
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              FairResolve explicitly delineates customer allegations, observable visual features,
              carrier status, and deterministic refund policies. AI never authorizes or executes
              payments autonomously.
            </p>
            <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-[11px] text-slate-400">
              <span>Deterministic Policy v2.1</span>
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
