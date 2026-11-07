import React, { useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  CreditCard,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Copy,
  Check,
  Clock,
  Sparkles,
  ExternalLink,
  Lock,
} from 'lucide-react';
import { Case, Order, RefundPolicy, User } from '../types';
import { CaseStatusBadge, PolicyOutcomeBadge, SourceBadge } from './Badges';
import { EvidenceModal } from './EvidenceModal';
import { RefundModal } from './RefundModal';
import { apiFetch } from '../utils/api';

interface CaseDetailViewProps {
  caseData: Case;
  order: Order;
  policy: RefundPolicy;
  currentUser: User | null;
  onBack: () => void;
  onUpdateCase: (updatedCase: Case, updatedOrder?: Order) => void;
  onNavigate: (tab: string) => void;
}

export const CaseDetailView: React.FC<CaseDetailViewProps> = ({
  caseData,
  order,
  policy,
  currentUser,
  onBack,
  onUpdateCase,
  onNavigate,
}) => {
  const [selectedEvidence, setSelectedEvidence] = useState<any | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCapture, setCopiedCapture] = useState(false);
  const [actionNotes, setActionNotes] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Check if current user is allowed to approve refunds
  const canApprove =
    currentUser && ['OWNER', 'ADMIN', 'REVIEWER'].includes(currentUser.role);

  // Re-run AI analysis
  const handleReanalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await apiFetch(`/api/v1/cases/${caseData.id}/re-analyze`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        onUpdateCase(data.case);
      }
    } catch (err) {
      console.error('Re-analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Merchant status decision
  const handleReviewAction = async (decision: 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'ESCALATE') => {
    try {
      const res = await apiFetch(`/api/v1/cases/${caseData.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, notes: actionNotes }),
      });
      const data = await res.json();
      if (res.ok) {
        onUpdateCase(data.case);
      } else {
        alert(data.error || 'Failed to update decision');
      }
    } catch (err) {
      console.error('Review error:', err);
    }
  };

  // Copy customer portal link
  const handleCopyCustomerLink = () => {
    const url = `${window.location.origin}/portal/${caseData.customerAccessToken}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Copy PayPal Capture ID
  const handleCopyCapture = () => {
    navigator.clipboard.writeText(order.paypalCaptureId);
    setCopiedCapture(true);
    setTimeout(() => setCopiedCapture(false), 2000);
  };

  // Upload additional evidence photo
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await apiFetch('/api/v1/evidence/upload', {
          method: 'POST',
          body: JSON.stringify({
            caseId: caseData.id,
            filename: file.name,
            fileBase64: base64,
            evidenceType: 'item_photo',
            caption: 'Supplemental photo uploaded by merchant investigator',
          }),
        });

        const data = await res.json();
        if (res.ok) {
          // Re-fetch updated case
          const caseRes = await apiFetch(`/api/v1/cases/${caseData.id}`);
          const caseDataRes = await caseRes.json();
          onUpdateCase(caseDataRes.case, caseDataRes.order);
        } else {
          alert(data.error || 'Upload failed');
        }
      } catch (err) {
        console.error('Upload error:', err);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Modals */}
      <EvidenceModal
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />

      {showRefundModal && (
        <RefundModal
          caseData={caseData}
          order={order}
          currentUser={currentUser}
          onClose={() => setShowRefundModal(false)}
          onSuccess={(updatedCase, updatedOrder) => {
            onUpdateCase(updatedCase, updatedOrder);
          }}
        />
      )}

      {/* Top Header Bar */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors shrink-0"
            title="Back to Case Inbox"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-slate-900 font-mono">
                {caseData.caseNumber}
              </h1>
              <CaseStatusBadge status={caseData.status} />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Customer: <span className="font-medium text-slate-800">{caseData.customerName}</span> (
              {caseData.customerEmail}) · Filed on{' '}
              {new Date(caseData.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleReanalyze}
            disabled={isAnalyzing}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
            Re-run AI & Policy
          </button>

          {caseData.status !== 'REFUNDED' && (
            <button
              onClick={() => setShowRefundModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm shadow-blue-500/20 transition-colors flex items-center gap-1.5"
            >
              <CreditCard className="w-4 h-4" />
              Authorize PayPal Refund
            </button>
          )}
        </div>
      </div>

      {/* 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ======================================================== */}
        {/* LEFT COLUMN: Customer Claim, PayPal Transaction & Evidence */}
        {/* ======================================================== */}
        <div className="lg:col-span-6 space-y-6">
          {/* Card 1: Customer Complaint */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-600" />
                <h3 className="text-sm font-bold text-slate-900">Customer Dispute Claim</h3>
              </div>
              <SourceBadge source="CUSTOMER_REPORTED" />
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <span className="text-slate-500 block uppercase font-mono text-[10px]">
                  Claimed Issue Category:
                </span>
                <span className="text-sm font-semibold text-slate-900 capitalize">
                  {caseData.issueType.replace('_', ' ')}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block uppercase font-mono text-[10px]">
                  Requested Resolution:
                </span>
                <span className="text-xs font-semibold text-slate-800 capitalize bg-slate-100 px-2 py-0.5 rounded">
                  {caseData.requestedResolution.replace('_', ' ')}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block uppercase font-mono text-[10px] mb-1">
                  Customer Verbatim Statement:
                </span>
                <div className="p-3 bg-purple-50/30 border border-purple-100 rounded-lg text-slate-800 leading-relaxed italic">
                  "{caseData.customerDescription}"
                </div>
              </div>

              {/* Secure Customer Portal Link */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Secure Access Token:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-600">
                    {caseData.customerAccessToken.slice(0, 12)}...
                  </span>
                  <button
                    onClick={handleCopyCustomerLink}
                    className="p-1 rounded hover:bg-slate-100 text-slate-500"
                    title="Copy Customer Dispute Portal Link"
                  >
                    {copiedLink ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onNavigate('portal')}
                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5"
                  >
                    Open Portal
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Verified PayPal Transaction */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Verified PayPal Transaction</h3>
              </div>
              <SourceBadge source="PAYPAL_VERIFIED" />
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Financial Summary */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">
                    Gross Order
                  </span>
                  <span className="text-sm font-bold text-slate-900 font-mono">
                    ${order.grossAmount.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">
                    Refunded
                  </span>
                  <span className="text-sm font-bold text-slate-500 font-mono">
                    ${order.refundedAmount.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-blue-600 uppercase font-mono font-semibold block">
                    Refundable
                  </span>
                  <span className="text-sm font-bold text-blue-700 font-mono">
                    ${order.refundableAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Identifiers */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Order Reference:</span>
                  <span className="font-mono font-semibold text-slate-900">{order.orderNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">PayPal Order ID:</span>
                  <span className="font-mono text-slate-700">{order.paypalOrderId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">PayPal Capture ID:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-slate-900 font-medium">
                      {order.paypalCaptureId}
                    </span>
                    <button
                      onClick={handleCopyCapture}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-600"
                      title="Copy Capture ID"
                    >
                      {copiedCapture ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Transaction Timestamp:</span>
                  <span className="font-mono text-slate-700">
                    {new Date(order.transactionDate).toLocaleString()}
                  </span>
                </div>
                {order.shippingCarrier && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Carrier Tracking:</span>
                    <span className="font-mono text-slate-700">
                      {order.shippingCarrier} · {order.trackingNumber}
                    </span>
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] uppercase font-mono text-slate-500 block mb-2">
                  Order Items Purchased:
                </span>
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 rounded bg-slate-50/70 border border-slate-200/60"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 text-xs">{item.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          SKU: {item.sku} · Qty: {item.quantity}
                        </div>
                      </div>
                      <span className="font-mono font-bold text-slate-900 text-xs">
                        ${item.totalPrice.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Evidence Gallery */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Evidence Gallery ({caseData.evidence.length})
                </h3>
              </div>
              <SourceBadge source="EVIDENCE_RECEIVED" />
            </div>

            <div className="p-5 space-y-4">
              {caseData.evidence.length === 0 ? (
                <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-lg text-slate-400 text-xs">
                  <FileText className="w-6 h-6 mx-auto mb-1 text-slate-300" />
                  No evidence uploaded yet. Customer dispute submitted without media attachments.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {caseData.evidence.map((ev) => (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEvidence(ev)}
                      className={`group border rounded-lg p-2.5 cursor-pointer transition-all hover:shadow-md ${
                        ev.isDuplicate
                          ? 'border-red-300 bg-red-50/30'
                          : 'border-slate-200 bg-slate-50/50 hover:border-blue-300'
                      }`}
                    >
                      {/* Image Thumbnail */}
                      <div className="h-28 bg-slate-900 rounded flex items-center justify-center overflow-hidden mb-2">
                        {ev.thumbnailBase64 ? (
                          <img
                            src={ev.thumbnailBase64}
                            alt={ev.originalFilename}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {ev.mimeType}
                          </span>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="text-xs">
                        <div className="font-semibold text-slate-900 truncate">
                          {ev.originalFilename}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between mt-0.5">
                          <span>{(ev.byteSize / 1024).toFixed(1)} KB</span>
                          <span className="uppercase">{ev.evidenceType.replace('_', ' ')}</span>
                        </div>

                        {ev.isDuplicate && (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-red-600">
                            <ShieldAlert className="w-3 h-3" />
                            Duplicate Hash Alert!
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload Additional Evidence */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  Simulate receiving customer/merchant photos:
                </span>
                <label className="cursor-pointer px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  {isUploading ? 'Inspecting...' : 'Upload Evidence'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* RIGHT COLUMN: AI Observations, Deterministic Policy, Decision */}
        {/* ======================================================== */}
        <div className="lg:col-span-6 space-y-6">
          {/* Card 4: AI Multimodal Observation */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Multimodal AI Investigation Findings
                </h3>
              </div>
              <SourceBadge source="AI_OBSERVATION" />
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Mandatory AI Transparency Disclaimer (Part 11) */}
              <div className="p-3 bg-amber-50/80 border border-amber-200/90 rounded-lg flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-900 leading-relaxed font-medium">
                  AI-assisted observations support the investigation. They do not independently
                  verify the truth of a customer claim or authorize a payment.
                </p>
              </div>

              {caseData.aiInvestigation ? (
                <>
                  {/* Observable Physical Features */}
                  <div>
                    <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider font-mono mb-1.5">
                      Visual Evidence Observations:
                    </h4>
                    {caseData.aiInvestigation.evidence_observations.length === 0 ? (
                      <p className="text-slate-500 italic">No visual observations recorded.</p>
                    ) : (
                      <ul className="space-y-1">
                        {caseData.aiInvestigation.evidence_observations.map((obs, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-slate-700">
                            <span className="text-blue-500 font-bold">·</span>
                            <span>{obs}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Missing Information */}
                  {caseData.aiInvestigation.missing_information.length > 0 && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <h4 className="font-semibold text-slate-800 text-xs font-mono uppercase mb-1">
                        Missing Information For Resolution:
                      </h4>
                      <ul className="space-y-1">
                        {caseData.aiInvestigation.missing_information.map((m, idx) => (
                          <li key={idx} className="text-slate-600 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Forensic Limitations */}
                  <div>
                    <h4 className="font-semibold text-slate-700 text-xs uppercase font-mono mb-1">
                      Epistemic Limitations (What AI Cannot Prove):
                    </h4>
                    <ul className="space-y-1">
                      {caseData.aiInvestigation.limitations.map((lim, idx) => (
                        <li key={idx} className="text-slate-500 italic text-[11px]">
                          — {lim}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* AI Explanation & Recommendation */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Engine: {caseData.aiInvestigation.model_used}</span>
                    <span>
                      Analyzed:{' '}
                      {new Date(caseData.aiInvestigation.analyzed_at).toLocaleTimeString()}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-center py-6 text-slate-400">
                  No AI investigation run yet. Click "Re-run AI & Policy" above.
                </div>
              )}
            </div>
          </div>

          {/* Card 5: Deterministic Policy Evaluation */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Deterministic Policy Assessment
                </h3>
              </div>
              <SourceBadge source="POLICY_RULE" />
            </div>

            <div className="p-5 space-y-4 text-xs">
              {caseData.policyEvaluation ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] uppercase font-mono block">
                        Policy Evaluation Outcome:
                      </span>
                      <PolicyOutcomeBadge result={caseData.policyEvaluation.result} />
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 text-[10px] uppercase font-mono block">
                        Eligible Refund Cap:
                      </span>
                      <span className="font-mono text-base font-bold text-slate-900">
                        {caseData.policyEvaluation.eligible_amount !== null
                          ? `$${caseData.policyEvaluation.eligible_amount.toFixed(2)}`
                          : 'Not Eligible'}
                      </span>
                    </div>
                  </div>

                  {/* Rules Checklist */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <span className="text-[10px] uppercase font-mono text-slate-500 block">
                      Policy Rules Evaluated ({caseData.policyEvaluation.policy_version}):
                    </span>
                    {caseData.policyEvaluation.rules_evaluated.map((rule) => (
                      <div
                        key={rule.ruleId}
                        className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 ${
                          rule.passed
                            ? 'bg-emerald-50/50 border-emerald-200 text-slate-800'
                            : 'bg-red-50/50 border-red-200 text-slate-800'
                        }`}
                      >
                        {rule.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-semibold text-slate-900">{rule.ruleName}</div>
                          <div className="text-[11px] text-slate-600">{rule.details}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-slate-400 text-center py-4">Policy not yet evaluated.</div>
              )}
            </div>
          </div>

          {/* Card 6: Merchant Resolution & Authorization Center */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Merchant Resolution Controls</h3>
              </div>
              <SourceBadge source="HUMAN_APPROVAL" />
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* If refund completed */}
              {caseData.status === 'REFUNDED' ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold mb-1">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    Refund Executed via PayPal Sandbox
                  </div>
                  {caseData.refundAttempts.length > 0 && (
                    <div className="text-xs text-emerald-900 space-y-1 font-mono mt-2">
                      <div>
                        Refund ID:{' '}
                        <span className="font-bold">
                          {caseData.refundAttempts[caseData.refundAttempts.length - 1].paypalRefundId}
                        </span>
                      </div>
                      <div>
                        Amount:{' '}
                        <span className="font-bold">
                          ${caseData.refundAttempts[caseData.refundAttempts.length - 1].amount.toFixed(2)}{' '}
                          {order.currency}
                        </span>
                      </div>
                      <div>
                        Idempotency Key:{' '}
                        {caseData.refundAttempts[caseData.refundAttempts.length - 1].idempotencyKey}
                      </div>
                      <div>
                        Authorized By:{' '}
                        {caseData.refundAttempts[caseData.refundAttempts.length - 1].authorizedBy.userName}{' '}
                        ({caseData.refundAttempts[caseData.refundAttempts.length - 1].authorizedBy.userRole})
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Internal Investigation Note / Decision Reason
                    </label>
                    <input
                      type="text"
                      placeholder="Add reviewer notes before marking case status..."
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Actions Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <button
                      onClick={() => setShowRefundModal(true)}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-colors flex items-center justify-center gap-1 shadow-sm shadow-blue-500/20"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Approve & Refund
                    </button>
                    <button
                      onClick={() => handleReviewAction('REQUEST_INFO')}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors"
                    >
                      Request Info
                    </button>
                    <button
                      onClick={() => handleReviewAction('ESCALATE')}
                      className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-semibold rounded-lg text-xs transition-colors"
                    >
                      Escalate
                    </button>
                    <button
                      onClick={() => handleReviewAction('REJECT')}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs transition-colors"
                    >
                      Reject Dispute
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Card 7: Case Timeline & Audit History */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">
                Immutable Case Timeline ({caseData.timeline.length} events)
              </h3>
            </div>

            <div className="p-5 max-h-72 overflow-y-auto space-y-4">
              {caseData.timeline.map((event) => (
                <div key={event.id} className="flex items-start gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>{event.actor.name}</span>
                      <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-800 mt-0.5">{event.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
