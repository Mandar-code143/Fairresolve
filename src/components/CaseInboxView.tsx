import React, { useState } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { Case, CaseStatus, IssueType, Order } from '../types';
import { CaseStatusBadge } from './Badges';

interface CaseInboxViewProps {
  cases: Case[];
  orders: Order[];
  onSelectCase: (caseId: string) => void;
}

export const CaseInboxView: React.FC<CaseInboxViewProps> = ({ cases, orders, onSelectCase }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [issueFilter, setIssueFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');

  // Filter cases
  const filteredCases = cases.filter((c) => {
    // Search
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        c.caseNumber.toLowerCase().includes(q) ||
        c.orderNumber.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.customerDescription.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    // Status filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'READY' && c.status !== 'READY_FOR_REVIEW') return false;
      if (statusFilter === 'INFO' && c.status !== 'NEEDS_MORE_INFORMATION') return false;
      if (statusFilter === 'ESCALATED' && c.status !== 'ESCALATED') return false;
      if (statusFilter === 'REFUNDED' && c.status !== 'REFUNDED') return false;
      if (statusFilter === 'INELIGIBLE' && c.policyEvaluation?.result !== 'INELIGIBLE_UNDER_CONFIGURED_POLICY')
        return false;
    }

    // Issue category
    if (issueFilter !== 'ALL' && c.issueType !== issueFilter) {
      return false;
    }

    return true;
  });

  // Sort
  filteredCases.sort((a, b) => {
    if (sortBy === 'date') {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    } else {
      const orderA = orders.find((o) => o.id === a.orderId)?.grossAmount || 0;
      const orderB = orders.find((o) => o.id === b.orderId)?.grossAmount || 0;
      return orderB - orderA;
    }
  });

  return (
    <div className="space-y-5">
      {/* Page Title & Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Customer Dispute Inbox
          </h1>
          <p className="text-xs text-slate-500">
            Audit-ready disputes evaluated against merchant policy and PayPal verified captures
          </p>
        </div>

        {/* Quick Segmented Status Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg text-xs overflow-x-auto">
          {[
            { id: 'ALL', label: 'All Cases' },
            { id: 'READY', label: 'Ready for Review' },
            { id: 'INFO', label: 'Needs Info' },
            { id: 'ESCALATED', label: 'Escalated' },
            { id: 'REFUNDED', label: 'Refunded' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by case #, order #, customer name or complaint text..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
          />
        </div>

        {/* Category & Sort Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1 sm:flex-initial">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={issueFilter}
              onChange={(e) => setIssueFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              <option value="damaged_item">Damaged Item</option>
              <option value="wrong_item">Wrong Item</option>
              <option value="item_not_received">Item Not Received</option>
            </select>
          </div>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'amount')}
            className="flex-1 sm:flex-initial px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="date">Sort: Most Recent</option>
            <option value="amount">Sort: Highest Amount</option>
          </select>
        </div>
      </div>

      {/* Disputes Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[850px] w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Case #</th>
                <th className="py-3 px-4">Customer & Order</th>
                <th className="py-3 px-4">Issue Category</th>
                <th className="py-3 px-4">Requested</th>
                <th className="py-3 px-4">Gross Amount</th>
                <th className="py-3 px-4">Policy Result</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    No disputes match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const order = orders.find((o) => o.id === c.orderId);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectCase(c.id)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      {/* Case Number */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {c.caseNumber}
                      </td>

                      {/* Customer & Order */}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900">{c.customerName}</div>
                        <div className="font-mono text-[11px] text-slate-400">
                          {c.orderNumber}
                        </div>
                      </td>

                      {/* Issue Category */}
                      <td className="py-3.5 px-4">
                        <span className="capitalize text-slate-700 font-medium">
                          {c.issueType.replace('_', ' ')}
                        </span>
                        {c.evidence.length > 0 && (
                          <span className="text-[10px] text-slate-400 block">
                            {c.evidence.length} photo(s)
                          </span>
                        )}
                      </td>

                      {/* Requested Resolution */}
                      <td className="py-3.5 px-4 text-slate-600 capitalize">
                        {c.requestedResolution.replace('_', ' ')}
                      </td>

                      {/* Gross Amount */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 tabular-nums">
                        ${order ? order.grossAmount.toFixed(2) : '0.00'}
                      </td>

                      {/* Policy Evaluation Result */}
                      <td className="py-3.5 px-4">
                        {c.policyEvaluation ? (
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded font-medium ${
                              c.policyEvaluation.result === 'ELIGIBLE_FOR_MERCHANT_REVIEW'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : c.policyEvaluation.result === 'MORE_INFORMATION_REQUIRED'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : c.policyEvaluation.result === 'MANUAL_REVIEW_REQUIRED'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {c.policyEvaluation.result.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Not Evaluated</span>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-4">
                        <CaseStatusBadge status={c.status} />
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCase(c.id);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center gap-1"
                        >
                          Inspect
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
