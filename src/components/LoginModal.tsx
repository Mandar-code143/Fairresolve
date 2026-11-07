import React, { useState, useEffect } from 'react';
import { Shield, Key, Building2, UserCheck, AlertCircle, Loader2, X, Lock } from 'lucide-react';
import { User, UserRole } from '../types';
import { setAuthToken } from '../utils/api';

interface DemoAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantName: string;
}

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User, token: string) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'demo' | 'password' | 'register'>('demo');
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('marcus.vance@apex-audio.com');
  const [password, setPassword] = useState('Password123!');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetch('/api/v1/auth/demo-accounts')
        .then((res) => res.json())
        .then((data) => {
          if (data.demoUsers) setDemoAccounts(data.demoUsers);
        })
        .catch((err) => console.error('Failed to load demo accounts:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDemoSelect = async (account: DemoAccount) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: account.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Demo login failed');

      setAuthToken(data.token);
      onSuccess(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      setAuthToken(data.token);
      onSuccess(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, companyName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      setAuthToken(data.token);
      onSuccess(data.user, data.token);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'OWNER':
        return <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">OWNER</span>;
      case 'ADMIN':
        return <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold">ADMIN</span>;
      case 'REVIEWER':
        return <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">REVIEWER</span>;
      case 'ANALYST':
        return <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">ANALYST</span>;
      case 'VIEWER':
        return <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold">VIEWER</span>;
    }
  };

  const getRoleDescription = (role: UserRole) => {
    switch (role) {
      case 'OWNER':
        return 'Full merchant authority: Authorize PayPal refunds, manage policies, configure credentials, invite team.';
      case 'ADMIN':
        return 'Administrative authority: Authorize refunds, publish dispute policies, manage audit records.';
      case 'REVIEWER':
        return 'Investigation lead: Review evidence, trigger AI analysis, approve cases, submit refunds.';
      case 'ANALYST':
        return 'Dispute operations: Re-analyze cases, review evidence, inspect audit trails (cannot authorize refunds).';
      case 'VIEWER':
        return 'Read-only audit: View dispute cases, policy evaluations, and PayPal status (cannot authorize actions).';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-blue-600/30 text-blue-400 border border-blue-500/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Authentication & RBAC Identity</h3>
              <p className="text-xs text-slate-400">
                Session token authentication with cryptographically hashed credentials
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-3 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('demo')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'demo'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            1-Click Demo Profiles
          </button>
          <button
            onClick={() => setActiveTab('password')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'password'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Email & Password
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'register'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            New Merchant Registration
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'demo' && (
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 mb-3">
                Select any pre-configured role to immediately issue a secure cryptographic session token and test role-based access control (RBAC):
              </p>
              {demoAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => handleDemoSelect(acc)}
                  disabled={loading}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 transition-all group flex items-start justify-between gap-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900 group-hover:text-blue-900">
                        {acc.name}
                      </span>
                      {getRoleBadge(acc.role)}
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono mb-1">{acc.email}</p>
                    <p className="text-[11px] text-slate-600 leading-snug">{getRoleDescription(acc.role)}</p>
                  </div>
                  <UserCheck className="w-4 h-4 text-slate-400 group-hover:text-blue-600 shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}

          {activeTab === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">Default demo password for all accounts is: Password123!</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                Sign In With Session Token
              </button>
            </form>
          )}

          {activeTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company / Store Name</label>
                <input
                  type="text"
                  placeholder="e.g. Meridian Audio Works"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Owner Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jordan Miller"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="owner@meridian-audio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors mt-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                Create Tenant & Launch Dashboard
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
