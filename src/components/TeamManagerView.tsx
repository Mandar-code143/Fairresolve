import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Mail,
  Calendar,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  Trash2,
  Clock,
  Link,
} from 'lucide-react';
import { User, UserRole, MerchantInvitation } from '../types';
import { apiFetch } from '../utils/api';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

interface TeamManagerViewProps {
  currentUser: User | null;
}

export const TeamManagerView: React.FC<TeamManagerViewProps> = ({ currentUser }) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<MerchantInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('REVIEWER');

  const canInvite = currentUser && ['OWNER', 'ADMIN'].includes(currentUser.role);

  const fetchTeamAndInvitations = async () => {
    try {
      setLoading(true);
      const [membersRes, invitesRes] = await Promise.all([
        apiFetch('/api/v1/merchant/team'),
        apiFetch('/api/v1/merchant/team/invitations'),
      ]);

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
      }
      if (invitesRes.ok) {
        const data = await invitesRes.json();
        setInvitations(data.invitations || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch team members or invitations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamAndInvitations();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInvite) return;
    setInviting(true);
    setError(null);
    setGeneratedInviteLink(null);

    try {
      const res = await apiFetch('/api/v1/merchant/team/invite', {
        method: 'POST',
        body: JSON.stringify({ name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite team member');

      const fullLink = `${window.location.origin}${data.inviteLink}`;
      setGeneratedInviteLink(fullLink);
      setName('');
      setEmail('');
      fetchTeamAndInvitations();
    } catch (err: any) {
      setError(err.message || 'Invitation failed');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyLink = () => {
    if (!generatedInviteLink) return;
    navigator.clipboard.writeText(generatedInviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      const res = await apiFetch(`/api/v1/merchant/team/invitations/${invitationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchTeamAndInvitations();
      }
    } catch (err) {
      console.error('Revocation error:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Team Management & Role-Based Access Control (RBAC)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage authorized merchant operators, issue cryptographic invitation links, and enforce least-privilege boundaries.
          </p>
        </div>
      </div>

      {/* Grid: Members List & Invite Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Team Members & Pending Invites (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Members Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0070BA]" />
                <h2 className="text-sm font-bold text-slate-900">Active Organization Members</h2>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {members.length} {members.length === 1 ? 'Operator' : 'Operators'}
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0070BA]" />
                <p className="text-xs font-mono">Loading team records...</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-xs">
                        {member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">{member.name}</span>
                          {member.id === currentUser?.id && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-blue-600 border border-blue-200">
                              YOU
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono mt-0.5">
                          <Mail className="w-3 h-3 text-slate-400" />
                          <span>{member.email}</span>
                          <span>·</span>
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>Joined {new Date(member.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:self-center">
                      <span
                        className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-md border ${
                          member.role === 'OWNER'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : member.role === 'ADMIN'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : member.role === 'REVIEWER'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : member.role === 'ANALYST'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}
                      >
                        {member.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Invitations Card */}
          {invitations.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-900">Pending Invitations (Awaiting Acceptance)</h3>
                </div>
                <span className="text-xs font-mono text-slate-500">{invitations.length} Pending</span>
              </div>

              <div className="divide-y divide-slate-100">
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 font-mono">{inv.email}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Role: <span className="font-bold text-slate-700">{inv.role}</span> · Invited by {inv.invitedByName} · Expires{' '}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    {canInvite && (
                      <button
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1 font-medium"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Revoke Invite
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RBAC Privilege Matrix */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Enforced RBAC Privilege Matrix</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[580px] w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-mono">
                    <th className="py-2 pr-4 font-semibold">Capability</th>
                    <th className="py-2 px-2 text-center font-semibold">OWNER</th>
                    <th className="py-2 px-2 text-center font-semibold">ADMIN</th>
                    <th className="py-2 px-2 text-center font-semibold">REVIEWER</th>
                    <th className="py-2 px-2 text-center font-semibold">ANALYST</th>
                    <th className="py-2 px-2 text-center font-semibold">VIEWER</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="py-2.5 pr-4">Authorize & Execute PayPal Refunds</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Publish & Edit Store Refund Policies</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Execute AI Multimodal Investigation</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Upload & Fingerprint Evidence Files</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Invite Team Members & Grant Roles</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                    <td className="py-2.5 px-2 text-center font-mono text-rose-500 font-bold">NO</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4">Read-Only Audit Trail Inspection</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                    <td className="py-2.5 px-2 text-center font-mono text-emerald-600 font-bold">YES</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Invite New Operator Form */}
        <div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sticky top-24 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus className="w-4 h-4 text-[#0070BA]" />
              <h2 className="text-sm font-bold text-slate-900">Invite Team Member</h2>
            </div>

            {!canInvite ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                <p className="font-semibold">Restricted Action</p>
                <p>
                  Your current role (<span className="font-mono font-bold">{currentUser?.role}</span>) does not have permission to invite team members. Switch to OWNER or ADMIN persona to invite operators.
                </p>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {generatedInviteLink && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Invitation Link Generated!</span>
                    </div>
                    <p className="text-[11px] text-emerald-800">
                      Share this one-time link with the team member. They will choose their own password upon accepting.
                    </p>
                    <div className="flex items-center gap-2 bg-white p-2 rounded border border-emerald-200">
                      <span className="font-mono text-[10px] text-slate-600 truncate flex-1">
                        {generatedInviteLink}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="px-2.5 py-1 bg-[#0070BA] text-white rounded text-[11px] font-semibold flex items-center gap-1 shrink-0"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Morgan Bailey"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="m.bailey@apex-audio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0070BA] bg-white"
                  >
                    <option value="ADMIN">ADMIN (Full policy & refund authority)</option>
                    <option value="REVIEWER">REVIEWER (Case review & refund execution)</option>
                    <option value="ANALYST">ANALYST (Evidence investigation only)</option>
                    <option value="VIEWER">VIEWER (Read-only dispute audit)</option>
                  </select>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={inviting}
                    className="w-full py-2.5 px-4 bg-[#0070BA] hover:bg-[#003087] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:bg-slate-400 shadow-sm"
                  >
                    {inviting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating Invitation...
                      </>
                    ) : (
                      <>
                        <Link className="w-4 h-4" />
                        Generate Secure Invitation Link
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
