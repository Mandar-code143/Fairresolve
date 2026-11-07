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
  Menu,
  X,
  ShieldAlert,
} from 'lucide-react';
import { User } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User | null;
  onOpenLoginModal: () => void;
  onLogout: () => void;
  isSandboxConfigured: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onOpenLoginModal,
  onLogout,
  isSandboxConfigured,
}) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: null },
    { id: 'cases', label: 'Dispute Cases', icon: null },
    { id: 'checkout', label: 'Demo Checkout', icon: ShoppingBag, color: 'text-blue-400' },
    { id: 'portal', label: 'Customer Portal', icon: ExternalLink, color: 'text-purple-400' },
    { id: 'policy', label: 'Policy Engine', icon: FileText, color: 'text-emerald-400' },
    { id: 'paypal', label: 'PayPal Sandbox', icon: CreditCard, color: 'text-sky-400' },
    { id: 'audit', label: 'Audit Log', icon: History, color: 'text-slate-400' },
    { id: 'team', label: 'Team & RBAC', icon: Users, color: 'text-indigo-400' },
  ];

  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case 'OWNER':
        return 'bg-purple-900/60 text-purple-300 border-purple-700/60';
      case 'ADMIN':
        return 'bg-blue-900/60 text-blue-300 border-blue-700/60';
      case 'REVIEWER':
        return 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60';
      case 'ANALYST':
        return 'bg-amber-900/60 text-amber-300 border-amber-700/60';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Zone 1: Brand & Mobile Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 text-left shrink-0 group focus:outline-none"
            >
              <div className="w-8 h-8 rounded-lg bg-[#0070BA] flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:bg-[#003087] transition-colors">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
                  FairResolve
                </span>
                <span className="hidden sm:inline-block ml-2 text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Fintech Dispute Platform
                </span>
              </div>
            </button>
          </div>

          {/* Zone 2: Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 text-xs font-medium">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id || (item.id === 'cases' && activeTab === 'case-detail');
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-slate-800 text-white font-semibold shadow-inner'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  {Icon && <Icon className={`w-3.5 h-3.5 ${item.color || 'text-slate-400'}`} />}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Account Profile & PayPal Status */}
          <div className="flex items-center gap-3 shrink-0">
            {/* PayPal Mode Status Text */}
            <div
              title={
                isSandboxConfigured
                  ? 'Authenticated with PayPal Sandbox Developer API'
                  : 'Running in demonstration sandbox simulation'
              }
              className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-400 border border-slate-800 bg-slate-950/80 px-2.5 py-1 rounded-md"
            >
              <span className="text-[10px] uppercase font-bold text-slate-400">PayPal:</span>
              <span className={isSandboxConfigured ? 'text-emerald-400 font-semibold' : 'text-sky-400 font-semibold'}>
                {isSandboxConfigured ? 'Live Sandbox' : 'Simulated'}
              </span>
            </div>

            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-750 pl-2.5 pr-2 py-1 rounded-lg border border-slate-700 transition-colors focus:outline-none"
                  aria-expanded={userMenuOpen}
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#0070BA] shrink-0" />
                  <div className="flex items-center gap-1.5 text-left">
                    <span className="text-xs text-white font-medium hidden md:inline truncate max-w-[110px]">
                      {currentUser.name}
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${getRoleBadgeColor(
                        currentUser.role
                      )}`}
                    >
                      {currentUser.role}
                    </span>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-56 bg-white text-slate-900 rounded-lg shadow-2xl border border-slate-200 py-1.5 z-50 text-xs"
                    onMouseLeave={() => setUserMenuOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="font-semibold text-slate-800">{currentUser.name}</div>
                      <div className="font-mono text-[11px] text-slate-500 truncate">{currentUser.email}</div>
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        <span>Role:</span>
                        <strong className="font-mono">{currentUser.role}</strong>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onOpenLoginModal();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                    >
                      <Users className="w-3.5 h-3.5 text-[#0070BA]" />
                      <span>Switch Account / Persona</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-600 flex items-center gap-2 border-t border-slate-100"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenLoginModal}
                className="px-3.5 py-1.5 bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-semibold rounded-lg transition-colors shadow-sm shadow-blue-500/20"
              >
                Sign In / Demo Login
              </button>
            )}
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-3 border-t border-slate-800 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id || (item.id === 'cases' && activeTab === 'case-detail');
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2.5 ${
                    isActive ? 'bg-slate-800 text-white font-semibold' : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  {Icon && <Icon className={`w-4 h-4 ${item.color || 'text-slate-400'}`} />}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
};
