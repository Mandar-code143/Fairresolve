import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Response } from 'express';
import supertest from 'supertest';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'crypto';
import { db } from '../../src/server/database';
import { Database } from '../../src/server/database';
import { authService, requireAuth, requireRoles, AuthenticatedRequest } from '../../src/server/auth';
import { approvalService } from '../../src/server/approvalService';
import { permissionService } from '../../src/server/permissions';
import { paypalGateway } from '../../src/server/paypalGateway';
import { backgroundWorker } from '../../src/server/worker';
import { toCents, toDollars } from '../../src/server/policyEngine';
import { Case, CaseEvent, Order, RefundApproval, RefundAttempt, User, UserRole } from '../../src/types';

describe('FairResolve Second-Pass Critical Defect & Hardening Integration Tests', () => {
  let app: express.Express;
  const tenantId = 'tenant-sp-hardening';
  let ownerUser: User;
  let adminUser: User;
  let reviewerUser: User;
  let analyst1: User;
  let analyst2: User;
  let viewerUser: User;

  let ownerToken: string;
  let adminToken: string;
  let reviewerToken: string;
  let analyst1Token: string;
  let analyst2Token: string;
  let viewerToken: string;

  let testOrder: Order;
  let testCase: Case;

  beforeEach(() => {
    db.outbox.length = 0;
    Object.keys(db.refundApprovals).forEach((k) => delete db.refundApprovals[k]);
    Object.keys(db.refundAttempts).forEach((k) => delete db.refundAttempts[k]);
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    // Configure CORS with explicit allowlist as in production server
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) return callback(null, true);
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error(`CORS blocked: Origin ${origin} is not allowed by policy.`));
        },
        credentials: true,
      })
    );

    // Initialize Tenant
    db.tenants[tenantId] = {
      id: tenantId,
      name: 'Hardening Audio Labs',
      slug: 'hardening-audio',
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };

    // Initialize Published Policy
    db.policies[tenantId] = [
      {
        version: 'v2.1',
        publishedAt: new Date().toISOString(),
        returnWindowDays: 30,
        requirePackagingPhotoForDamage: true,
        requireLabelPhotoForWrongItem: true,
        carrierDeliveryVerificationDays: 3,
        maxInstantRefundAmount: 250.0,
        mandatoryReturnThreshold: 200.0,
        allowPartialRefundsWithoutReturn: true,
        maxPartialRefundPercentage: 50,
        flagDuplicateEvidenceHash: true,
        description: 'Standard Hardening Policy',
      },
    ];

    // Seed 5 Roles
    const createUser = (id: string, name: string, role: UserRole): { user: User; token: string } => {
      const u: User = { id, name, email: `${id}@fairresolve.test`, role, tenantId };
      db.users[id] = {
        ...u,
        passwordHash: 'hash',
        passwordSalt: 'salt',
        createdAt: new Date().toISOString(),
      };
      const { token } = authService.createSession(id, tenantId);
      return { user: u, token };
    };

    const ownerData = createUser('usr-sp-owner', 'Elena Owner', 'OWNER');
    ownerUser = ownerData.user;
    ownerToken = ownerData.token;

    const adminData = createUser('usr-sp-admin', 'Marcus Admin', 'ADMIN');
    adminUser = adminData.user;
    adminToken = adminData.token;

    const reviewerData = createUser('usr-sp-reviewer', 'Sarah Reviewer', 'REVIEWER');
    reviewerUser = reviewerData.user;
    reviewerToken = reviewerData.token;

    const a1Data = createUser('usr-sp-analyst1', 'David Analyst', 'ANALYST');
    analyst1 = a1Data.user;
    analyst1Token = a1Data.token;

    const a2Data = createUser('usr-sp-analyst2', 'Frank Analyst', 'ANALYST');
    analyst2 = a2Data.user;
    analyst2Token = a2Data.token;

    const viewerData = createUser('usr-sp-viewer', 'Rachel Viewer', 'VIEWER');
    viewerUser = viewerData.user;
    viewerToken = viewerData.token;

    // Seed Order
    testOrder = {
      id: 'ord-sp-101',
      tenantId,
      paypalOrderId: 'PPO-SP-101',
      paypalCaptureId: 'CAP-SP-101',
      orderNumber: 'APX-SP-101',
      buyerName: 'Alexander Hayes',
      buyerEmail: 'alexander.hayes@example.com',
      transactionDate: new Date().toISOString(),
      currency: 'USD',
      grossAmount: 150.0,
      shippingAmount: 10.0,
      refundedAmount: 0.0,
      refundableAmount: 150.0,
      items: [{ id: 'item-1', name: 'Studio Headphones', sku: 'H900', quantity: 1, unitPrice: 140.0, totalPrice: 140.0 }],
      status: 'COMPLETED',
    };
    db.orders[testOrder.id] = testOrder;

    // Seed Case
    testCase = {
      id: 'case-sp-101',
      tenantId,
      caseNumber: 'FR-SP-101',
      orderId: testOrder.id,
      orderNumber: testOrder.orderNumber,
      paypalOrderId: testOrder.paypalOrderId,
      paypalCaptureId: testOrder.paypalCaptureId,
      customerName: 'Alexander Hayes',
      customerEmail: 'alexander.hayes@example.com',
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Left hinge broken during transit',
      customerAccessToken: 'cust-token-secret-xyz',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [
        {
          id: 'ev-sp-01',
          caseId: 'case-sp-101',
          originalFilename: 'broken.jpg',
          mimeType: 'image/jpeg',
          byteSize: 102400,
          sha256Hash: 'hash123',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'clean',
          evidenceType: 'item_photo',
          downloadUrl: '/api/v1/evidence/ev-sp-01/file',
        },
      ],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.cases[testCase.id] = testCase;

    // Mount Routes under test
    app.post(
      '/api/v1/test/cases/:id/review',
      requireAuth,
      requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
      (req: AuthenticatedRequest, res: Response) => {
        const { decision, reason, notes } = req.body;
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) return res.status(404).json({ error: 'Case not found' });
        const user = req.user!;
        if (decision === 'APPROVE') {
          try {
            const result = approvalService.createRefundApproval({
              caseId: c.id,
              tenantId: c.tenantId,
              approver: user,
              notes: notes || reason,
              reason,
            });
            return res.json({ success: true, case: result.case, approval: result.approval });
          } catch (err: any) {
            return res.status(err.statusCode || 400).json({ error: err.message || 'Failed' });
          }
        }
        res.json({ success: true });
      }
    );

    app.post(
      '/api/v1/test/cases/:id/execute-refund',
      requireAuth,
      requireRoles(['OWNER', 'ADMIN']),
      async (req: AuthenticatedRequest, res: Response) => {
        const { amount, reason, idempotencyKey } = req.body;
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) return res.status(404).json({ error: 'Case not found' });
        const order = db.orders[c.orderId];
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
          return res.status(400).json({ error: 'Missing required idempotencyKey for refund execution' });
        }
        const key = idempotencyKey.trim();

        const existing = c.refundAttempts.find((a) => a.idempotencyKey === key);
        if (existing) {
          const candidateAmountDollars =
            amount !== undefined ? parseFloat(amount) : (c.activeApproval?.approvedAmount ?? order.refundableAmount);
          const candidateAmountCents = toCents(candidateAmountDollars);
          const candidatePayload = JSON.stringify({
            caseId: c.id,
            orderId: order.id,
            captureId: order.paypalCaptureId,
            amountCents: candidateAmountCents,
            currency: order.currency,
            reason: reason || c.activeApproval?.notes || existing.reason || '',
          });
          const candidateFingerprint = crypto.createHash('sha256').update(candidatePayload).digest('hex');

          if (existing.requestFingerprint && existing.requestFingerprint !== candidateFingerprint) {
            return res.status(422).json({
              error: 'Idempotency key parameter mismatch: request parameters differ from original submission.',
            });
          }
          return res.json({ success: true, isDuplicateSubmission: true, refundAttempt: existing });
        }

        const validation = approvalService.validateApprovalForExecution(
          c,
          order,
          req.user!,
          amount !== undefined ? parseFloat(amount) : undefined
        );
        if (!validation.valid) {
          return res.status(validation.statusCode || 400).json({ error: validation.error });
        }

        const execAmountDollars = validation.executableAmountDollars!;
        const execAmountCents = validation.executableAmountCents!;
        const approval = validation.approval!;

        const fingerprintPayload = JSON.stringify({
          caseId: c.id,
          orderId: order.id,
          captureId: order.paypalCaptureId,
          amountCents: execAmountCents,
          currency: order.currency,
          reason: reason || approval.notes || '',
        });
        const fingerprint = crypto.createHash('sha256').update(fingerprintPayload).digest('hex');

        const activePending = c.refundAttempts.find((a) =>
          ['RESERVED', 'SUBMITTED', 'PENDING', 'UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(a.status)
        );
        if (activePending) {
          return res.status(409).json({ error: 'Refund attempt already in progress', refundAttempt: activePending });
        }

        const refundRecord: RefundAttempt = {
          id: `ref-test-${Date.now()}`,
          caseId: c.id,
          approvalId: approval.id,
          approverId: approval.authorizedBy,
          executorId: req.user!.id,
          captureId: order.paypalCaptureId,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          amount: execAmountDollars,
          amountCents: execAmountCents,
          currency: order.currency,
          reason: reason || 'Test refund execution',
          status: 'RESERVED',
          authorizedBy: { userId: req.user!.id, userName: req.user!.name, userRole: req.user!.role },
          createdAt: new Date().toISOString(),
        };

        c.status = 'REFUND_SUBMITTED';
        c.refundAttempts.push(refundRecord);

        // Transition to SUBMITTED and call PayPal Gateway
        refundRecord.status = 'SUBMITTED';
        try {
          const result = await paypalGateway.refundCapture({
            captureId: order.paypalCaptureId,
            amount: execAmountDollars,
            currency: order.currency,
            idempotencyKey: key,
          });

          if (result.status === 'COMPLETED') {
            refundRecord.status = 'SUCCEEDED';
            refundRecord.paypalRefundId = result.refundId;
            approval.status = 'CONSUMED';

            const newRefunded = toCents(order.refundedAmount) + execAmountCents;
            const newRefundable = Math.max(0, toCents(order.grossAmount) - newRefunded);
            order.refundedAmount = toDollars(newRefunded);
            order.refundableAmount = toDollars(newRefundable);
            order.status = newRefundable === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
            c.status = newRefundable === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          }
          res.json({ success: true, refundAttempt: refundRecord, case: c, order });
        } catch (err: any) {
          refundRecord.status = 'FAILED';
          res.status(502).json({ error: err.message });
        }
      }
    );

    app.get('/api/v1/test/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      const orders = Object.values(db.orders).filter((o) => o.tenantId === req.tenantId);
      if (req.user?.role === 'VIEWER') {
        const redacted = orders.map((o) => ({
          ...o,
          buyerName: permissionService.maskCustomerName(o.buyerName),
          buyerEmail: permissionService.maskCustomerEmail(o.buyerEmail),
        }));
        return res.json({ orders: redacted });
      }
      res.json({ orders });
    });

    app.get('/api/v1/test/orders/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      const o = db.orders[req.params.id];
      if (!o || o.tenantId !== req.tenantId) return res.status(404).json({ error: 'Not found' });
      if (req.user?.role === 'VIEWER') {
        return res.json({
          order: {
            ...o,
            buyerName: permissionService.maskCustomerName(o.buyerName),
            buyerEmail: permissionService.maskCustomerEmail(o.buyerEmail),
          },
        });
      }
      res.json({ order: o });
    });

    app.get('/api/v1/test/cases/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      const c = db.cases[req.params.id];
      if (!c || c.tenantId !== req.tenantId) return res.status(404).json({ error: 'Case not found' });
      if (!permissionService.canAccessCase(req.user!, c)) {
        return res.status(403).json({ error: 'Access denied: You are not assigned to this case.' });
      }
      const serialized = permissionService.serializeCase(c, req.user!);
      res.json({ case: serialized });
    });
  });

  // 1. READY_FOR_REVIEW execution rejection
  it('1. rejects refund execution when case is in READY_FOR_REVIEW status without merchant approval', async () => {
    testCase.status = 'READY_FOR_REVIEW';
    testCase.activeApproval = undefined;

    const res = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-REV-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot refund case in 'READY_FOR_REVIEW' status");
  });

  // 2. Missing approval rejection (no fallback to refundable amount)
  it('2. rejects refund execution when active approval record is missing', async () => {
    testCase.status = 'APPROVED_PENDING_REFUND';
    testCase.activeApproval = undefined;

    const res = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-NO-APPR-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No active refund approval found');
  });

  // 3. Expired approval rejection
  it('3. rejects refund execution when approval has expired and marks status EXPIRED', async () => {
    testCase.status = 'APPROVED_PENDING_REFUND';
    testCase.activeApproval = {
      id: 'appr-exp-01',
      caseId: testCase.id,
      tenantId,
      orderId: testOrder.id,
      captureId: testOrder.paypalCaptureId,
      authorizedBy: reviewerUser.id,
      authorizedByName: reviewerUser.name,
      authorizedByRole: reviewerUser.role,
      approvedAmount: 50.0,
      approvedAmountCents: 5000,
      currency: 'USD',
      policyVersion: 'v2.1',
      status: 'ACTIVE',
      createdAt: new Date(Date.now() - 900000000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
    };

    const res = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-EXP-01' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Refund approval has expired');
    expect(testCase.activeApproval.status).toBe('EXPIRED');
  });

  // 4. Approver cannot execute (Four-Eyes principle)
  it('4. strictly enforces Four-Eyes financial control: approver cannot execute their own approved refund', async () => {
    // Reviewer approves the case
    const approvalResult = approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 75.0,
      reason: 'Transit shock fracture verified',
    });
    expect(testCase.status).toBe('APPROVED_PENDING_REFUND');
    expect(testCase.activeApproval).toBeDefined();

    // Reviewer attempts execution -> 403 Forbidden
    const resReviewer = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 75.0, idempotencyKey: 'IDEMP-4EYES-REV' });

    expect(resReviewer.status).toBe(403);

    // If Owner approved, Owner cannot execute
    testCase.activeApproval!.authorizedBy = ownerUser.id;
    const resOwnerSameUser = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 75.0, idempotencyKey: 'IDEMP-4EYES-OWN' });

    expect(resOwnerSameUser.status).toBe(403);
    expect(resOwnerSameUser.body.error).toContain('Separation of duties violation');

    // Different authorized Admin executes -> Success
    const resAdmin = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 75.0, idempotencyKey: 'IDEMP-4EYES-ADMIN' });

    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.refundAttempt.status).toBe('SUCCEEDED');
    expect(testCase.activeApproval!.status).toBe('CONSUMED');
  });

  // 5. Approval amount cannot be exceeded
  it('5. prevents execution of refund amount exceeding authorized approval amount', async () => {
    approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 50.0,
    });

    const resOverAmount = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 75.0, idempotencyKey: 'IDEMP-OVER-01' });

    expect(resOverAmount.status).toBe(400);
    expect(resOverAmount.body.error).toContain('exceeds authorized approval amount');
  });

  // 6. Capture completion does not imply refund completion in worker reconciliation
  it('6. worker reconciliation never marks a refund successful solely because capture is completed', async () => {
    const unverifiedAttempt: RefundAttempt = {
      id: 'ref-att-unverified-01',
      caseId: testCase.id,
      captureId: testOrder.paypalCaptureId,
      idempotencyKey: 'IDEMP-UNVERIFIED-01',
      amount: 50.0,
      amountCents: 5000,
      currency: 'USD',
      reason: 'Reconciliation test',
      status: 'PENDING',
      authorizedBy: { userId: adminUser.id, userName: adminUser.name, userRole: adminUser.role },
      createdAt: new Date().toISOString(),
      // Intentionally missing genuine paypalRefundId
    };
    testCase.refundAttempts.push(unverifiedAttempt);

    const initialRefunded = testOrder.refundedAmount;
    const initialRefundable = testOrder.refundableAmount;

    const outboxItem = {
      id: 'box-recon-01',
      eventType: 'RECONCILE_PENDING_REFUND',
      tenantId,
      payload: {
        caseId: testCase.id,
        refundAttemptId: unverifiedAttempt.id,
        captureId: testOrder.paypalCaptureId,
        idempotencyKey: unverifiedAttempt.idempotencyKey,
      },
      status: 'PENDING' as const,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.outbox.push(outboxItem);

    // Poll worker
    await backgroundWorker.pollAndProcess();

    // Verify order balances were NOT decremented
    expect(testOrder.refundedAmount).toBe(initialRefunded);
    expect(testOrder.refundableAmount).toBe(initialRefundable);
    expect(unverifiedAttempt.status).toBe('RECONCILIATION_REQUIRED');
  });

  // 7. Genuine refund completion reconciles correctly
  it('7. worker reconciliation completes refund and updates balances only when PayPal refund status is COMPLETED', async () => {
    testCase.activeApproval = {
      id: 'appr-recon-01',
      caseId: testCase.id,
      tenantId,
      orderId: testOrder.id,
      captureId: testOrder.paypalCaptureId,
      authorizedBy: reviewerUser.id,
      authorizedByName: reviewerUser.name,
      authorizedByRole: reviewerUser.role,
      approvedAmount: 40.0,
      approvedAmountCents: 4000,
      currency: 'USD',
      policyVersion: 'v2.1',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    const genuineAttempt: RefundAttempt = {
      id: 'ref-att-genuine-01',
      caseId: testCase.id,
      captureId: testOrder.paypalCaptureId,
      idempotencyKey: 'IDEMP-GENUINE-01',
      paypalRefundId: 'SIM-SANDBOX-REF-XYZ', // simulated completed refund
      amount: 40.0,
      amountCents: 4000,
      currency: 'USD',
      reason: 'Genuine reconciliation test',
      status: 'PENDING',
      authorizedBy: { userId: adminUser.id, userName: adminUser.name, userRole: adminUser.role },
      createdAt: new Date().toISOString(),
    };
    testCase.refundAttempts.push(genuineAttempt);

    const initialRefundable = toCents(testOrder.refundableAmount);

    db.outbox.push({
      id: 'box-genuine-recon',
      eventType: 'RECONCILE_PENDING_REFUND',
      tenantId,
      payload: {
        caseId: testCase.id,
        refundAttemptId: genuineAttempt.id,
        captureId: testOrder.paypalCaptureId,
        idempotencyKey: genuineAttempt.idempotencyKey,
      },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    await backgroundWorker.pollAndProcess();

    expect(genuineAttempt.status).toBe('SUCCEEDED');
    expect(testCase.activeApproval.status).toBe('CONSUMED');
    expect(toCents(testOrder.refundableAmount)).toBe(initialRefundable - 4000);
    expect(toCents(testOrder.refundedAmount)).toBe(4000);
  });

  // 8. Unknown refund result remains unknown / reconciliation required
  it('8. pending or unknown refund details keep attempt pending without decrementing order balance', async () => {
    // Mock getRefund to return PENDING
    const originalGetRefund = paypalGateway.getRefund.bind(paypalGateway);
    vi.spyOn(paypalGateway, 'getRefund').mockResolvedValueOnce({
      id: 'REF-PENDING-99',
      status: 'PENDING',
      amount: { value: '30.00', currency_code: 'USD' },
      isSimulated: false,
    });

    const pendingAttempt: RefundAttempt = {
      id: 'ref-att-pending-01',
      caseId: testCase.id,
      captureId: testOrder.paypalCaptureId,
      idempotencyKey: 'IDEMP-PENDING-01',
      paypalRefundId: 'REF-PENDING-99',
      amount: 30.0,
      amountCents: 3000,
      currency: 'USD',
      reason: 'Pending clearance test',
      status: 'PENDING',
      authorizedBy: { userId: adminUser.id, userName: adminUser.name, userRole: adminUser.role },
      createdAt: new Date().toISOString(),
    };
    testCase.refundAttempts.push(pendingAttempt);

    const initialRefunded = testOrder.refundedAmount;

    db.outbox.push({
      id: 'box-pending-recon',
      eventType: 'RECONCILE_PENDING_REFUND',
      tenantId,
      payload: {
        caseId: testCase.id,
        refundAttemptId: pendingAttempt.id,
        captureId: testOrder.paypalCaptureId,
        idempotencyKey: pendingAttempt.idempotencyKey,
      },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    await backgroundWorker.pollAndProcess();

    expect(pendingAttempt.status).toBe('PENDING');
    expect(testOrder.refundedAmount).toBe(initialRefunded);
  });

  // 9. Two concurrent refund requests cannot over-refund
  it('9. concurrent refund execution is rejected when another attempt is already in progress', async () => {
    approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 50.0,
    });

    // An in-flight attempt exists
    testCase.refundAttempts.push({
      id: 'ref-in-flight-01',
      caseId: testCase.id,
      captureId: testOrder.paypalCaptureId,
      idempotencyKey: 'IDEMP-CONCURRENT-A',
      amount: 50.0,
      amountCents: 5000,
      currency: 'USD',
      reason: 'Concurrent flight',
      status: 'SUBMITTED',
      authorizedBy: { userId: adminUser.id, userName: adminUser.name, userRole: adminUser.role },
      createdAt: new Date().toISOString(),
    });

    // Immediate second attempt with different idempotency key
    const resConcurrent = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-CONCURRENT-B' });

    expect(resConcurrent.status).toBe(409);
    expect(resConcurrent.body.error).toContain('already in progress');
  });

  // 10. Same idempotency key with different parameters rejected
  it('10. rejects duplicate idempotency key when submitted with mismatched financial parameters', async () => {
    approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 50.0,
    });

    const key = 'IDEMP-MISMATCH-TEST';
    // First execution succeeds for $50.00
    const res1 = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: key });

    expect(res1.status).toBe(200);

    // Second execution with SAME key but DIFFERENT amount ($25.00) -> 422 Parameter Mismatch
    const resMismatched = await supertest(app)
      .post(`/api/v1/test/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 25.0, idempotencyKey: key });

    expect(resMismatched.status).toBe(422);
    expect(resMismatched.body.error).toContain('Idempotency key parameter mismatch');
  });

  // 11. VIEWER receives redacted order and case info
  it('11. strictly redacts buyer PII and customerAccessToken for role VIEWER', async () => {
    // 1. Orders list
    const resOrders = await supertest(app)
      .get('/api/v1/test/orders')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(resOrders.status).toBe(200);
    const orderItem = resOrders.body.orders.find((o: any) => o.id === testOrder.id);
    expect(orderItem.buyerName).not.toBe('Alexander Hayes');
    expect(orderItem.buyerName).toContain('***');
    expect(orderItem.buyerEmail).toContain('***');

    // 2. Single Order
    const resSingleOrder = await supertest(app)
      .get(`/api/v1/test/orders/${testOrder.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(resSingleOrder.status).toBe(200);
    expect(resSingleOrder.body.order.buyerName).toContain('***');

    // 3. Case detail
    const resCase = await supertest(app)
      .get(`/api/v1/test/cases/${testCase.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(resCase.status).toBe(200);
    expect(resCase.body.case.customerAccessToken).toBe('');
    expect(resCase.body.case.customerName).toContain('***');
    expect(resCase.body.case.evidence[0].downloadUrl).toBe('');
  });

  // 12. Analyst cannot retrieve another analyst's assigned case
  it('12. enforces strict analyst queue scoping: Analyst A cannot access case assigned to Analyst B', async () => {
    // Unassigned case: Analyst A can access triage
    testCase.assignedTo = undefined;
    const resUnassigned = await supertest(app)
      .get(`/api/v1/test/cases/${testCase.id}`)
      .set('Authorization', `Bearer ${analyst1Token}`);
    expect(resUnassigned.status).toBe(200);

    // Case assigned to Analyst A: Analyst A can access
    testCase.assignedTo = analyst1.id;
    const resAssignedA = await supertest(app)
      .get(`/api/v1/test/cases/${testCase.id}`)
      .set('Authorization', `Bearer ${analyst1Token}`);
    expect(resAssignedA.status).toBe(200);

    // Analyst B attempts access to Analyst A's case -> 403 Forbidden
    const resForbiddenB = await supertest(app)
      .get(`/api/v1/test/cases/${testCase.id}`)
      .set('Authorization', `Bearer ${analyst2Token}`);
    expect(resForbiddenB.status).toBe(403);
    expect(resForbiddenB.body.error).toContain('not assigned to this case');
  });

  // 13. Arbitrary browser origins rejected (CORS)
  it('13. rejects untrusted browser origins according to explicit CORS allowlist', async () => {
    const resCorsBlocked = await supertest(app)
      .get('/api/v1/test/orders')
      .set('Origin', 'http://malicious-phishing-site.evil')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resCorsBlocked.status).toBe(500);
  });

  // 14. Forged CSRF requests rejected
  it('14. rejects mutating requests with session cookie when anti-CSRF custom header is missing', async () => {
    const csrfApp = express();
    csrfApp.use(express.json());
    csrfApp.use(cookieParser());

    csrfApp.post('/api/v1/test/csrf-guarded', requireAuth, (req: AuthenticatedRequest, res: Response) => {
      res.json({ success: true });
    });

    // Request with session cookie but missing anti-CSRF header -> 403 Forbidden
    const resBlocked = await supertest(csrfApp)
      .post('/api/v1/test/csrf-guarded')
      .set('Cookie', `fairresolve_session=${ownerToken}`)
      .send({ data: 'attack' });

    expect(resBlocked.status).toBe(403);
    expect(resBlocked.body.error).toContain('CSRF verification failed');

    // Request with session cookie AND X-Requested-With header -> 200 OK
    const resAllowed = await supertest(csrfApp)
      .post('/api/v1/test/csrf-guarded')
      .set('Cookie', `fairresolve_session=${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ data: 'legitimate' });

    expect(resAllowed.status).toBe(200);
  });

  // 15. PostgreSQL failure prevents unsafe production fallback
  it('15. production mode rejects silent JSON fallback when PostgreSQL connection fails', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalDbUrl = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      // In production mode without DATABASE_URL, Database instantiation must throw
      expect(() => new Database()).toThrow('DATABASE_URL is required in production');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    }
  });
});
