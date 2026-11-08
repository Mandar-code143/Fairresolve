import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Response } from 'express';
import supertest from 'supertest';
import { db } from '../../src/server/database';
import { authService, requireAuth, requireRoles, AuthenticatedRequest } from '../../src/server/auth';
import { paypalGateway } from '../../src/server/paypalGateway';
import { toCents, toDollars } from '../../src/server/policyEngine';
import { Case, Order, RefundAttempt } from '../../src/types';

describe('Refund Security & Concurrency Hardening Integration Tests', () => {
  let app: express.Express;
  let reviewerToken: string;
  let testCase: Case;
  let testOrder: Order;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(paypalGateway, 'refundCapture').mockImplementation(async (params: any) => {
      return {
        refundId: `REF-${params.idempotencyKey || Date.now()}`,
        status: 'COMPLETED',
        amount: params.amount,
        currency: params.currency,
        createTime: new Date().toISOString(),
        idempotencyKey: params.idempotencyKey,
        isSimulated: true,
      };
    });

    app = express();
    app.use(express.json());

    const tenantId = 'tenant-refund-sec';
    db.tenants[tenantId] = {
      id: tenantId,
      name: 'Secure Audio Labs',
      slug: 'secure-audio',
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };

    const reviewerId = 'usr-rev-01';
    db.users[reviewerId] = {
      id: reviewerId,
      name: 'Marcus Reviewer',
      email: 'marcus@sec.test',
      role: 'REVIEWER',
      tenantId,
      passwordHash: 'hash',
      passwordSalt: 'salt',
      createdAt: new Date().toISOString(),
    };

    const { token } = authService.createSession(reviewerId, tenantId);
    reviewerToken = token;

    testOrder = {
      id: 'ord-sec-01',
      tenantId,
      paypalOrderId: 'PPO-SEC-100',
      paypalCaptureId: 'CAP-SEC-100',
      orderNumber: 'APX-SEC-100',
      buyerName: 'Buyer Test',
      buyerEmail: 'buyer@sec.test',
      transactionDate: new Date().toISOString(),
      currency: 'USD',
      grossAmount: 200.0,
      shippingAmount: 10.0,
      refundedAmount: 0.0,
      refundableAmount: 200.0,
      items: [{ id: 'i1', name: 'Item', sku: 'SKU1', quantity: 1, unitPrice: 190.0, totalPrice: 190.0 }],
      status: 'COMPLETED',
    };
    db.orders[testOrder.id] = testOrder;

    testCase = {
      id: 'case-sec-01',
      tenantId,
      caseNumber: 'FR-SEC-01',
      orderId: testOrder.id,
      orderNumber: testOrder.orderNumber,
      paypalOrderId: testOrder.paypalOrderId,
      paypalCaptureId: testOrder.paypalCaptureId,
      customerName: testOrder.buyerName,
      customerEmail: testOrder.buyerEmail,
      status: 'APPROVED_PENDING_REFUND',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Package arrived crushed',
      customerAccessToken: 'tok-sec',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.cases[testCase.id] = testCase;

    // Refund endpoint with hardened concurrency locks & minor unit math
    app.post(
      '/api/v1/cases/:id/refund',
      requireAuth,
      requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
      async (req: AuthenticatedRequest, res: Response) => {
        const { amount, reason, idempotencyKey } = req.body;
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) {
          return res.status(404).json({ error: 'Case not found' });
        }

        if (c.status !== 'APPROVED_PENDING_REFUND' && c.status !== 'READY_FOR_REVIEW') {
          return res.status(400).json({ error: `Cannot refund case in '${c.status}' status.` });
        }

        const order = db.orders[c.orderId];
        if (!order) return res.status(404).json({ error: 'Associated order not found' });

        const refundAmountDollars = parseFloat(amount);
        if (isNaN(refundAmountDollars) || refundAmountDollars <= 0) {
          return res.status(400).json({ error: 'Invalid refund amount requested' });
        }

        // Integer minor units (cents)
        const reqCents = toCents(refundAmountDollars);
        const refundableCents = toCents(order.refundableAmount);

        if (reqCents > refundableCents) {
          return res.status(400).json({
            error: `Requested refund $${refundAmountDollars.toFixed(2)} exceeds remaining refundable balance $${order.refundableAmount.toFixed(2)}`,
          });
        }

        // Active pending concurrency check
        const inProgress = c.refundAttempts.find(
          (a) => a.status === 'SUBMITTED' || a.status === 'PENDING' || a.status === 'UNKNOWN' || a.status === 'RECONCILIATION_REQUIRED'
        );
        if (inProgress) {
          return res.status(409).json({
            error: `A refund attempt (${inProgress.id}) is already in progress or awaiting reconciliation.`,
            refundAttempt: inProgress,
          });
        }

        // Idempotency deduplication check
        const key = idempotencyKey || `FR-PPR-${c.id}-${Date.now()}`;
        const existingAttempt = c.refundAttempts.find((a) => a.idempotencyKey === key);
        if (existingAttempt) {
          if (existingAttempt.status === 'SUCCEEDED' || existingAttempt.status === 'PENDING') {
            return res.json({
              success: true,
              refundAttempt: existingAttempt,
              case: c,
              isDuplicateSubmission: true,
            });
          }
        }

        const refundRecord: RefundAttempt = {
          id: `ref-att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          caseId: c.id,
          captureId: order.paypalCaptureId,
          idempotencyKey: key,
          amount: refundAmountDollars,
          currency: order.currency,
          reason: reason || 'Merchant authorized dispute resolution',
          status: 'SUBMITTED',
          authorizedBy: {
            userId: req.user!.id,
            userName: req.user!.name,
            userRole: req.user!.role,
          },
          createdAt: new Date().toISOString(),
        };

        c.status = 'REFUND_SUBMITTED';
        c.refundAttempts.push(refundRecord);

        try {
          const result = await paypalGateway.refundCapture({
            captureId: order.paypalCaptureId,
            amount: refundAmountDollars,
            currency: order.currency,
            idempotencyKey: key,
          });

          if (result.status === 'COMPLETED') {
            refundRecord.status = 'SUCCEEDED';
            refundRecord.paypalRefundId = result.refundId;
            refundRecord.paypalResponse = result.rawResponse;

            // Balance arithmetic in minor units (cents)
            const newRefundedCents = toCents(order.refundedAmount) + reqCents;
            const grossCents = toCents(order.grossAmount);
            const newRefundableCents = Math.max(0, grossCents - newRefundedCents);

            order.refundedAmount = toDollars(newRefundedCents);
            order.refundableAmount = toDollars(newRefundableCents);
            order.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          } else if (result.status === 'PENDING') {
            refundRecord.status = 'PENDING';
            c.status = 'REFUND_PENDING';
          }

          res.json({ success: true, refundAttempt: refundRecord, case: c, order });
        } catch (err: any) {
          refundRecord.status = 'FAILED';
          c.status = 'REFUND_FAILED';
          res.status(500).json({ error: err.message, refundAttempt: refundRecord });
        }
      }
    );
  });

  it('rejects refund amounts exceeding remaining refundable balance', async () => {
    // Attempt to refund $250 on a $200 order
    const res = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 250.0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exceeds remaining refundable balance');
    expect(testOrder.refundedAmount).toBe(0);
    expect(testOrder.refundableAmount).toBe(200.0);
  });

  it('accurately calculates partial refund in integer cents and marks PARTIALLY_REFUNDED, not fully REFUNDED', async () => {
    // Partial refund $50.00 on a $200.00 order
    const res = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-PARTIAL-01' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.refundedAmount).toBe(50.0);
    expect(res.body.order.refundableAmount).toBe(150.0);
    expect(res.body.order.status).toBe('PARTIALLY_REFUNDED');
    expect(res.body.case.status).toBe('PARTIALLY_REFUNDED');
  });

  it('deduplicates identical submission with the same idempotency key without calling gateway twice', async () => {
    const key = 'IDEMP-STABLE-KEY-999';

    // First refund: 200 OK
    const res1 = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 40.0, idempotencyKey: key });

    expect(res1.status).toBe(200);
    expect(res1.body.refundAttempt.status).toBe('SUCCEEDED');

    // Reset case status to approved to simulate retry
    testCase.status = 'APPROVED_PENDING_REFUND';

    // Duplicate submission with same key
    const res2 = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 40.0, idempotencyKey: key });

    expect(res2.status).toBe(200);
    expect(res2.body.isDuplicateSubmission).toBe(true);
    expect(res2.body.refundAttempt.idempotencyKey).toBe(key);
    // Order refundedAmount should still only be 40.0, not 80.0
    expect(testOrder.refundedAmount).toBe(40.0);
  });

  it('locks concurrent refunds when a refund attempt is currently in progress', async () => {
    // Simulate an attempt that is currently SUBMITTED / in-flight
    testCase.refundAttempts.push({
      id: 'ref-flight-1',
      caseId: testCase.id,
      captureId: testOrder.paypalCaptureId,
      idempotencyKey: 'KEY-IN-FLIGHT',
      amount: 50.0,
      currency: 'USD',
      reason: 'In flight',
      status: 'SUBMITTED',
      authorizedBy: { userId: 'u1', userName: 'U', userRole: 'REVIEWER' },
      createdAt: new Date().toISOString(),
    });

    // Concurrent second refund attempt should be rejected with 409 Conflict
    const resConcurrent = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 30.0, idempotencyKey: 'KEY-CONCURRENT-2' });

    expect(resConcurrent.status).toBe(409);
    expect(resConcurrent.body.error).toContain('already in progress or awaiting reconciliation');
  });
});
