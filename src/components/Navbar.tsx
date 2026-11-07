import React from 'react';
import {
  ShieldAlert,
  Scale,
  CreditCard,
  FileText,
  ShoppingBag,
  History,
  ExternalLink,
  BookOpen,
  UserCheck,
} from 'lucide-react';
import { User, UserRole } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User | null;
  onSwitchRole: (role: UserRole) => void;
  isSandboxConfigured: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onSwitchRole,
  isSandboxConfigured,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:bg-blue-500 transition-colors">
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-white block leading-none">
                  FairResolve
                </span>
                <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">
                  Dispute Intelligence · PayPal Sandbox
                </span>
              </div>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 text-sm font-medium">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'dashboard'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('cases')}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'cases' || activeTab === 'case-detail'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Dispute Cases
            </button>
            <button
              onClick={() => setActiveTab('checkout')}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
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
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'audit'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <History className="w-3.5 h-3.5 text-slate-400" />
              Audit Log
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'docs'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              Architecture
            </button>
          </nav>

          {/* User Role Switcher & Sandbox Badge */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Sandbox Mode Tag */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700/80 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${isSandboxConfigured ? 'bg-emerald-400' : 'bg-blue-400'}`} />
              <span className="text-slate-300">
                {isSandboxConfigured ? 'PayPal Sandbox Live' : 'Sandbox Simulated'}
              </span>
            </div>

            {/* Role Switcher for RBAC demonstration */}
            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-800/80 pl-2.5 pr-1.5 py-1 rounded-lg border border-slate-700">
                <UserCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <div className="text-xs">
                  <span className="text-slate-300 hidden md:inline">{currentUser.name} (</span>
                  <select
                    value={currentUser.role}
                    onChange={(e) => onSwitchRole(e.target.value as UserRole)}
                    className="bg-slate-900 text-white font-mono text-xs rounded border border-slate-700 px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    title="Switch user role to test RBAC permissions"
                  >
                    <option value="OWNER">OWNER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="REVIEWER">REVIEWER</option>
                    <option value="ANALYST">ANALYST</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                  <span className="text-slate-300 hidden md:inline">)</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
