/**
 * FairResolve Durable Transactional Outbox Background Worker
 *
 * Provides resilient, asynchronous background event processing:
 * - Lease lock mechanism prevents duplicate processing across instances.
 * - Exponential backoff with retry limit and dead-letter state.
 * - Outbox tasks: AI investigation processing, webhook delivery, audit chain verification,
 *   and invitation lifecycle sweeps.
 */

import crypto from 'crypto';
import { db, OutboxEvent } from './database';
import { geminiService } from './geminiService';
import { policyEngine, toCents, toDollars } from './policyEngine';
import { paypalGateway } from './paypalGateway';
import { CaseEvent } from '../types';

export interface EnqueueOutboxOptions {
  eventType: string;
  tenantId: string;
  payload: Record<string, any>;
  runAfterSeconds?: number;
}

export class BackgroundWorker {
  private isRunning: boolean = false;
  private pollIntervalMs: number = 3000;
  private timer?: NodeJS.Timeout;
  private workerId: string = `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  /**
   * Enqueue a new event into the transactional outbox
   */
  public enqueue(options: EnqueueOutboxOptions): OutboxEvent {
    const event: OutboxEvent = {
      id: `obx-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      eventType: options.eventType,
      tenantId: options.tenantId,
      payload: options.payload,
      status: 'PENDING',
      attempts: 0,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: options.runAfterSeconds
        ? new Date(Date.now() + options.runAfterSeconds * 1000).toISOString()
        : new Date().toISOString(),
    };

    db.outbox.push(event);
    db.scheduleSave();
    return event;
  }

  /**
   * Start the background worker polling loop
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Worker] FairResolve Background Worker started (${this.workerId})`);
    this.scheduleNextPoll(1000);
  }

  /**
   * Graceful stop
   */
  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    console.log(`[Worker] FairResolve Background Worker stopped`);
  }

  private scheduleNextPoll(delayMs: number = this.pollIntervalMs) {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        await this.pollAndProcess();
      } catch (err) {
        console.error('[Worker] Unexpected error during outbox cycle:', err);
      } finally {
        this.scheduleNextPoll();
      }
    }, delayMs);
  }

  /**
   * Poll eligible outbox items and execute
   */
  public async pollAndProcess(): Promise<number> {
    const now = new Date();
    const candidate = db.outbox.find((item) => {
      if (item.status === 'COMPLETED' || item.status === 'FAILED') return false;
      if (item.status === 'PROCESSING') {
        // Lease timeout: 60 seconds
        const leaseExpired =
          item.lockedAt && now.getTime() - new Date(item.lockedAt).getTime() > 60000;
        return leaseExpired;
      }
      // PENDING or RETRY
      const attemptDue = !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now;
      return attemptDue;
    });

    if (!candidate) return 0;

    // Acquire lease
    candidate.status = 'PROCESSING';
    candidate.lockedAt = now.toISOString();
    candidate.lockedBy = this.workerId;
    candidate.attempts = (candidate.attempts || 0) + 1;
    db.scheduleSave();

    try {
      await this.processEvent(candidate);
      candidate.status = 'COMPLETED';
      candidate.processedAt = new Date().toISOString();
      candidate.lastError = undefined;
    } catch (err: any) {
      console.warn(`[Worker] Task ${candidate.id} (${candidate.eventType}) attempt ${candidate.attempts} failed:`, err.message);
      if (candidate.attempts >= 5) {
        candidate.status = 'FAILED';
        candidate.lastError = `Exceeded max 5 attempts. Last error: ${err.message}`;
      } else {
        candidate.status = 'PENDING';
        candidate.lastError = err.message;
        const backoffSeconds = Math.min(300, Math.pow(2, candidate.attempts) * 2);
        candidate.nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
      }
    } finally {
      candidate.lockedAt = undefined;
      candidate.lockedBy = undefined;
      db.scheduleSave();
    }

    return 1;
  }

  private async processEvent(event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
      case 'ASYNC_AI_INVESTIGATION': {
        const { caseId } = event.payload;
        const c = db.cases[caseId];
        if (!c) throw new Error(`Case ${caseId} not found`);

        const order = db.orders[c.orderId];
        if (!order) throw new Error(`Order ${c.orderId} not found`);

        const policies = db.policies[c.tenantId] || [];
        const policy = policies[policies.length - 1];
        if (!policy) throw new Error(`Policy not configured for tenant ${c.tenantId}`);

        const imagesBase64 = c.evidence
          .filter((e) => e.thumbnailBase64 && e.thumbnailBase64.includes('base64,'))
          .map((e) => ({
            mimeType: e.mimeType,
            data: e.thumbnailBase64!.split('base64,')[1],
            filename: e.originalFilename,
          }));

        const aiResult = await geminiService.runInvestigation({
          issueType: c.issueType,
          customerClaim: c.customerDescription,
          orderNumber: c.orderNumber,
          itemsOrdered: order.items.map((i) => ({ name: i.name, sku: i.sku, quantity: i.quantity })),
          policy,
          imagesBase64,
        });

        c.aiInvestigation = aiResult;
        const policyResult = policyEngine.evaluate(c, order, policy);
        c.policyEvaluation = policyResult;

        if (policyResult.result === 'ELIGIBLE_FOR_MERCHANT_REVIEW') {
          c.status = 'READY_FOR_REVIEW';
        } else if (policyResult.result === 'MORE_INFORMATION_REQUIRED') {
          c.status = 'NEEDS_MORE_INFORMATION';
        } else if (policyResult.result === 'MANUAL_REVIEW_REQUIRED') {
          c.status = 'ESCALATED';
        }

        c.updatedAt = new Date().toISOString();

        const timelineEvent: CaseEvent = {
          id: `ev-log-${Date.now()}`,
          caseId: c.id,
          eventType: 'AI_INVESTIGATION_COMPLETED',
          actor: { type: 'AI_ENGINE', name: aiResult.model_used },
          summary: `Asynchronous AI investigation completed. Policy outcome: ${policyResult.result}`,
          details: { aiResult, policyResult },
          timestamp: new Date().toISOString(),
        };
        c.timeline.push(timelineEvent);
        db.appendAuditEvent(timelineEvent);
        break;
      }

      case 'AUDIT_CHAIN_INTEGRITY_CHECK': {
        const verification = db.verifyAuditChainIntegrity();
        if (!verification.isValid) {
          console.error(
            `[Worker] CRITICAL AUDIT ALERT: Chain compromised at index ${verification.brokenAtIndex}!`
          );
        }
        break;
      }

      case 'INVITATION_EXPIRY_SWEEP': {
        const now = new Date();
        for (const inv of Object.values(db.invitations)) {
          if (inv.status === 'PENDING' && new Date(inv.expiresAt) < now) {
            inv.status = 'EXPIRED';
          }
        }
        break;
      }

      case 'RECONCILE_PENDING_REFUND': {
        const { caseId, refundAttemptId, captureId, idempotencyKey } = event.payload;
        const c = db.cases[caseId];
        if (!c) throw new Error(`Case ${caseId} not found for refund reconciliation`);

        const order = db.orders[c.orderId];
        if (!order) throw new Error(`Order ${c.orderId} not found for refund reconciliation`);

        const attempt = c.refundAttempts.find((a) => a.id === refundAttemptId || a.idempotencyKey === idempotencyKey);
        if (!attempt) throw new Error(`Refund attempt ${refundAttemptId} not found for reconciliation`);

        // If already resolved, nothing to reconcile
        if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
          break;
        }

        try {
          if (!attempt.paypalRefundId) {
            // CRITICAL FINTECH GUARD: A completed capture does NOT prove that a refund occurred.
            // Never infer refund completion from capture status.
            attempt.status = 'RECONCILIATION_REQUIRED';
            attempt.errorMessage = 'Reconciliation blocked: Capture details do not confirm refund completion. A genuine PayPal refund ID or verified webhook event is required.';
            c.status = 'REFUND_PENDING';
            c.updatedAt = new Date().toISOString();
            db.scheduleSave();
            throw new Error(`Refund attempt ${attempt.id} missing PayPal refund ID. Capture completion does not prove refund completion.`);
          }

          // Fetch genuine PayPal refund details
          const refundDetails = await paypalGateway.getRefund(attempt.paypalRefundId);

          if (refundDetails.isSimulated) {
            // Labeled simulation path
            attempt.status = 'SUCCEEDED';
            attempt.completedAt = new Date().toISOString();
            attempt.isSimulated = true;

            if (c.activeApproval) {
              c.activeApproval.status = 'CONSUMED';
              if (db.refundApprovals[c.activeApproval.id]) {
                db.refundApprovals[c.activeApproval.id].status = 'CONSUMED';
              }
            }

            const reqCents = attempt.amountCents || toCents(attempt.amount);
            const newRefundedCents = toCents(order.refundedAmount) + reqCents;
            const grossCents = toCents(order.grossAmount);
            const newRefundableCents = Math.max(0, grossCents - newRefundedCents);

            order.refundedAmount = toDollars(newRefundedCents);
            order.refundableAmount = toDollars(newRefundableCents);
            order.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.updatedAt = new Date().toISOString();

            const reconSuccessEvent: CaseEvent = {
              id: `ev-log-${Date.now()}`,
              caseId: c.id,
              eventType: 'REFUND_RECONCILED',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler (Simulated)' },
              summary: `Reconciled simulated refund attempt ${attempt.id}. Verified simulated settlement.`,
              details: { refundAttemptId: attempt.id, status: 'SUCCEEDED', isSimulated: true },
              timestamp: new Date().toISOString(),
            };
            c.timeline.push(reconSuccessEvent);
            db.appendAuditEvent(reconSuccessEvent);
            db.scheduleSave();
            break;
          }

          // Live Sandbox PayPal refund validation
          if (refundDetails.status === 'COMPLETED') {
            // Validate refund ID and currency/amount if returned
            if (refundDetails.id !== attempt.paypalRefundId) {
              throw new Error(`Refund ID mismatch during reconciliation: expected ${attempt.paypalRefundId}, got ${refundDetails.id}`);
            }

            attempt.status = 'SUCCEEDED';
            attempt.completedAt = new Date().toISOString();
            attempt.paypalResponse = refundDetails.rawResponse;

            if (c.activeApproval) {
              c.activeApproval.status = 'CONSUMED';
              if (db.refundApprovals[c.activeApproval.id]) {
                db.refundApprovals[c.activeApproval.id].status = 'CONSUMED';
              }
            }

            const reqCents = attempt.amountCents || toCents(attempt.amount);
            const newRefundedCents = toCents(order.refundedAmount) + reqCents;
            const grossCents = toCents(order.grossAmount);
            const newRefundableCents = Math.max(0, grossCents - newRefundedCents);

            order.refundedAmount = toDollars(newRefundedCents);
            order.refundableAmount = toDollars(newRefundableCents);
            order.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.updatedAt = new Date().toISOString();

            const reconSuccessEvent: CaseEvent = {
              id: `ev-log-${Date.now()}`,
              caseId: c.id,
              eventType: 'REFUND_RECONCILED',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Reconciled uncertain refund attempt ${attempt.id}. Genuine PayPal refund confirmed COMPLETED (${refundDetails.id}).`,
              details: { refundAttemptId: attempt.id, paypalRefundId: refundDetails.id, status: 'SUCCEEDED' },
              timestamp: new Date().toISOString(),
            };
            c.timeline.push(reconSuccessEvent);
            db.appendAuditEvent(reconSuccessEvent);
            db.scheduleSave();
          } else if (refundDetails.status === 'FAILED' || refundDetails.status === 'CANCELLED') {
            attempt.status = 'FAILED';
            attempt.errorMessage = `PayPal reported terminal refund failure with status: ${refundDetails.status}`;
            c.status = 'REFUND_FAILED';
            c.updatedAt = new Date().toISOString();

            const failEvent: CaseEvent = {
              id: `ev-log-${Date.now()}`,
              caseId: c.id,
              eventType: 'REFUND_FAILED',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Reconciled refund attempt ${attempt.id}. PayPal confirmed terminal failure (${refundDetails.status}).`,
              details: { refundAttemptId: attempt.id, paypalRefundId: refundDetails.id, status: refundDetails.status },
              timestamp: new Date().toISOString(),
            };
            c.timeline.push(failEvent);
            db.appendAuditEvent(failEvent);
            db.scheduleSave();
          } else {
            // PENDING or UNKNOWN: Maintain pending, do NOT decrement balance
            attempt.status = 'PENDING';
            c.status = 'REFUND_PENDING';
            c.updatedAt = new Date().toISOString();
            db.scheduleSave();
            throw new Error(`PayPal refund ${attempt.paypalRefundId} is still pending settlement (status: ${refundDetails.status})`);
          }
        } catch (gatewayErr: any) {
          if ((event.attempts || 0) >= 4) {
            attempt.status = 'RECONCILIATION_REQUIRED';
            c.status = 'REFUND_UNKNOWN';
            c.updatedAt = new Date().toISOString();
            db.scheduleSave();
          }
          throw gatewayErr;
        }
        break;
      }

      default:
        throw new Error(`Unsupported or unknown outbox event type: ${event.eventType}`);
    }
  }
}

export const backgroundWorker = new BackgroundWorker();
