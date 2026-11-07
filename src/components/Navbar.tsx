import React, { useState } from 'react';
import {
  Scale,
  ShoppingBag,
  ExternalLink,
  FileText,
  CreditCard,
  History,
  Users,
  LogOut,
  UserCheck,
  ChevronDown,
} from 'lucide-react';
import { User, UserRole } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User | null;
  onSwitchRole: (role: UserRole) => void;
  onOpenLoginModal: () => void;
  onLogout: () => void;
  isSandboxConfigured: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onSwitchRole,
  onOpenLoginModal,
  onLogout,
  isSandboxConfigured,
}) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-6">
          {/* Zone 1: Wordmark */}
          <button
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 text-left shrink-0 group focus:outline-none"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:bg-blue-500 transition-colors">
              <Scale className="w-4 h-4" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
              FairResolve
            </span>
          </button>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 text-xs font-medium">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'dashboard'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('cases')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'cases' || activeTab === 'case-detail'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Dispute Cases
            </button>
            <button
              onClick={() => setActiveTab('checkout')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'checkout'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />
              Demo Checkout
            </button>
            <button
              onClick={() => setActiveTab('portal')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'portal'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
              Customer Portal
            </button>
            <button
              onClick={() => setActiveTab('policy')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'policy'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              Policy Engine
            </button>
            <button
              onClick={() => setActiveTab('paypal')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'paypal'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5 text-sky-400" />
              PayPal Sandbox
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'audit'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <History className="w-3.5 h-3.5 text-slate-400" />
              Audit Log
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'team'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              Team & RBAC
            </button>
          </nav>

          {/* Zone 3: Account Profile & Fast Role Selector */}
          <div className="flex items-center gap-3 shrink-0">
            {/* PayPal Mode Status Text */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-400 border border-slate-800 bg-slate-950/60 px-2.5 py-1 rounded">
              <span className="text-[10px] uppercase font-bold text-slate-400">PayPal:</span>
              <span className={isSandboxConfigured ? 'text-emerald-400 font-semibold' : 'text-sky-400'}>
                {isSandboxConfigured ? 'Live Sandbox' : 'Simulated'}
              </span>
            </div>

            {currentUser ? (
              <div className="relative">
                <div className="flex items-center gap-2 bg-slate-800 pl-2.5 pr-2 py-1 rounded-lg border border-slate-700">
                  <UserCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-white font-medium hidden md:inline truncate max-w-[100px]">
                      {currentUser.name}
                    </span>
                    <select
                      value={currentUser.role}
                      onChange={(e) => onSwitchRole(e.target.value as UserRole)}
                      className="bg-slate-900 text-white font-mono text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      title="Switch role to test authorization"
                    >
                      <option value="OWNER">OWNER</option>
                      <option value="ADMIN">ADMIN</option>
                      <option value="REVIEWER">REVIEWER</option>
                      <option value="ANALYST">ANALYST</option>
                      <option value="VIEWER">VIEWER</option>
                    </select>
                  </div>
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="text-slate-400 hover:text-white p-0.5"
                    title="User options"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-48 bg-white text-slate-900 rounded-lg shadow-xl border border-slate-200 py-1 z-50 text-xs"
                    onMouseLeave={() => setUserMenuOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-100 font-mono text-[11px] text-slate-500">
                      {currentUser.email}
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onOpenLoginModal();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                    >
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      Switch Demo Account
                    </button>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenLoginModal}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm shadow-blue-500/20"
              >
                Sign In / Demo Login
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
