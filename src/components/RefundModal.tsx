import React, { useState } from 'react';
import { X, AlertTriangle, ShieldCheck, CreditCard, Lock, Loader2 } from 'lucide-react';
import { Case, Order, User } from '../types';
import { apiFetch } from '../utils/api';

interface RefundModalProps {
  caseData: Case;
  order: Order;
  currentUser: User | null;
  onClose: () => void;
  onSuccess: (updatedCase: Case, updatedOrder: Order) => void;
}

export const RefundModal: React.FC<RefundModalProps> = ({
  caseData,
  order,
  currentUser,
  onClose,
  onSuccess,
}) => {
  const [refundAmount, setRefundAmount] = useState<string>(
    order.refundableAmount.toFixed(2)
  );
  const [reason, setReason] = useState<string>(
    `Refund approved by merchant for Case ${caseData.caseNumber} (${caseData.issueType.replace('_', ' ')})`
  );
  const [idempotencyKey] = useState<string>(
    `FR-PPR-${caseData.id}-${Date.now().toString(36)}`
  );
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const numericAmount = parseFloat(refundAmount) || 0;
  const isAmountValid = numericAmount > 0 && numericAmount <= order.refundableAmount;

  // Authorization check
  const isAuthorized =
    currentUser && ['OWNER', 'ADMIN', 'REVIEWER'].includes(currentUser.role);

  const handleExecuteRefund = async () => {
    if (!isAmountValid || !confirmed || !isAuthorized) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await apiFetch(`/api/v1/cases/${caseData.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amount: numericAmount,
          reason,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Refund execution failed');
      }

      onSuccess(data.case, data.order);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Payment execution error');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-blue-600/30 text-blue-400 border border-blue-500/40">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Authorize PayPal Sandbox Refund</h3>
              <p className="text-xs text-slate-400 font-mono">
                Case {caseData.caseNumber} · Capture {order.paypalCaptureId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* RBAC Warning if viewer */}
          {!isAuthorized && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-900">
                  Insufficient Authorization
                </h4>
                <p className="text-xs text-amber-800 mt-1">
                  Your current role is <span className="font-mono font-bold">{currentUser?.role}</span>.
                  Executing refunds requires <span className="font-semibold">OWNER, ADMIN, or REVIEWER</span> privileges.
                  Switch account persona from the top navigation to test authorization.
                </p>
              </div>
            </div>
          )}

          {/* Financial Balances Card */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 grid grid-cols-3 gap-3 text-center">
            <div>
              <span className="text-[11px] text-slate-500 block uppercase font-mono">
                Gross Order
              </span>
              <span className="text-base font-bold text-slate-900 font-mono">
                ${order.grossAmount.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block uppercase font-mono">
                Already Refunded
              </span>
              <span className="text-base font-bold text-slate-500 font-mono">
                ${order.refundedAmount.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-blue-600 block uppercase font-mono font-semibold">
                Refundable Balance
              </span>
              <span className="text-base font-bold text-blue-700 font-mono">
                ${order.refundableAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Amount Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Refund Amount ({order.currency})
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRefundAmount(order.refundableAmount.toFixed(2))}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  Full (${order.refundableAmount.toFixed(2)})
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => setRefundAmount((order.refundableAmount * 0.5).toFixed(2))}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  50% (${(order.refundableAmount * 0.5).toFixed(2)})
                </button>
              </div>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={order.refundableAmount}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg text-base font-mono font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {!isAmountValid && (
              <p className="text-xs text-red-600 mt-1">
                Amount must be between $0.01 and remaining refundable balance $
                {order.refundableAmount.toFixed(2)}
              </p>
            )}
          </div>

          {/* Reason Note */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Note to Customer / PayPal Transaction Memo
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Idempotency Key Info */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5 font-mono">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              PayPal-Request-Id:
            </span>
            <span className="font-mono text-slate-700 text-[11px] select-all">
              {idempotencyKey}
            </span>
          </div>

          {/* Explicit Confirmation Checkbox */}
          <div className="flex items-start gap-2.5 pt-2">
            <input
              type="checkbox"
              id="confirm-refund"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="confirm-refund" className="text-xs text-slate-600 select-none cursor-pointer">
              I certify as an authorized merchant operator that this refund has been evaluated against
              store policy and approve the irrevocable transfer of funds through PayPal Sandbox.
            </label>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteRefund}
            disabled={!confirmed || !isAmountValid || !isAuthorized || loading}
            className={`px-5 py-2.5 text-xs font-semibold rounded-lg text-white flex items-center gap-2 transition-colors ${
              !confirmed || !isAmountValid || !isAuthorized || loading
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/20'
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Executing via PayPal Sandbox...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Authorize & Refund ${numericAmount.toFixed(2)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
