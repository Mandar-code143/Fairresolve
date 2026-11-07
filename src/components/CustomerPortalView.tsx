import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  CreditCard,
  ShoppingBag,
  Loader2,
  X,
} from 'lucide-react';
import { Case, IssueType, ResolutionRequested } from '../types';

interface CustomerPortalViewProps {
  cases: Case[];
  activeToken?: string;
  onSubmitted: () => void;
}

export const CustomerPortalView: React.FC<CustomerPortalViewProps> = ({
  cases,
  activeToken,
  onSubmitted,
}) => {
  const [selectedCaseToken, setSelectedCaseToken] = useState<string>(
    activeToken || cases[0]?.customerAccessToken || ''
  );
  const [caseContext, setCaseContext] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form states
  const [issueType, setIssueType] = useState<IssueType>('damaged_item');
  const [description, setDescription] = useState('');
  const [requestedResolution, setRequestedResolution] = useState<ResolutionRequested>('full_refund');
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ filename: string; fileBase64: string; evidenceType: string; caption?: string }>
  >([]);

  // Fetch token dispute context
  useEffect(() => {
    if (!selectedCaseToken) return;

    setLoading(true);
    fetch(`/api/v1/customer/case/${selectedCaseToken}`)
      .then((res) => res.json())
      .then((data) => {
        setCaseContext(data);
        if (data.customerDescription) setDescription(data.customerDescription);
        if (data.issueType) setIssueType(data.issueType);
        if (data.requestedResolution) setRequestedResolution(data.requestedResolution);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching portal context:', err);
        setLoading(false);
      });
  }, [selectedCaseToken]);

  // Handle local file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setUploadedFiles((prev) => [
        ...prev,
        {
          filename: file.name,
          fileBase64: base64,
          evidenceType: issueType === 'wrong_item' ? 'shipping_label' : 'item_photo',
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/customer/case/${selectedCaseToken}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueType,
          description,
          requestedResolution,
          uploadedFiles,
        }),
      });

      if (res.ok) {
        setSuccess(true);
        onSubmitted();
      }
    } catch (err) {
      console.error('Submission error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Switcher for testing multiple dispute tokens */}
      <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-between text-xs">
        <span className="text-slate-500 font-medium">Demo Customer Link Switcher:</span>
        <select
          value={selectedCaseToken}
          onChange={(e) => {
            setSelectedCaseToken(e.target.value);
            setSuccess(false);
          }}
          className="bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-slate-800 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {cases.map((c) => (
            <option key={c.id} value={c.customerAccessToken}>
              {c.caseNumber} - {c.customerName} ({c.orderNumber})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
          Loading secure dispute portal...
        </div>
      ) : caseContext ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-slate-900 text-white p-6 sm:p-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase tracking-wider text-blue-400">
                Customer Resolution Portal
              </span>
              <span className="text-xs font-mono text-slate-400">
                Case {caseContext.caseNumber}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Dispute Investigation & Resolution Request
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Store: <span className="text-white font-semibold">{caseContext.merchantName}</span> ·
              Order Ref: <span className="font-mono text-white">{caseContext.orderNumber}</span>
            </p>
          </div>

          {/* Form */}
          {success ? (
            <div className="p-8 text-center space-y-3">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                Dispute Information Submitted Successfully
              </h2>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Your explanation and evidence have been recorded into our secure resolution engine.
                The merchant and our automated policy rules are now evaluating your case.
              </p>
              <button
                onClick={() => setSuccess(false)}
                className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors"
              >
                Edit or Upload More Information
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6 text-xs">
              {/* Order Context Card */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="font-mono text-[10px] uppercase text-slate-500 font-semibold block mb-2">
                  Verified Order Items
                </span>
                <div className="space-y-1.5">
                  {caseContext.items?.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center text-xs">
                      <span className="font-medium text-slate-900">
                        {item.name} <span className="text-slate-400">× {item.quantity}</span>
                      </span>
                      <span className="font-mono font-bold text-slate-900">
                        ${item.totalPrice.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200/80 flex justify-between text-xs font-bold text-slate-900">
                  <span>Order Total:</span>
                  <span className="font-mono">${caseContext.grossAmount?.toFixed(2)} USD</span>
                </div>
              </div>

              {/* Issue Category */}
              <div>
                <label className="text-xs font-semibold text-slate-900 block mb-2">
                  What issue occurred with your order?
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'damaged_item', label: 'Item Arrived Damaged' },
                    { id: 'wrong_item', label: 'Wrong Item Received' },
                    { id: 'item_not_received', label: 'Item Not Received' },
                  ].map((cat) => (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setIssueType(cat.id as IssueType)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        issueType === cat.id
                          ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Requested Resolution */}
              <div>
                <label className="text-xs font-semibold text-slate-900 block mb-2">
                  What resolution are you requesting?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'full_refund', label: 'Full Refund' },
                    { id: 'partial_refund', label: 'Partial Refund' },
                    { id: 'replacement', label: 'Replacement' },
                    { id: 'store_credit', label: 'Store Credit' },
                  ].map((res) => (
                    <button
                      type="button"
                      key={res.id}
                      onClick={() => setRequestedResolution(res.id as ResolutionRequested)}
                      className={`p-2.5 rounded-lg border text-center transition-colors ${
                        requestedResolution === res.id
                          ? 'border-blue-600 bg-blue-50/50 text-blue-900 font-semibold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Detailed Explanation */}
              <div>
                <label className="text-xs font-semibold text-slate-900 block mb-1">
                  Describe what happened in detail
                </label>
                <textarea
                  rows={4}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Please describe the condition of the parcel, where the damage is located, or any discrepancies..."
                  className="w-full p-3 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Photo Upload Section */}
              <div>
                <label className="text-xs font-semibold text-slate-900 block mb-1">
                  Upload Supporting Photos (JPEG, PNG, WEBP max 5MB)
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  Our system inspects file bytes and cryptographic signatures to protect against fraudulent claims.
                </p>

                <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:bg-slate-50/50 transition-colors">
                  <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                  <label className="cursor-pointer text-xs font-semibold text-blue-600 hover:text-blue-800">
                    Choose photo file
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Clear photos of the item defect or shipping barcode
                  </span>
                </div>

                {/* Uploaded Files List */}
                {uploadedFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {uploadedFiles.map((f, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200 text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{f.filename}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          className="p-1 rounded text-slate-400 hover:text-red-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit CTA */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Protected by FairResolve Policy Engine & PayPal
                </span>
                <button
                  type="submit"
                  disabled={submitting || !description.trim()}
                  className={`px-6 py-2.5 rounded-lg text-white font-semibold text-xs flex items-center gap-2 transition-colors ${
                    submitting || !description.trim()
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/20'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing with FairResolve...
                    </>
                  ) : (
                    'Submit Dispute Investigation Request'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="p-8 text-center text-slate-400">No dispute context found.</div>
      )}
    </div>
  );
};
