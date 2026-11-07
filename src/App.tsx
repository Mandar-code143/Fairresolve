/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { TeamManagerView } from './components/TeamManagerView';
import { LoginModal } from './components/LoginModal';
import { Case, Order, PayPalGatewayStatus, RefundPolicy, User, UserRole } from './types';
import { apiFetch, getAuthToken, setAuthToken, removeAuthToken } from './utils/api';
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
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Core Data Fetch using authenticated apiFetch
  const fetchData = useCallback(async () => {
    try {
      const [casesRes, ordersRes, policiesRes, statusRes, authRes] = await Promise.all([
        apiFetch('/api/v1/cases'),
        apiFetch('/api/v1/orders'),
        apiFetch('/api/v1/policies'),
        apiFetch('/api/v1/paypal/status'),
        apiFetch('/api/v1/auth/me'),
      ]);

      if (authRes.ok) {
        const authData = await authRes.json();
        setCurrentUser(authData.user || null);
      }

      if (casesRes.ok) {
        const casesData = await casesRes.json();
        setCases(casesData.cases || []);
      }

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setOrders(ordersData.orders || []);
      }

      if (policiesRes.ok) {
        const policiesData = await policiesRes.json();
        setPolicies(policiesData.policies || []);
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setGatewayStatus(statusData);
      }
    } catch (err) {
      console.error('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize session: auto-bootstrap demo session if no token stored
  useEffect(() => {
    const initAuth = async () => {
      let token = getAuthToken();
      if (!token) {
        try {
          // Auto login as Owner for instant review access
          const res = await fetch('/api/v1/auth/demo-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'usr-owner-01' }),
          });
          if (res.ok) {
            const data = await res.json();
            setAuthToken(data.token);
            setCurrentUser(data.user);
          }
        } catch (e) {
          console.error('Auto demo login failed:', e);
        }
      }
      fetchData();
    };

    initAuth();
  }, [fetchData]);

  // Switch role for RBAC testing by issuing a genuine session token
  const handleSwitchRole = async (targetRole: UserRole) => {
    try {
      // Find user id for role from demo accounts
      const accountsRes = await fetch('/api/v1/auth/demo-accounts');
      const accountsData = await accountsRes.json();
      const matched = (accountsData.demoUsers || []).find((u: any) => u.role === targetRole);

      if (matched) {
        const res = await fetch('/api/v1/auth/demo-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: matched.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setAuthToken(data.token);
          setCurrentUser(data.user);
          fetchData();
        }
      }
    } catch (err) {
      console.error('Role switch error:', err);
    }
  };

  // Sign out
  const handleLogout = async () => {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    } finally {
      removeAuthToken();
      setCurrentUser(null);
      setIsLoginModalOpen(true);
    }
  };

  // Login success callback
  const handleAuthSuccess = (user: User, _token: string) => {
    setCurrentUser(user);
    setIsLoginModalOpen(false);
    fetchData();
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
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
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

            {activeTab === 'team' && <TeamManagerView currentUser={currentUser} />}

            {activeTab === 'docs' && <DocsView />}
          </>
        )}
      </main>

      {/* Authentication & Role Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

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
