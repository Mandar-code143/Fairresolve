/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { CaseInboxView } from './components/CaseInboxView';
import { CaseDetailView } from './components/CaseDetailView';
import { CustomerPortalView } from './components/CustomerPortalView';
import { CheckoutSimulatorView } from './components/CheckoutSimulatorView';
import { PolicyManagerView } from './components/PolicyManagerView';
import { PayPalIntegrationView } from './components/PayPalIntegrationView';
import { AuditLedgerView } from './components/AuditLedgerView';
import { DocsView } from './components/DocsView';
import { Case, Order, PayPalGatewayStatus, RefundPolicy, User, UserRole } from './types';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const [cases, setCases] = useState<Case[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [policies, setPolicies] = useState<RefundPolicy[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<PayPalGatewayStatus>({
    environment: 'sandbox',
    isConfigured: false,
    clientIdMasked: 'NOT_CONFIGURED',
    liveEnabled: false,
    activeOrderCount: 0,
    refundCount: 0,
    totalRefundedGross: 0,
  });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Initial Data Fetch
  const fetchData = async () => {
    try {
      const [casesRes, ordersRes, policiesRes, statusRes, authRes] = await Promise.all([
        fetch('/api/v1/cases'),
        fetch('/api/v1/orders'),
        fetch('/api/v1/policies'),
        fetch('/api/v1/paypal/status'),
        fetch('/api/v1/auth/me'),
      ]);

      const casesData = await casesRes.json();
      const ordersData = await ordersRes.json();
      const policiesData = await policiesRes.json();
      const statusData = await statusRes.json();
      const authData = await authRes.json();

      setCases(casesData.cases || []);
      setOrders(ordersData.orders || []);
      setPolicies(policiesData.policies || []);
      setGatewayStatus(statusData);
      setCurrentUser(authData.user || null);
    } catch (err) {
      console.error('Initial fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Switch role for RBAC testing
  const handleSwitchRole = async (role: UserRole) => {
    try {
      const res = await fetch('/api/v1/auth/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentUser(data.user);
      }
    } catch (err) {
      console.error('Role switch error:', err);
    }
  };

  // Case updated callback
  const handleUpdateCase = (updatedCase: Case, updatedOrder?: Order) => {
    setCases((prev) => prev.map((c) => (c.id === updatedCase.id ? updatedCase : c)));
    if (updatedOrder) {
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
    }
  };

  // Find active case for Detail View
  const selectedCase = cases.find((c) => c.id === selectedCaseId) || cases[0];
  const selectedOrder = orders.find((o) => o.id === selectedCase?.orderId) || orders[0];
  const activePolicy = policies[policies.length - 1] || {
    version: 'v2.1',
    publishedAt: new Date().toISOString(),
    returnWindowDays: 30,
    requirePackagingPhotoForDamage: true,
    requireLabelPhotoForWrongItem: true,
    carrierDeliveryVerificationDays: 3,
    maxInstantRefundAmount: 250,
    mandatoryReturnThreshold: 200,
    allowPartialRefundsWithoutReturn: true,
    maxPartialRefundPercentage: 50,
    flagDuplicateEvidenceHash: true,
    description: 'Default Policy',
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'case-detail') setSelectedCaseId(null);
        }}
        currentUser={currentUser}
        onSwitchRole={handleSwitchRole}
        isSandboxConfigured={gatewayStatus.isConfigured}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {loading ? (
          <div className="py-24 text-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-600" />
            <span className="text-xs font-mono uppercase tracking-wider">
              Initializing FairResolve Dispute Engine...
            </span>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                cases={cases}
                orders={orders}
                onSelectCase={(id) => {
                  setSelectedCaseId(id);
                  setActiveTab('case-detail');
                }}
                onNavigate={(tab) => setActiveTab(tab)}
                isSandboxConfigured={gatewayStatus.isConfigured}
              />
            )}

            {activeTab === 'cases' && (
              <CaseInboxView
                cases={cases}
                orders={orders}
                onSelectCase={(id) => {
                  setSelectedCaseId(id);
                  setActiveTab('case-detail');
                }}
              />
            )}

            {activeTab === 'case-detail' && selectedCase && selectedOrder && (
              <CaseDetailView
                caseData={selectedCase}
                order={selectedOrder}
                policy={activePolicy}
                currentUser={currentUser}
                onBack={() => setActiveTab('cases')}
                onUpdateCase={handleUpdateCase}
                onNavigate={(tab) => setActiveTab(tab)}
              />
            )}

            {activeTab === 'checkout' && (
              <CheckoutSimulatorView
                onOrderCreated={(_order, _link) => {
                  fetchData();
                }}
                onNavigateToCase={(caseId) => {
                  setSelectedCaseId(caseId);
                  setActiveTab('case-detail');
                }}
                isSandboxConfigured={gatewayStatus.isConfigured}
              />
            )}

            {activeTab === 'portal' && (
              <CustomerPortalView
                cases={cases}
                onSubmitted={() => {
                  fetchData();
                }}
              />
            )}

            {activeTab === 'policy' && (
              <PolicyManagerView
                policy={activePolicy}
                allPolicies={policies}
                currentUser={currentUser}
                onPolicyUpdated={(_newPolicy) => {
                  fetchData();
                }}
              />
            )}

            {activeTab === 'paypal' && (
              <PayPalIntegrationView
                status={gatewayStatus}
                onRefresh={fetchData}
              />
            )}

            {activeTab === 'audit' && <AuditLedgerView />}

            {activeTab === 'docs' && <DocsView />}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">FairResolve</span>
            <span>·</span>
            <span>AI Dispute Investigation & PayPal Refund Resolution</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
            <span>PayPal Sandbox Integration</span>
            <span>·</span>
            <span>Gemini Multimodal Engine</span>
            <span>·</span>
            <span>Deterministic Policy Engine</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
