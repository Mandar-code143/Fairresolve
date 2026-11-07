import React, { useState } from 'react';
import { X, Copy, Check, ShieldAlert, FileText, Download } from 'lucide-react';
import { EvidenceObject } from '../types';

interface EvidenceModalProps {
  evidence: EvidenceObject | null;
  onClose: () => void;
}

export const EvidenceModal: React.FC<EvidenceModalProps> = ({ evidence, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!evidence) return null;

  const handleCopyHash = () => {
    navigator.clipboard.writeText(evidence.sha256Hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              {evidence.originalFilename}
            </h3>
            <p className="text-xs text-slate-500">
              Uploaded on {new Date(evidence.uploadedAt).toLocaleString()} · Evidence ID:{' '}
              <span className="font-mono">{evidence.id}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Duplicate Hash Warning Banner if detected */}
          {evidence.isDuplicate && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-red-900">
                  Cryptographic Evidence Collision Alert
                </h4>
                <p className="text-xs text-red-700 mt-1">
                  The exact SHA-256 fingerprint of this file matches an image previously uploaded in:{' '}
                  <span className="font-mono font-bold">
                    {evidence.duplicateCaseIds?.join(', ') || 'another case'}
                  </span>
                  . This strongly indicates re-used media across separate disputes. Do not issue
                  automated refund without physical inspection.
                </p>
              </div>
            </div>
          )}

          {/* Image Display */}
          <div className="bg-slate-950 rounded-lg p-2 flex items-center justify-center max-h-[460px] overflow-hidden">
            {evidence.thumbnailBase64 ? (
              <img
                src={evidence.thumbnailBase64}
                alt={evidence.caption || evidence.originalFilename}
                className="max-h-[440px] max-w-full object-contain rounded"
              />
            ) : (
              <div className="text-slate-400 text-sm py-16">
                Image preview available via secure storage: {evidence.downloadUrl}
              </div>
            )}
          </div>

          {/* Technical Metadata Table */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <h4 className="text-xs font-semibold uppercase text-slate-500 font-mono tracking-wider mb-3">
              Forensic & Cryptographic Evidence Details
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-500 block">MIME Signature:</span>
                <span className="font-mono font-medium text-slate-900">{evidence.mimeType}</span>
              </div>
              <div>
                <span className="text-slate-500 block">File Byte Size:</span>
                <span className="font-mono font-medium text-slate-900">
                  {evidence.byteSize.toLocaleString()} bytes (
                  {(evidence.byteSize / 1024).toFixed(1)} KB)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Integrity Scan:</span>
                <span
                  className={`font-semibold ${
                    evidence.scanStatus === 'clean'
                      ? 'text-emerald-700'
                      : evidence.scanStatus === 'suspicious'
                      ? 'text-red-700'
                      : 'text-slate-700'
                  }`}
                >
                  {evidence.scanStatus.toUpperCase()} (Validated byte signature)
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Evidence Tag:</span>
                <span className="font-mono font-medium text-slate-900">
                  {evidence.evidenceType.toUpperCase()}
                </span>
              </div>
              <div className="md:col-span-2">
                <span className="text-slate-500 block">SHA-256 Fingerprint:</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-[11px] bg-white px-2 py-1 rounded border border-slate-200 text-slate-800 break-all select-all flex-1">
                    {evidence.sha256Hash}
                  </span>
                  <button
                    onClick={handleCopyHash}
                    className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors shrink-0"
                    title="Copy SHA-256 hash"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {evidence.caption && (
                <div className="md:col-span-2">
                  <span className="text-slate-500 block">Customer Provided Caption:</span>
                  <p className="text-slate-800 italic mt-0.5">"{evidence.caption}"</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50">
          <span className="text-xs text-slate-500">
            Stored in private isolated storage · Never publicly indexed
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
