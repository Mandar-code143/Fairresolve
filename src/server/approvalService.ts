/**
 * FairResolve Unified Refund Approval Service
 *
 * Implements centralized financial approval workflows:
 * - Deterministic policy evaluation verification
 * - Integer minor-unit (cents) validation
 * - Mandatory expiration dates
 * - Strict Four-Eyes separation of duties (approver !== executor)
 * - Anti-superseding approval state machine
 */

import crypto from 'crypto';
import { db } from './database';
import { policyEngine, toCents, toDollars } from './policyEngine';
import { Case, CaseEvent, Order, RefundApproval, RefundPolicy, User } from '../types';

export interface CreateApprovalParams {
  caseId: string;
  tenantId: string;
  approver: User;
  requestedAmount?: number;
  notes?: string;
  reason?: string;
}

export interface ApprovalValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
  executableAmountDollars?: number;
  executableAmountCents?: number;
  approval?: RefundApproval;
}

export class ApprovalService {
  /**
   * Create a validated refund approval for a case
   */
  public createRefundApproval(params: CreateApprovalParams): {
    approval: RefundApproval;
    case: Case;
    order: Order;
  } {
    const { caseId, tenantId, approver, requestedAmount, notes, reason } = params;

    const c = db.cases[caseId];
    if (!c || c.tenantId !== tenantId) {
      throw { statusCode: 404, message: 'Case not found' };
    }

    if (c.status === 'REFUNDED' || c.status === 'REJECTED' || c.status === 'CLOSED') {
      throw {
        statusCode: 400,
        message: `Cannot approve refund for case in terminal '${c.status}' status.`,
      };
    }

    const order = db.orders[c.orderId];
    if (!order || order.tenantId !== tenantId) {
      throw { statusCode: 404, message: 'Associated order not found' };
    }

    const refundableCents = toCents(order.refundableAmount);
    if (refundableCents <= 0) {
      throw {
        statusCode: 400,
        message: 'Order has no remaining refundable balance.',
      };
    }

    // Require fresh deterministic policy evaluation
    const tenantPolicies = db.policies[tenantId] || [];
    const activePolicy = tenantPolicies[tenantPolicies.length - 1];
    if (!activePolicy) {
      throw { statusCode: 500, message: 'No published refund policy found for tenant' };
    }

    const policyEval = policyEngine.evaluate(c, order, activePolicy);
    const evalId = `peval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    (policyEval as any).id = evalId;
    c.policyEvaluation = policyEval;

    // Determine approved amount
    let approvedAmountDollars: number;
    if (requestedAmount !== undefined && requestedAmount !== null) {
      approvedAmountDollars = parseFloat(requestedAmount.toString());
      if (isNaN(approvedAmountDollars) || approvedAmountDollars <= 0) {
        throw { statusCode: 400, message: 'Invalid approved refund amount requested' };
      }
    } else if (policyEval.eligible_amount !== null && policyEval.eligible_amount !== undefined && policyEval.eligible_amount > 0) {
      approvedAmountDollars = policyEval.eligible_amount;
    } else {
      approvedAmountDollars = order.refundableAmount;
    }

    const approvedAmountCents = toCents(approvedAmountDollars);
    if (approvedAmountCents <= 0) {
      throw { statusCode: 400, message: 'Approved refund amount must be greater than zero' };
    }

    if (approvedAmountCents > refundableCents) {
      throw {
        statusCode: 400,
        message: `Approved amount $${approvedAmountDollars.toFixed(2)} exceeds refundable balance $${order.refundableAmount.toFixed(2)}`,
      };
    }

    // If policy specified an eligible amount, approval cannot exceed it
    if (
      policyEval.eligible_amount !== null &&
      policyEval.eligible_amount !== undefined &&
      approvedAmountCents > toCents(policyEval.eligible_amount)
    ) {
      throw {
        statusCode: 400,
        message: `Approved amount $${approvedAmountDollars.toFixed(2)} exceeds policy-eligible ceiling $${policyEval.eligible_amount.toFixed(2)}`,
      };
    }

    // Invalidate/supersede any prior active approval
    if (c.activeApproval) {
      c.activeApproval.status = 'SUPERSEDED';
      if (db.refundApprovals[c.activeApproval.id]) {
        db.refundApprovals[c.activeApproval.id].status = 'SUPERSEDED';
      }
    }

    // Default expiration: 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const approval: RefundApproval = {
      id: `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      caseId: c.id,
      tenantId: c.tenantId,
      orderId: order.id,
      captureId: order.paypalCaptureId,
      authorizedBy: approver.id,
      authorizedByName: approver.name,
      authorizedByRole: approver.role,
      approvedAmount: approvedAmountDollars,
      approvedAmountCents,
      currency: order.currency,
      policyVersion: policyEval.policy_version || activePolicy.version,
      policyEvaluationId: evalId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt,
      reason: reason || 'Dispute resolution approved under merchant policy',
      notes: notes || reason || 'Merchant authorized dispute resolution awaiting execution',
    };

    db.refundApprovals[approval.id] = approval;
    c.activeApproval = approval;
    c.status = 'APPROVED_PENDING_REFUND';
    c.updatedAt = new Date().toISOString();

    if (db.isPostgresActive()) {
      db.savePolicyEvaluationPg(c.id, policyEval).catch((err) =>
        console.warn('[ApprovalService] PG savePolicyEvaluationPg error:', err.message)
      );
      db.saveRefundApprovalPg(approval).catch((err) =>
        console.warn('[ApprovalService] PG saveRefundApprovalPg error:', err.message)
      );
      db.saveCasePg(c).catch((err) =>
        console.warn('[ApprovalService] PG saveCasePg error:', err.message)
      );
    }

    const approveEvent: CaseEvent = {
      id: `ev-log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      caseId: c.id,
      eventType: 'REFUND_APPROVED',
      actor: { type: 'MERCHANT', id: approver.id, name: approver.name, role: approver.role },
      summary: `Refund of $${approvedAmountDollars.toFixed(2)} ${order.currency} approved by ${approver.name} (${approver.role}). Awaiting financial execution under Four-Eyes separation of duties.`,
      details: {
        approvalId: approval.id,
        approvedAmount: approvedAmountDollars,
        currency: order.currency,
        approverId: approver.id,
        policyVersion: approval.policyVersion,
        policyEvaluationId: evalId,
        expiresAt: approval.expiresAt,
      },
      timestamp: new Date().toISOString(),
    };

    c.timeline.push(approveEvent);
    db.appendAuditEvent(approveEvent);
    db.scheduleSave();

    return { approval, case: c, order };
  }

  /**
   * Revoke active refund approval
   */
  public revokeApproval(caseId: string, tenantId: string, user: User, reason?: string): Case {
    const c = db.cases[caseId];
    if (!c || c.tenantId !== tenantId) {
      throw { statusCode: 404, message: 'Case not found' };
    }

    if (c.activeApproval) {
      c.activeApproval.status = 'REVOKED';
      if (db.refundApprovals[c.activeApproval.id]) {
        db.refundApprovals[c.activeApproval.id].status = 'REVOKED';
      }
      if (db.isPostgresActive()) {
        db.saveRefundApprovalPg(c.activeApproval).catch((err) =>
          console.warn('[ApprovalService] PG saveRefundApprovalPg (REVOKED) error:', err.message)
        );
      }
    }

    c.status = 'REJECTED';
    c.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      db.saveCasePg(c).catch((err) =>
        console.warn('[ApprovalService] PG saveCasePg (REJECTED) error:', err.message)
      );
    }

    const revokeEvent: CaseEvent = {
      id: `ev-log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      caseId: c.id,
      eventType: 'MERCHANT_REVIEWED',
      actor: { type: 'MERCHANT', id: user.id, name: user.name, role: user.role },
      summary: `Refund approval revoked by ${user.name} (${user.role}). Case rejected.${reason ? ` Reason: ${reason}` : ''}`,
      details: { reason },
      timestamp: new Date().toISOString(),
    };

    c.timeline.push(revokeEvent);
    db.appendAuditEvent(revokeEvent);
    db.scheduleSave();

    return c;
  }

  /**
   * Strictly validate approval before financial execution release
   */
  public validateApprovalForExecution(
    c: Case,
    order: Order,
    executor: User,
    requestedAmount?: number
  ): ApprovalValidationResult {
    // 1. Strict status check: must be APPROVED_PENDING_REFUND
    if (c.status !== 'APPROVED_PENDING_REFUND') {
      return {
        valid: false,
        statusCode: 400,
        error: `Cannot refund case in '${c.status}' status. Merchant approval in 'APPROVED_PENDING_REFUND' status is required.`,
      };
    }

    // 2. Active approval record is mandatory - NO fallback to order.refundableAmount
    const approval = c.activeApproval;
    if (!approval) {
      return {
        valid: false,
        statusCode: 400,
        error: 'Execution blocked: No active refund approval found. Formal approval is required.',
      };
    }

    // 3. Status must be ACTIVE
    if (approval.status !== 'ACTIVE') {
      return {
        valid: false,
        statusCode: 400,
        error: `Active refund approval is in '${approval.status}' status. A fresh active approval is required.`,
      };
    }

    // 4. Expiration check
    if (approval.expiresAt && new Date(approval.expiresAt).getTime() <= Date.now()) {
      approval.status = 'EXPIRED';
      if (db.refundApprovals[approval.id]) {
        db.refundApprovals[approval.id].status = 'EXPIRED';
      }
      db.scheduleSave();
      if (db.isPostgresActive()) {
        db.saveRefundApprovalPg(approval).catch((err) =>
          console.warn('[ApprovalService] PG saveRefundApprovalPg (EXPIRED) error:', err.message)
        );
      }
      return {
        valid: false,
        statusCode: 400,
        error: 'Refund approval has expired. A fresh approval is required before execution.',
      };
    }

    // 5. Tenant, Case, Order, and Capture alignment
    if (approval.tenantId !== c.tenantId) {
      return { valid: false, statusCode: 403, error: 'Approval tenant mismatch.' };
    }
    if (approval.caseId !== c.id) {
      return { valid: false, statusCode: 400, error: 'Approval case ID mismatch.' };
    }
    if (approval.orderId !== order.id) {
      return { valid: false, statusCode: 400, error: 'Approval order ID mismatch.' };
    }
    if (approval.captureId !== order.paypalCaptureId) {
      return { valid: false, statusCode: 400, error: 'Approval capture ID mismatch.' };
    }
    if (approval.currency !== order.currency) {
      return { valid: false, statusCode: 400, error: 'Approval currency does not match order currency.' };
    }

    // 6. Strict Four-Eyes Separation of Duties: Approver cannot execute
    if (approval.authorizedBy === executor.id) {
      return {
        valid: false,
        statusCode: 403,
        error: 'Separation of duties violation: The approver cannot execute their own approved refund. Another authorized Owner or Admin must execute this transaction.',
      };
    }

    // 7. Executor Role check: must be OWNER or ADMIN
    if (executor.role !== 'OWNER' && executor.role !== 'ADMIN') {
      return {
        valid: false,
        statusCode: 403,
        error: 'Financial execution requires OWNER or ADMIN role.',
      };
    }

    // 8. Amount bounds checking
    const refundableCents = toCents(order.refundableAmount);
    if (refundableCents <= 0) {
      return {
        valid: false,
        statusCode: 400,
        error: 'Associated order has no remaining refundable balance.',
      };
    }

    const executionAmountDollars =
      requestedAmount !== undefined && requestedAmount !== null
        ? parseFloat(requestedAmount.toString())
        : approval.approvedAmount;

    if (isNaN(executionAmountDollars) || executionAmountDollars <= 0) {
      return {
        valid: false,
        statusCode: 400,
        error: 'Invalid execution amount requested.',
      };
    }

    const execAmountCents = toCents(executionAmountDollars);

    if (execAmountCents > approval.approvedAmountCents) {
      return {
        valid: false,
        statusCode: 400,
        error: `Requested execution amount $${executionAmountDollars.toFixed(2)} exceeds authorized approval amount $${approval.approvedAmount.toFixed(2)}.`,
      };
    }

    if (execAmountCents > refundableCents) {
      return {
        valid: false,
        statusCode: 400,
        error: `Requested refund $${executionAmountDollars.toFixed(2)} exceeds remaining refundable balance $${order.refundableAmount.toFixed(2)}.`,
      };
    }

    return {
      valid: true,
      executableAmountDollars: executionAmountDollars,
      executableAmountCents: execAmountCents,
      approval,
    };
  }
}

export const approvalService = new ApprovalService();
