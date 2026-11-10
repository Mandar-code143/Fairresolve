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
  private inFlightPoll: Promise<number> | null = null;
  private workerId: string = `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Enqueue a new event into the transactional outbox
   */
  public async enqueue(options: EnqueueOutboxOptions): Promise<OutboxEvent> {
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

    if (db.isPostgresActive()) {
      await db.enqueueOutboxPg(event);
    }

    db.outbox.push(event);
    db.scheduleSave();
    return event;
  }

  /**
   * Start the background worker polling loop (idempotent — prevents duplicate loops)
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
      this.timer = undefined;
    }
    console.log(`[Worker] FairResolve Background Worker stopped`);
  }

  public async stopAndWait(): Promise<void> {
    this.stop();
    if (this.inFlightPoll) {
      await this.inFlightPoll.catch(() => {});
    }
  }

  private scheduleNextPoll(delayMs: number = this.pollIntervalMs) {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        this.inFlightPoll = this.pollAndProcess();
        await this.inFlightPoll;
      } catch (err) {
        console.error('[Worker] Unexpected error during outbox cycle:', err);
      } finally {
        this.inFlightPoll = null;
        this.scheduleNextPoll();
      }
    }, delayMs);
  }

  /**
   * Poll eligible outbox items and execute
   */
  public async pollAndProcess(): Promise<number> {
    if (db.isPostgresActive() && db.getPgPool()) {
      const pool = db.getPgPool()!;
      const client = await pool.connect();
      let candidateRow: any = null;
      try {
        await client.query('BEGIN');
        const selectRes = await client.query(
          `SELECT id, tenant_id, event_type, payload, status, retry_count, max_retries, attempts, next_attempt_at, locked_at, locked_by
           FROM outbox_events
           WHERE (status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP)
              OR (status = 'PROCESSING' AND locked_at < NOW() - INTERVAL '60 seconds')
           ORDER BY next_attempt_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`
        );

        if (selectRes.rows.length === 0) {
          await client.query('COMMIT');
          return 0;
        }

        candidateRow = selectRes.rows[0];
        const newAttempts = (candidateRow.attempts || 0) + 1;
        await client.query(
          `UPDATE outbox_events
           SET status = 'PROCESSING',
               locked_at = CURRENT_TIMESTAMP,
               locked_by = $1,
               attempts = $2
           WHERE id = $3`,
          [this.workerId, newAttempts, candidateRow.id]
        );
        await client.query('COMMIT');
        candidateRow.attempts = newAttempts;
      } catch (claimErr: any) {
        await client.query('ROLLBACK');
        console.warn('[Worker] Lease lock acquisition error:', claimErr.message);
        return 0;
      } finally {
        client.release();
      }

      const event: OutboxEvent = {
        id: candidateRow.id,
        eventType: candidateRow.event_type,
        tenantId: candidateRow.tenant_id,
        payload: typeof candidateRow.payload === 'string' ? JSON.parse(candidateRow.payload) : candidateRow.payload,
        status: 'PROCESSING',
        attempts: candidateRow.attempts,
        retryCount: candidateRow.retry_count || 0,
        createdAt: candidateRow.created_at ? new Date(candidateRow.created_at).toISOString() : new Date().toISOString(),
      };

      const memEvent = db.outbox.find((o) => o.id === event.id);
      if (memEvent) {
        memEvent.status = 'PROCESSING';
        memEvent.attempts = event.attempts;
        memEvent.lockedAt = new Date().toISOString();
        memEvent.lockedBy = this.workerId;
      }

      try {
        await this.processEvent(event);
        await pool.query(
          `UPDATE outbox_events
           SET status = 'COMPLETED',
               processed_at = CURRENT_TIMESTAMP,
               locked_at = NULL,
               locked_by = NULL,
               last_error = NULL
           WHERE id = $1`,
          [event.id]
        );
        if (memEvent) {
          memEvent.status = 'COMPLETED';
          memEvent.processedAt = new Date().toISOString();
          memEvent.lastError = undefined;
        }
      } catch (err: any) {
        console.warn(`[Worker] Task ${event.id} (${event.eventType}) attempt ${event.attempts} failed:`, err.message);
        if ((event.attempts || 0) >= 5) {
          await pool.query(
            `UPDATE outbox_events
             SET status = 'FAILED',
                 locked_at = NULL,
                 locked_by = NULL,
                 last_error = $1
             WHERE id = $2`,
            [`Exceeded max 5 attempts. Last error: ${err.message}`, event.id]
          );
          if (memEvent) {
            memEvent.status = 'FAILED';
            memEvent.lastError = `Exceeded max 5 attempts. Last error: ${err.message}`;
          }
        } else {
          const backoffSeconds = Math.min(300, Math.pow(2, event.attempts || 1) * 2);
          const nextTime = new Date(Date.now() + backoffSeconds * 1000);
          await pool.query(
            `UPDATE outbox_events
             SET status = 'PENDING',
                 locked_at = NULL,
                 locked_by = NULL,
                 next_attempt_at = $1,
                 last_error = $2
             WHERE id = $3`,
            [nextTime, err.message, event.id]
          );
          if (memEvent) {
            memEvent.status = 'PENDING';
            memEvent.nextAttemptAt = nextTime.toISOString();
            memEvent.lastError = err.message;
          }
        }
      }

      return 1;
    }

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
        if (db.isPostgresActive()) {
          await db.saveAiRunPg(c.id, aiResult);
          await db.savePolicyEvaluationPg(c.id, policyResult);
          await db.saveCasePg(c);
        }
        db.scheduleSave();
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
        let expiredCount = 0;
        for (const inv of Object.values(db.invitations)) {
          if (inv.status === 'PENDING' && new Date(inv.expiresAt) < now) {
            inv.status = 'EXPIRED';
            expiredCount++;
            if (db.isPostgresActive()) {
              await db.saveInvitationPg(inv);
            }
          }
        }
        if (expiredCount > 0) {
          db.scheduleSave();
        }
        break;
      }

      case 'PAYPAL_WEBHOOK_EVENT': {
        const { webhookEventId, webhookEventType, resource } = event.payload || {};
        if (webhookEventType === 'PAYMENT.CAPTURE.REFUNDED' && resource?.id) {
          const paypalRefundId = String(resource.id);
          const matchingAttempt = Object.values(db.refundAttempts).find(
            (a) => a.paypalRefundId === paypalRefundId
          ) || Object.values(db.cases)
            .flatMap((cs) => cs.refundAttempts)
            .find((a) => a.paypalRefundId === paypalRefundId);

          if (matchingAttempt && matchingAttempt.status !== 'SUCCEEDED' && resource.status === 'COMPLETED') {
            const expectedCents = matchingAttempt.amountCents ?? toCents(matchingAttempt.amount);
            const webhookCents = resource.amount?.value !== undefined
              ? toCents(parseFloat(resource.amount.value))
              : expectedCents;
            const webhookCurrency = resource.amount?.currency_code
              ? String(resource.amount.currency_code).toUpperCase()
              : matchingAttempt.currency.toUpperCase();

            if (webhookCents === expectedCents && webhookCurrency === matchingAttempt.currency.toUpperCase()) {
              await db.finalizeRefundTransaction({
                attemptId: matchingAttempt.id,
                outcome: 'SUCCEEDED',
                paypalRefundId,
                paypalResponse: resource,
                isSimulated: paypalRefundId.startsWith('SIM-'),
                actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Webhook Reconciler' },
                summary: `Webhook ${webhookEventId || ''} confirmed refund ${paypalRefundId} COMPLETED.`,
                eventType: 'REFUND_RECONCILED',
                eventDetails: {
                  refundAttemptId: matchingAttempt.id,
                  paypalRefundId,
                  webhookEventId,
                  webhookEventType,
                  status: 'SUCCEEDED',
                },
              });
            } else {
              await db.finalizeRefundTransaction({
                attemptId: matchingAttempt.id,
                outcome: 'RECONCILIATION_REQUIRED',
                paypalRefundId,
                paypalResponse: resource,
                errorMessage: `Webhook amount/currency mismatch for refund ${paypalRefundId}.`,
                caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
                actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Webhook Reconciler' },
                summary: `Webhook ${webhookEventId || ''} flagged amount/currency mismatch for refund ${paypalRefundId}.`,
                eventType: 'REFUND_RECONCILIATION_REQUIRED',
                eventDetails: {
                  refundAttemptId: matchingAttempt.id,
                  paypalRefundId,
                  webhookEventId,
                  webhookEventType,
                },
              });
            }
          }
        }
        break;
      }

      case 'RECONCILE_PENDING_REFUND': {
        const { caseId, refundAttemptId, idempotencyKey } = event.payload;
        const c = db.cases[caseId];
        if (!c) throw new Error(`Case ${caseId} not found for refund reconciliation`);

        const order = db.orders[c.orderId];
        if (!order) throw new Error(`Order ${c.orderId} not found for refund reconciliation`);

        const attempt =
          db.refundAttempts[refundAttemptId] ||
          c.refundAttempts.find((a) => a.id === refundAttemptId || a.idempotencyKey === idempotencyKey);
        if (!attempt) throw new Error(`Refund attempt ${refundAttemptId} not found for reconciliation`);

        // If already resolved, nothing to reconcile
        if (attempt.status === 'SUCCEEDED' || attempt.status === 'FAILED') {
          break;
        }

        try {
          if (!attempt.paypalRefundId) {
            // CRITICAL FINTECH GUARD: A completed capture does NOT prove that a refund occurred.
            // Never infer refund completion from capture status.
            const missingMsg =
              'Reconciliation blocked: Capture details do not confirm refund completion. A genuine PayPal refund ID or verified webhook event is required.';
            await db.finalizeRefundTransaction({
              attemptId: attempt.id,
              outcome: 'RECONCILIATION_REQUIRED',
              errorMessage: missingMsg,
              caseStatusOnNonSuccess: 'REFUND_PENDING',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Reconciliation blocked for attempt ${attempt.id}: missing PayPal refund ID.`,
              eventType: 'REFUND_RECONCILIATION_BLOCKED',
              eventDetails: { refundAttemptId: attempt.id, status: 'RECONCILIATION_REQUIRED' },
            });
            throw new Error(
              `Refund attempt ${attempt.id} missing PayPal refund ID. Capture completion does not prove refund completion.`
            );
          }

          // Fetch PayPal refund details (pass expected amount/currency for consistent simulation verification)
          const refundDetails = await paypalGateway.getRefund(attempt.paypalRefundId, {
            amount: attempt.amount,
            currency: attempt.currency,
          });

          if (refundDetails.status === 'COMPLETED') {
            // Validate refund ID, amount (integer cents), and currency strictly before finalizing
            if (refundDetails.id !== attempt.paypalRefundId) {
              const mismatchMsg = `Refund ID mismatch during reconciliation: expected ${attempt.paypalRefundId}, got ${refundDetails.id}`;
              await db.finalizeRefundTransaction({
                attemptId: attempt.id,
                outcome: 'RECONCILIATION_REQUIRED',
                errorMessage: mismatchMsg,
                caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
                actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
                summary: mismatchMsg,
                eventType: 'REFUND_RECONCILIATION_REQUIRED',
                eventDetails: { refundAttemptId: attempt.id, expectedId: attempt.paypalRefundId, actualId: refundDetails.id },
              });
              throw new Error(mismatchMsg);
            }

            const expectedCents = attempt.amountCents ?? toCents(attempt.amount);
            if (refundDetails.amount?.value !== undefined) {
              const returnedCents = toCents(parseFloat(refundDetails.amount.value));
              if (!Number.isFinite(returnedCents) || returnedCents !== expectedCents) {
                const amountMsg = `Refund amount mismatch during reconciliation: expected ${expectedCents} cents, got ${returnedCents} cents`;
                await db.finalizeRefundTransaction({
                  attemptId: attempt.id,
                  outcome: 'RECONCILIATION_REQUIRED',
                  paypalRefundId: refundDetails.id,
                  paypalResponse: refundDetails.rawResponse,
                  errorMessage: amountMsg,
                  caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
                  actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
                  summary: amountMsg,
                  eventType: 'REFUND_RECONCILIATION_REQUIRED',
                  eventDetails: { refundAttemptId: attempt.id, expectedCents, returnedCents },
                });
                throw new Error(amountMsg);
              }
            }

            if (
              refundDetails.amount?.currency_code &&
              refundDetails.amount.currency_code.toUpperCase() !== attempt.currency.toUpperCase()
            ) {
              const currencyMsg = `Refund currency mismatch during reconciliation: expected ${attempt.currency}, got ${refundDetails.amount.currency_code}`;
              await db.finalizeRefundTransaction({
                attemptId: attempt.id,
                outcome: 'RECONCILIATION_REQUIRED',
                paypalRefundId: refundDetails.id,
                paypalResponse: refundDetails.rawResponse,
                errorMessage: currencyMsg,
                caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
                actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
                summary: currencyMsg,
                eventType: 'REFUND_RECONCILIATION_REQUIRED',
                eventDetails: {
                  refundAttemptId: attempt.id,
                  expectedCurrency: attempt.currency,
                  returnedCurrency: refundDetails.amount.currency_code,
                },
              });
              throw new Error(currencyMsg);
            }

            await db.finalizeRefundTransaction({
              attemptId: attempt.id,
              outcome: 'SUCCEEDED',
              paypalRefundId: refundDetails.id,
              paypalResponse: refundDetails.rawResponse,
              isSimulated: refundDetails.isSimulated,
              actor: {
                type: 'PAYPAL_GATEWAY',
                name: refundDetails.isSimulated
                  ? 'Background Outbox Reconciler (Simulated)'
                  : 'Background Outbox Reconciler',
              },
              summary: refundDetails.isSimulated
                ? `Reconciled simulated refund attempt ${attempt.id}. Verified simulated settlement.`
                : `Reconciled uncertain refund attempt ${attempt.id}. Genuine PayPal refund confirmed COMPLETED (${refundDetails.id}).`,
              eventType: 'REFUND_RECONCILED',
              eventDetails: {
                refundAttemptId: attempt.id,
                paypalRefundId: refundDetails.id,
                status: 'SUCCEEDED',
                isSimulated: refundDetails.isSimulated,
              },
            });
          } else if (refundDetails.status === 'FAILED' || refundDetails.status === 'CANCELLED') {
            await db.finalizeRefundTransaction({
              attemptId: attempt.id,
              outcome: 'FAILED',
              paypalRefundId: refundDetails.id,
              paypalResponse: refundDetails.rawResponse,
              errorMessage: `PayPal reported terminal refund failure with status: ${refundDetails.status}`,
              caseStatusOnNonSuccess: 'REFUND_FAILED',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Reconciled refund attempt ${attempt.id}. PayPal confirmed terminal failure (${refundDetails.status}).`,
              eventType: 'REFUND_FAILED',
              eventDetails: {
                refundAttemptId: attempt.id,
                paypalRefundId: refundDetails.id,
                status: refundDetails.status,
              },
            });
          } else {
            // PENDING or UNKNOWN: Maintain pending, do NOT decrement balance
            await db.finalizeRefundTransaction({
              attemptId: attempt.id,
              outcome: 'PENDING',
              paypalRefundId: refundDetails.id,
              paypalResponse: refundDetails.rawResponse,
              caseStatusOnNonSuccess: 'REFUND_PENDING',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Refund attempt ${attempt.id} still pending at PayPal (status: ${refundDetails.status}).`,
              eventType: 'REFUND_RECONCILE_PENDING',
              eventDetails: {
                refundAttemptId: attempt.id,
                paypalRefundId: refundDetails.id,
                providerStatus: refundDetails.status,
              },
            });
            throw new Error(
              `PayPal refund ${attempt.paypalRefundId} is still pending settlement (status: ${refundDetails.status})`
            );
          }
        } catch (gatewayErr: any) {
          if ((event.attempts || 0) >= 4 && attempt.paypalRefundId) {
            await db.finalizeRefundTransaction({
              attemptId: attempt.id,
              outcome: 'RECONCILIATION_REQUIRED',
              errorMessage: gatewayErr.message || 'Max reconciliation retries reached',
              caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
              actor: { type: 'PAYPAL_GATEWAY', name: 'Background Outbox Reconciler' },
              summary: `Refund attempt ${attempt.id} moved to RECONCILIATION_REQUIRED after retry limit.`,
              eventType: 'REFUND_RECONCILIATION_REQUIRED',
              eventDetails: { refundAttemptId: attempt.id, error: gatewayErr.message },
            }).catch(() => {});
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
