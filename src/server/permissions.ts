/**
 * FairResolve Centralized Role-Based Access Control & Permission Engine
 *
 * Implements granular permission evaluation, 4-eyes financial control rules,
 * case assignment scope checks, and server-side response serialization/redaction.
 */

import { UserRole, Case, EvidenceObject } from '../types';

export type Permission =
  | 'dashboard.view'
  | 'cases.view'
  | 'cases.view_assigned'
  | 'cases.create'
  | 'cases.update'
  | 'cases.assign'
  | 'cases.comment'
  | 'cases.investigate'
  | 'cases.request_information'
  | 'cases.approve'
  | 'cases.reject'
  | 'evidence.view_metadata'
  | 'evidence.view_private'
  | 'evidence.download'
  | 'customer.pii.view'
  | 'team.view'
  | 'team.invite'
  | 'team.manage'
  | 'policy.view'
  | 'policy.manage'
  | 'integration.view'
  | 'integration.manage'
  | 'refund.approve'
  | 'refund.execute'
  | 'audit.view'
  | 'audit.export'
  | 'reports.view';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    'dashboard.view',
    'cases.view',
    'cases.view_assigned',
    'cases.create',
    'cases.update',
    'cases.assign',
    'cases.comment',
    'cases.investigate',
    'cases.request_information',
    'cases.approve',
    'cases.reject',
    'evidence.view_metadata',
    'evidence.view_private',
    'evidence.download',
    'customer.pii.view',
    'team.view',
    'team.invite',
    'team.manage',
    'policy.view',
    'policy.manage',
    'integration.view',
    'integration.manage',
    'refund.approve',
    'refund.execute',
    'audit.view',
    'audit.export',
    'reports.view',
  ],
  ADMIN: [
    'dashboard.view',
    'cases.view',
    'cases.view_assigned',
    'cases.create',
    'cases.update',
    'cases.assign',
    'cases.comment',
    'cases.investigate',
    'cases.request_information',
    'cases.reject',
    'evidence.view_metadata',
    'evidence.view_private',
    'evidence.download',
    'customer.pii.view',
    'team.view',
    'team.invite',
    'team.manage',
    'policy.view',
    'policy.manage',
    'integration.view',
    'integration.manage',
    'refund.execute', // Can execute refunds approved by others
    'audit.view',
    'audit.export',
    'reports.view',
  ],
  REVIEWER: [
    'dashboard.view',
    'cases.view',
    'cases.view_assigned',
    'cases.update',
    'cases.assign',
    'cases.comment',
    'cases.investigate',
    'cases.request_information',
    'cases.approve', // Can approve refund recommendations
    'cases.reject',
    'evidence.view_metadata',
    'evidence.view_private',
    'evidence.download',
    'customer.pii.view',
    'team.view',
    'policy.view',
    'refund.approve',
    'audit.view',
    'reports.view',
  ],
  ANALYST: [
    'dashboard.view',
    'cases.view_assigned',
    'cases.comment',
    'cases.investigate',
    'cases.request_information',
    'evidence.view_metadata',
    'evidence.view_private',
    'evidence.download',
    'team.view',
    'policy.view',
    'audit.view',
  ],
  VIEWER: [
    'dashboard.view',
    'cases.view',
    'evidence.view_metadata',
    'team.view',
    'policy.view',
    'audit.view',
    'reports.view',
  ],
};

export class PermissionService {
  /**
   * Check if a role possesses a specific permission
   */
  public hasPermission(role: UserRole, permission: Permission): boolean {
    const list = ROLE_PERMISSIONS[role] || [];
    return list.includes(permission);
  }

  /**
   * Check if an actor can view a specific case given role & assignments
   */
  public canAccessCase(user: { id: string; role: UserRole }, c: Case): boolean {
    if (user.role === 'OWNER' || user.role === 'ADMIN' || user.role === 'REVIEWER') {
      return true;
    }
    if (user.role === 'VIEWER') {
      return true; // Receives redacted view
    }
    if (user.role === 'ANALYST') {
      // Analysts can only view cases assigned to them or unassigned cases in queue
      return !c.assignedTo || c.assignedTo === user.id;
    }
    return false;
  }

  /**
   * Mask Customer Name for privacy
   */
  public maskCustomerName(name: string): string {
    if (!name) return 'Customer';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase() + '***';
    }
    return parts[0].charAt(0).toUpperCase() + '*** ' + parts[parts.length - 1].charAt(0).toUpperCase() + '***';
  }

  /**
   * Mask Customer Email for privacy
   */
  public maskCustomerEmail(email: string): string {
    if (!email || !email.includes('@')) return 'customer@***.com';
    const [local, domain] = email.split('@');
    const maskedLocal = local.length > 2 ? local.substring(0, 2) + '***' : local.charAt(0) + '***';
    const maskedDomain = domain.length > 4 ? domain.substring(0, 2) + '***.' + domain.split('.').pop() : '***.com';
    return `${maskedLocal}@${maskedDomain}`;
  }

  /**
   * Serialize and redact case data based on user role and permissions
   */
  public serializeCase(c: Case, user: { id: string; role: UserRole }): Case {
    const cloned: Case = JSON.parse(JSON.stringify(c));

    if (user.role === 'VIEWER') {
      // 1. Redact customer PII
      cloned.customerName = this.maskCustomerName(c.customerName);
      cloned.customerEmail = this.maskCustomerEmail(c.customerEmail);
      cloned.customerAccessToken = ''; // Never exposed to viewers
      cloned.merchantNotes = undefined;

      // 2. Redact private evidence binaries
      cloned.evidence = (c.evidence || []).map((e: EvidenceObject) => ({
        ...e,
        downloadUrl: '', // Viewers cannot download private evidence files
        thumbnailBase64: undefined,
      }));
    } else if (user.role === 'ANALYST') {
      // Analysts do not need customer portal submission tokens
      cloned.customerAccessToken = '';

      // If viewing unassigned case or assigned case, evidence is accessible
      if (c.assignedTo && c.assignedTo !== user.id) {
        cloned.customerName = this.maskCustomerName(c.customerName);
        cloned.customerEmail = this.maskCustomerEmail(c.customerEmail);
      }
    }

    return cloned;
  }
}

export const permissionService = new PermissionService();
