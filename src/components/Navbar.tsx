import React, { useState, useRef, useEffect } from 'react';
import {
  Scale,
  LayoutDashboard,
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
  Layers,
  BookOpen,
  ChevronRight,
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
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Primary navigation tabs (shown directly in navbar on laptop & desktop)
  const primaryNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'cases', label: 'Dispute Cases', icon: FileText },
    { id: 'checkout', label: 'Demo Checkout', icon: ShoppingBag, color: 'text-blue-400' },
    { id: 'portal', label: 'Customer Portal', icon: ExternalLink, color: 'text-purple-400' },
  ];

  // Secondary tools (grouped in sleek "Management & Tools" dropdown on desktop)
  const secondaryNavItems = [
    { id: 'policy', label: 'Policy Engine', desc: 'Deterministic refund rules & versioning', icon: Layers, color: 'text-emerald-400' },
    { id: 'paypal', label: 'PayPal Sandbox', desc: 'Orders v2 & verified refunds gateway', icon: CreditCard, color: 'text-sky-400' },
    { id: 'audit', label: 'Audit Log', desc: 'SHA-256 cryptographic tamper-evident ledger', icon: History, color: 'text-slate-400' },
    { id: 'team', label: 'Team & RBAC', desc: 'Role permissions & merchant access keys', icon: Users, color: 'text-indigo-400' },
    { id: 'docs', label: 'Architecture Docs', desc: 'Threat models, AI safety & payment flows', icon: BookOpen, color: 'text-amber-400' },
  ];

  // Check if current active tab is one of secondary tools
  const activeSecondaryItem = secondaryNavItems.find(
    (item) => item.id === activeTab
  );

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
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Zone 1: Brand & Mobile Hamburger Toggle */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5" />}
            </button>

            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center gap-2.5 text-left group focus:outline-none"
            >
              <div className="w-8 h-8 rounded-lg bg-[#0070BA] flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:bg-[#003087] transition-colors shrink-0">
                <Scale className="w-4 h-4" />
              </div>
              <div className="flex items-center">
                <span className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
                  FairResolve
                </span>
                <span className="hidden 2xl:inline-block ml-2 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Fintech Dispute Platform
                </span>
              </div>
            </button>
          </div>

          {/* Zone 2: Desktop Navigation Links (Responsive & Collision-Free) */}
          <nav className="hidden lg:flex items-center gap-1 text-xs font-medium">
            {primaryNavItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id || (item.id === 'cases' && activeTab === 'case-detail');
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-slate-800 text-white font-semibold shadow-inner'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${item.color || (isActive ? 'text-white' : 'text-slate-400')}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            {/* Management & Governance Tools Dropdown */}
            <div className="relative" ref={toolsDropdownRef}>
              <button
                onClick={() => setToolsMenuOpen(!toolsMenuOpen)}
                className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  activeSecondaryItem
                    ? 'bg-slate-800 text-blue-300 font-semibold shadow-inner border border-blue-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
                aria-expanded={toolsMenuOpen}
              >
                <Layers className={`w-3.5 h-3.5 ${activeSecondaryItem ? 'text-blue-400' : 'text-slate-400'}`} />
                <span>
                  {activeSecondaryItem ? activeSecondaryItem.label : 'Management & Tools'}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform text-slate-400 ${toolsMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {toolsMenuOpen && (
                <div className="absolute left-0 mt-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    Governance & Integrations
                  </div>
                  {secondaryNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id);
                          setToolsMenuOpen(false);
                        }}
                        className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 transition-colors ${
                          isActive
                            ? 'bg-slate-800/90 text-white'
                            : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                        }`}
                      >
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${item.color || 'text-slate-400'}`} />
                        <div>
                          <div className={`font-semibold ${isActive ? 'text-white' : 'text-slate-200'}`}>
                            {item.label}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            {item.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>

          {/* Zone 3: Account Profile & PayPal Status */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* PayPal Mode Status Text */}
            <div
              title={
                isSandboxConfigured
                  ? 'Authenticated with PayPal Sandbox Developer API'
                  : 'Running in demonstration sandbox simulation'
              }
              className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-400 border border-slate-800 bg-slate-950/80 px-2.5 py-1 rounded-md shrink-0"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${isSandboxConfigured ? 'bg-emerald-400' : 'bg-sky-400 animate-pulse'}`} />
              <span className="text-[10px] uppercase font-bold text-slate-400">PayPal:</span>
              <span className={isSandboxConfigured ? 'text-emerald-400 font-semibold' : 'text-sky-400 font-semibold'}>
                {isSandboxConfigured ? 'Live Sandbox' : 'Simulated'}
              </span>
            </div>

            {currentUser ? (
              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-750 pl-2.5 pr-2 py-1.5 rounded-lg border border-slate-700 transition-colors focus:outline-none shrink-0"
                  aria-expanded={userMenuOpen}
                >
                  <UserCheck className="w-3.5 h-3.5 text-[#0070BA] shrink-0" />
                  <div className="flex items-center gap-1.5 text-left">
                    <span className="text-xs text-white font-medium truncate max-w-[80px] sm:max-w-[120px]">
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
                  <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                </button>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150"
                  >
                    <div className="px-3.5 py-2.5 border-b border-slate-100">
                      <div className="font-semibold text-slate-900">{currentUser.name}</div>
                      <div className="font-mono text-[11px] text-slate-500 truncate">{currentUser.email}</div>
                      <div className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        <span>Role:</span>
                        <strong className="font-mono text-slate-800">{currentUser.role}</strong>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onOpenLoginModal();
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between text-slate-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-[#0070BA]" />
                        <span>Switch Persona / Role</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-rose-50 text-rose-600 flex items-center gap-2 border-t border-slate-100 transition-colors"
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
                className="px-3 py-1.5 bg-[#0070BA] hover:bg-[#003087] text-white text-xs font-semibold rounded-lg transition-colors shadow-sm shadow-blue-500/20 shrink-0"
              >
                Sign In / Demo
              </button>
            )}
          </div>
        </div>

        {/* Mobile & Tablet Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-3 border-t border-slate-800 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Primary Workflow Group */}
            <div>
              <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                Dispute Operations
              </div>
              <div className="space-y-1">
                {primaryNavItems.map((item) => {
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
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${item.color || 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Secondary Tools Group */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                Management & Governance
              </div>
              <div className="space-y-1">
                {secondaryNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors ${
                        isActive
                          ? 'bg-slate-800 text-white font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${item.color || 'text-slate-400'}`} />
                      <div>
                        <div className="text-white font-semibold">{item.label}</div>
                        <div className="text-[10px] text-slate-400">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile Footer Status & Persona Quick Action */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between px-2 text-xs">
              <div className="flex items-center gap-1.5 font-mono text-slate-400 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${isSandboxConfigured ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                <span>PayPal {isSandboxConfigured ? 'Live Sandbox' : 'Simulated'}</span>
              </div>
              {currentUser && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenLoginModal();
                  }}
                  className="text-blue-400 hover:text-blue-300 text-[11px] font-medium"
                >
                  Switch Persona →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
