import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  CheckCircle2,
  ShieldAlert,
  CreditCard,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Link,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { CaseEvent } from '../types';
import { apiFetch } from '../utils/api';

export const AuditLedgerView: React.FC = () => {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Cryptographic integrity verification state
  const [chainIntegrity, setChainIntegrity] = useState<{
    isValid: boolean;
    checkedCount: number;
    brokenAtIndex?: number;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const [eventsRes, verifyRes] = await Promise.all([
        apiFetch('/api/v1/audit/events'),
        apiFetch('/api/v1/audit/verify'),
      ]);

      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setEvents(data.events || []);
      }

      if (verifyRes.ok) {
        const vData = await verifyRes.json();
        setChainIntegrity(vData);
      }
    } catch (err) {
      console.error('Audit fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await apiFetch('/api/v1/audit/verify');
      if (res.ok) {
        const data = await res.json();
        setChainIntegrity(data);
      }
    } catch (e) {
      console.error('Verification error:', e);
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const filteredEvents = events.filter((ev) => {
    if (filterType !== 'ALL' && ev.eventType !== filterType) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const match =
        ev.summary.toLowerCase().includes(q) ||
        ev.caseId.toLowerCase().includes(q) ||
        ev.actor.name.toLowerCase().includes(q) ||
        (ev.currentHash && ev.currentHash.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono font-semibold uppercase text-[#0070BA] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              Tamper-Evident Ledger
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-mono text-slate-500">
              SHA-256 Cryptographic Hash Chain
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Cryptographic Audit Ledger & Event Stream
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Every merchant dispute intake, uploaded evidence fingerprint, AI inference observation,
            deterministic policy evaluation, and PayPal Sandbox refund is linked in a sequential SHA-256
            cryptographic hash chain.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-center shrink-0">
          <button
            onClick={handleVerifyChain}
            disabled={verifying}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <ShieldCheck className={`w-4 h-4 text-emerald-400 ${verifying ? 'animate-spin' : ''}`} />
            <span>{verifying ? 'Verifying...' : 'Verify Cryptographic Chain'}</span>
          </button>

          <button
            onClick={fetchEvents}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
            title="Refresh Events"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Hash Chain Verification Status Banner */}
      {chainIntegrity && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            chainIntegrity.isValid
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {chainIntegrity.isValid ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <div className="font-bold">
                {chainIntegrity.isValid
                  ? 'Cryptographic Ledger Integrity: VERIFIED (100% Intact)'
                  : `Integrity Alert: Chain compromised at index ${chainIntegrity.brokenAtIndex}!`}
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {chainIntegrity.checkedCount} chained event blocks verified sequentially against previous block SHA-256 hashes.
              </p>
            </div>
          </div>
          <div className="font-mono text-[10px] bg-white/80 px-2.5 py-1 rounded border border-emerald-300 self-start sm:self-auto">
            Algorithm: SHA-256 Chained
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search audit trail by case ID, actor, or SHA-256 hash prefix..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
          />
        </div>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#0070BA] cursor-pointer"
        >
          <option value="ALL">All Event Types</option>
          <option value="CASE_CREATED">Case Created</option>
          <option value="EVIDENCE_UPLOADED">Evidence Uploaded</option>
          <option value="AI_INVESTIGATION_COMPLETED">AI Investigation Completed</option>
          <option value="POLICY_EVALUATED">Policy Evaluated</option>
          <option value="MERCHANT_REVIEWED">Merchant Reviewed</option>
          <option value="REFUND_EXECUTED">Refund Executed</option>
          <option value="STATUS_CHANGED">Status Changed</option>
        </select>
      </div>

      {/* Event Stream List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading audit events...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">No matching audit events found.</div>
        ) : (
          filteredEvents.map((ev) => {
            const isExpanded = expandedEventId === ev.id;
            return (
              <div
                key={ev.id}
                className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors flex items-start gap-3.5 text-xs"
              >
                {/* Event Icon */}
                <div className="mt-0.5 shrink-0">
                  {ev.eventType === 'REFUND_EXECUTED' ? (
                    <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                      <CreditCard className="w-3.5 h-3.5" />
                    </div>
                  ) : ev.eventType === 'AI_INVESTIGATION_COMPLETED' ? (
                    <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                  ) : ev.eventType === 'EVIDENCE_UPLOADED' ? (
                    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                      <ShieldAlert className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>

                {/* Event Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-[11px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                        {ev.caseId}
                      </span>
                      <span className="font-semibold text-slate-800">{ev.actor.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-mono">
                        ({ev.actor.type})
                      </span>
                    </div>
                    <span className="text-slate-400 font-mono text-[11px] shrink-0">
                      {new Date(ev.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-slate-700 mt-1 leading-relaxed">{ev.summary}</p>

                  {/* Hash Chain Footprint */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
                    {ev.currentHash && (
                      <span
                        title={ev.currentHash}
                        className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 flex items-center gap-1 border border-slate-200"
                      >
                        <Link className="w-3 h-3 text-[#0070BA]" />
                        <span>Hash: {ev.currentHash.substring(0, 16)}...</span>
                      </span>
                    )}

                    {ev.details && Object.keys(ev.details).length > 0 && (
                      <button
                        onClick={() => setExpandedEventId(isExpanded ? null : ev.id)}
                        className="text-[#0070BA] hover:underline flex items-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <span>Hide Details</span>
                            <ChevronUp className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            <span>View Payload</span>
                            <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Expandable Details Payload */}
                  {isExpanded && ev.details && (
                    <div className="mt-3 p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] max-h-48 overflow-y-auto space-y-2">
                      {ev.previousHash && (
                        <div className="text-slate-400 text-[10px]">
                          <strong>Previous Block Hash:</strong> {ev.previousHash}
                        </div>
                      )}
                      {ev.currentHash && (
                        <div className="text-emerald-400 text-[10px]">
                          <strong>Current Block Hash:</strong> {ev.currentHash}
                        </div>
                      )}
                      <pre className="text-slate-200 whitespace-pre-wrap">
                        {JSON.stringify(ev.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
