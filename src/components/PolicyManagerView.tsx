import React, { useState } from 'react';
import {
  FileText,
  ShieldCheck,
  Plus,
  History,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Layers,
} from 'lucide-react';
import { RefundPolicy, User } from '../types';
import { apiFetch } from '../utils/api';

interface PolicyManagerViewProps {
  policy: RefundPolicy;
  allPolicies: RefundPolicy[];
  currentUser: User | null;
  onPolicyUpdated: (newPolicy: RefundPolicy) => void;
}

export const PolicyManagerView: React.FC<PolicyManagerViewProps> = ({
  policy,
  allPolicies,
  currentUser,
  onPolicyUpdated,
}) => {
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [returnWindowDays, setReturnWindowDays] = useState(policy.returnWindowDays.toString());
  const [requirePackagingPhoto, setRequirePackagingPhoto] = useState(
    policy.requirePackagingPhotoForDamage
  );
  const [requireLabelPhoto, setRequireLabelPhoto] = useState(
    policy.requireLabelPhotoForWrongItem
  );
  const [returnThreshold, setReturnThreshold] = useState(
    policy.mandatoryReturnThreshold.toString()
  );
  const [allowPartial, setAllowPartial] = useState(policy.allowPartialRefundsWithoutReturn);
  const [maxPartialPct, setMaxPartialPct] = useState(
    policy.maxPartialRefundPercentage.toString()
  );
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canPublish = currentUser && ['OWNER', 'ADMIN'].includes(currentUser.role);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPublish) return;

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/policies/publish', {
        method: 'POST',
        body: JSON.stringify({
          returnWindowDays,
          requirePackagingPhotoForDamage: requirePackagingPhoto,
          requireLabelPhotoForWrongItem: requireLabelPhoto,
          mandatoryReturnThreshold: returnThreshold,
          allowPartialRefundsWithoutReturn: allowPartial,
          maxPartialRefundPercentage: maxPartialPct,
          description,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onPolicyUpdated(data.policy);
        setShowPublishModal(false);
      } else {
        alert(data.error || 'Failed to publish policy');
      }
    } catch (err) {
      console.error('Publish error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-semibold uppercase text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Deterministic Policy Engine
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-mono text-slate-500">
              Immutable Versioned Configuration
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Merchant Refund & Dispute Policy
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Configure rules governing refund eligibility, return windows, photographic proof requirements,
            and manual review triggers. FairResolve evaluates disputes deterministically using these published rules.
          </p>
        </div>

        <button
          onClick={() => setShowPublishModal(true)}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-emerald-500/20 transition-colors flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Publish New Version
        </button>
      </div>

      {/* Active Version Rule Matrix */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Active Merchant Policy: {policy.version}
              </h2>
              <span className="text-[11px] text-slate-500 font-mono">
                Published on {new Date(policy.publishedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
            STATUS: ACTIVE
          </span>
        </div>

        <div className="p-6 divide-y divide-slate-100 text-xs">
          {/* Rule 1 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">Standard Refund Window</h3>
              <p className="text-slate-500 mt-0.5">
                Maximum allowable days between delivery/purchase date and dispute filing.
              </p>
            </div>
            <span className="font-mono font-bold text-sm text-slate-900 shrink-0">
              {policy.returnWindowDays} Calendar Days
            </span>
          </div>

          {/* Rule 2 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">
                Damage Claim Packaging Photo Requirement
              </h3>
              <p className="text-slate-500 mt-0.5">
                Requires customer to upload exterior parcel photograph to verify shipping trauma.
              </p>
            </div>
            <span
              className={`font-mono font-semibold text-xs px-2.5 py-1 rounded shrink-0 ${
                policy.requirePackagingPhotoForDamage
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {policy.requirePackagingPhotoForDamage ? 'MANDATORY' : 'OPTIONAL'}
            </span>
          </div>

          {/* Rule 3 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">
                Wrong Item Barcode/Label Requirement
              </h3>
              <p className="text-slate-500 mt-0.5">
                Requires customer to upload SKU barcode sticker to cross-check warehouse mis-picks.
              </p>
            </div>
            <span
              className={`font-mono font-semibold text-xs px-2.5 py-1 rounded shrink-0 ${
                policy.requireLabelPhotoForWrongItem
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {policy.requireLabelPhotoForWrongItem ? 'MANDATORY' : 'OPTIONAL'}
            </span>
          </div>

          {/* Rule 4 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">
                Mandatory Physical Return Threshold
              </h3>
              <p className="text-slate-500 mt-0.5">
                Orders with gross amount exceeding this value require merchandise return before refund.
              </p>
            </div>
            <span className="font-mono font-bold text-sm text-slate-900 shrink-0">
              ${policy.mandatoryReturnThreshold.toFixed(2)} USD
            </span>
          </div>

          {/* Rule 5 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">
                Partial Concession Limit Without Return
              </h3>
              <p className="text-slate-500 mt-0.5">
                Maximum percentage of order total permitted for voluntary cosmetic settlements.
              </p>
            </div>
            <span className="font-mono font-bold text-sm text-slate-900 shrink-0">
              Up to {policy.maxPartialRefundPercentage}%
            </span>
          </div>

          {/* Rule 6 */}
          <div className="py-3.5 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 text-xs">
                Cryptographic Evidence Deduplication
              </h3>
              <p className="text-slate-500 mt-0.5">
                Automatically scans SHA-256 image hashes and escalates re-used photos across cases.
              </p>
            </div>
            <span className="font-mono font-semibold text-xs px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
              ENABLED (Zero Tolerance)
            </span>
          </div>
        </div>
      </div>

      {/* Historical Versions List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          Policy Version History
        </h3>
        <p className="text-xs text-slate-500">
          Historical disputes retain immutable binding to the specific policy version active at evaluation time.
        </p>

        <div className="space-y-2">
          {allPolicies.map((p, idx) => (
            <div
              key={p.version}
              className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-slate-900">{p.version}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600 truncate">{p.description}</span>
              </div>
              <span className="text-slate-400 font-mono text-[11px] shrink-0">
                {new Date(p.publishedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Publish Modal */}
      {showPublishModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold">Publish New Immutable Policy Version</h3>
              <button
                onClick={() => setShowPublishModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublish} className="p-5 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
              {!canPublish && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
                  Permission Denied: Publishing policies requires OWNER or ADMIN role. Switch role in top bar.
                </div>
              )}

              <div>
                <label className="text-slate-700 font-semibold block mb-1">
                  Return Window (Calendar Days)
                </label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={returnWindowDays}
                  onChange={(e) => setReturnWindowDays(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">
                  Mandatory Return Threshold ($ USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={returnThreshold}
                  onChange={(e) => setReturnThreshold(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">
                  Max Partial Refund Percentage (%)
                </label>
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={maxPartialPct}
                  onChange={(e) => setMaxPartialPct(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requirePackagingPhoto}
                    onChange={(e) => setRequirePackagingPhoto(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-slate-700">
                    Require outer shipping packaging photograph for transit damage claims
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireLabelPhoto}
                    onChange={(e) => setRequireLabelPhoto(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-slate-700">
                    Require SKU barcode label photograph for wrong item claims
                  </span>
                </label>
              </div>

              <div>
                <label className="text-slate-700 font-semibold block mb-1">
                  Revision Reason / Release Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Updated holiday return window to 30 days..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !canPublish}
                  className={`px-5 py-2.5 rounded-lg text-white font-semibold ${
                    canPublish && !submitting
                      ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm'
                      : 'bg-slate-400 cursor-not-allowed'
                  }`}
                >
                  {submitting ? 'Publishing Version...' : 'Publish Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
