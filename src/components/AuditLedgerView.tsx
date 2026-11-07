import React, { useState, useEffect } from 'react';
import { History, Filter, Search, CheckCircle2, ShieldAlert, CreditCard, Sparkles, User, RefreshCw } from 'lucide-react';
import { CaseEvent } from '../types';

export const AuditLedgerView: React.FC = () => {
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const fetchEvents = () => {
    setLoading(true);
    fetch('/api/v1/audit/events')
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.events || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Audit fetch error:', err);
        setLoading(false);
      });
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
        ev.actor.name.toLowerCase().includes(q);
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
            <span className="text-xs font-mono font-semibold uppercase text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              Compliance Ledger
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-mono text-slate-500">
              Append-Only Case Event Stream
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            System & Merchant Audit Log
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Every customer claim, uploaded evidence hash, multimodal AI inference, deterministic policy outcome,
            and PayPal refund execution is stored in an immutable append-only event stream.
          </p>
        </div>

        <button
          onClick={fetchEvents}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          title="Refresh Events"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search audit trail by case ID, actor, or summary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
          filteredEvents.map((ev) => (
            <div key={ev.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors flex items-start gap-3.5 text-xs">
              {/* Event Icon */}
              <div className="mt-0.5 shrink-0">
                {ev.eventType === 'REFUND_EXECUTED' ? (
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <CreditCard className="w-3.5 h-3.5" />
                  </div>
                ) : ev.eventType === 'AI_INVESTIGATION_COMPLETED' ? (
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-[11px] px-1.5 py-0.5 rounded bg-slate-100">
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

                {/* Details snippet if available */}
                {ev.details && Object.keys(ev.details).length > 0 && (
                  <div className="mt-2 p-2 rounded bg-slate-50 border border-slate-200/80 font-mono text-[10px] text-slate-600 max-h-24 overflow-y-auto">
                    {JSON.stringify(ev.details, null, 2)}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
