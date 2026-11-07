import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, ShieldCheck, Mail, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import { User, UserRole } from '../types';
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
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('REVIEWER');

  const canInvite = currentUser && ['OWNER', 'ADMIN'].includes(currentUser.role);

  const fetchTeam = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/v1/merchant/team');
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canInvite) return;
    setInviting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch('/api/v1/merchant/team/invite', {
        method: 'POST',
        body: JSON.stringify({ name, email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite team member');

      setSuccessMsg(`Successfully invited ${name} as ${role}!`);
      setName('');
      setEmail('');
      fetchTeam();
    } catch (err: any) {
      setError(err.message || 'Invitation failed');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Team & Role-Based Access Control (RBAC)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Manage authorized merchant operators, review privilege boundaries, and enforce the principle of least privilege.
          </p>
        </div>
      </div>

      {/* Grid: Members List & Invite Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Team Members (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">Organization Members</h2>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {members.length} Active {members.length === 1 ? 'Operator' : 'Operators'}
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
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
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : member.role === 'ADMIN'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
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

          {/* RBAC Privilege Matrix */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Enforced RBAC Privilege Matrix</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sticky top-24">
            <div className="flex items-center gap-2 mb-4">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900">Invite Team Member</h2>
            </div>

            {!canInvite ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                <p className="font-semibold">Restricted Action</p>
                <p>
                  Your current role (<span className="font-mono font-bold">{currentUser?.role}</span>) does not have permission to invite team members. Switch to OWNER or ADMIN to invite operators.
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
                {successMsg && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>{successMsg}</span>
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:bg-slate-400"
                  >
                    {inviting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating Credentials...
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        Issue Credentials & Invite
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
