import React, { useState } from 'react';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Lock,
  RefreshCw,
  ExternalLink,
  Activity,
  Layers,
  Webhook,
} from 'lucide-react';
import { PayPalGatewayStatus } from '../types';
import { apiFetch } from '../utils/api';

interface PayPalIntegrationViewProps {
  status: PayPalGatewayStatus;
  onRefresh: () => void;
}

export const PayPalIntegrationView: React.FC<PayPalIntegrationViewProps> = ({
  status,
  onRefresh,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    isConfigured: boolean;
  } | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const res = await apiFetch('/api/v1/paypal/verify', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      onRefresh();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed',
        isConfigured: false,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-semibold uppercase text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
              PayPal Developer Platform
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-mono text-slate-500">
              Sandbox Environment Enforced
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            PayPal Payment Gateway & Sandbox Controls
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            FairResolve interacts directly with PayPal's Orders v2 and Payments v2 endpoints.
            Production PayPal calls are strictly disabled by architectural guardrails.
          </p>
        </div>

        <button
          onClick={handleTestConnection}
          disabled={testing}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
          Test Sandbox Connectivity
        </button>
      </div>

      {/* Connectivity Test Feedback Banner */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
            testResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div>
            <h3 className="font-bold">
              {testResult.success
                ? 'PayPal Sandbox Authentication Verified'
                : 'Sandbox Diagnostic Notice'}
            </h3>
            <p className="mt-0.5 leading-relaxed">{testResult.message}</p>
          </div>
        </div>
      )}

      {/* 2-Column Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Credentials & Security Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Credential & Secret Safeguards</h2>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <span className="text-[10px] uppercase font-mono text-slate-500 block">
                Environment Configuration:
              </span>
              <span className="font-mono font-bold text-slate-900 block">
                PAYPAL_ENVIRONMENT = sandbox
              </span>
              <span className="font-mono text-emerald-700 font-semibold block text-[11px]">
                PAYPAL_LIVE_ENABLED = false (Hardcoded Guard)
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Client ID Status:</span>
              <span className="font-mono text-slate-800 font-medium">
                {status.clientIdMasked}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Client Secret Status:</span>
              <span className="font-mono text-slate-800 font-medium">
                [PROTECTED SERVER-SIDE]
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Idempotency Header:</span>
              <span className="font-mono text-blue-700 font-medium">
                PayPal-Request-Id (Required)
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Verification State:</span>
              <span
                className={`font-semibold font-mono ${
                  status.verificationStatus === 'SANDBOX_AUTHENTICATED'
                    ? 'text-emerald-700'
                    : status.verificationStatus === 'AUTHENTICATION_FAILED'
                    ? 'text-rose-700'
                    : status.verificationStatus === 'CREDENTIALS_PRESENT_UNVERIFIED'
                    ? 'text-amber-700'
                    : 'text-blue-700'
                }`}
              >
                {status.verificationStatus}
              </span>
            </div>

            {status.lastVerifiedAt && (
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Last Verified OAuth:</span>
                <span className="font-mono text-slate-700">
                  {new Date(status.lastVerifiedAt).toLocaleString()}
                </span>
              </div>
            )}

            {status.lastError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px] font-mono">
                {status.lastError}
              </div>
            )}

            <div className="flex items-center justify-between py-1.5">
              <span className="text-slate-500">Connection Mode:</span>
              <span
                className={`font-semibold font-mono ${
                  status.verificationStatus === 'SANDBOX_AUTHENTICATED'
                    ? 'text-emerald-700'
                    : status.verificationStatus === 'AUTHENTICATION_FAILED'
                    ? 'text-rose-700'
                    : status.isConfigured
                    ? 'text-amber-700'
                    : 'text-blue-700'
                }`}
              >
                {status.verificationStatus === 'SANDBOX_AUTHENTICATED'
                  ? 'SANDBOX OAUTH VERIFIED'
                  : status.verificationStatus === 'CREDENTIALS_PRESENT_UNVERIFIED'
                  ? 'CREDENTIALS SET (UNVERIFIED)'
                  : status.verificationStatus === 'AUTHENTICATION_FAILED'
                  ? 'SANDBOX AUTH FAILED'
                  : 'EXPLICIT SIMULATION MODE'}
              </span>
            </div>
          </div>
        </div>

        {/* Real-time Telemetry Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">FairResolve Ledger & Gateway Telemetry</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] uppercase font-mono text-slate-500 block">
                Local Ledger Orders
              </span>
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {status.activeOrderCount}
              </span>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] uppercase font-mono text-slate-500 block">
                Live Sandbox / Simulated
              </span>
              <span className="text-xl font-bold font-mono text-emerald-700 tabular-nums">
                {status.genuineRefundCount} / {status.simulatedRefundCount}
              </span>
            </div>
            <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
              <span className="text-[10px] uppercase font-mono text-emerald-700 block">
                Verified Sandbox Refunds
              </span>
              <span className="text-base font-bold font-mono text-emerald-900 tabular-nums">
                ${(status.genuineRefundedGross ?? 0).toFixed(2)} USD
              </span>
            </div>
            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
              <span className="text-[10px] uppercase font-mono text-amber-700 block">
                Simulated Refund Total
              </span>
              <span className="text-base font-bold font-mono text-amber-900 tabular-nums">
                ${(status.simulatedRefundedGross ?? 0).toFixed(2)} USD
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed pt-2">
            Every refund operation records an idempotent ledger reservation before calling PayPal.
            Live Sandbox refunds and simulated demo refunds are accounted separately above.
          </p>
        </div>
      </div>

      {/* Webhook Architecture Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <Webhook className="w-4 h-4 text-purple-600" />
          <h2 className="text-sm font-bold text-slate-900">Webhook Handling Architecture</h2>
        </div>
        <p className="text-slate-600 leading-relaxed">
          FairResolve listens for PayPal Sandbox Webhook events (`PAYMENT.CAPTURE.REFUNDED`, `CHECKOUT.ORDER.COMPLETED`).
          Webhooks undergo cryptographic signature verification against PayPal's verification endpoint, event ID
          deduplication, and transactional outbox persistence to prevent replay attacks.
        </p>
        <div className="flex items-center gap-3 pt-2 text-[11px] font-mono text-slate-500">
          <span>Endpoint: /api/v1/webhooks/paypal</span>
          <span>·</span>
          <span>Signature Verification: PAYPAL-AUTH-ALGO</span>
        </div>
      </div>
    </div>
  );
};
