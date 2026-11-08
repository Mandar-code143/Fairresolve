import { describe, it, expect, beforeEach, vi, afterEach, afterAll } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import pg from 'pg';
import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';

// Import ACTUAL production Express app from server.ts — NO duplicate mock Express routes!
import { app } from '../../server';
import { db, Database, OutboxEvent } from '../../src/server/database';
import { authService } from '../../src/server/auth';
import { approvalService } from '../../src/server/approvalService';
import { paypalGateway } from '../../src/server/paypalGateway';
import { BackgroundWorker } from '../../src/server/worker';
import { Case, Order, RefundAttempt, User, UserRole } from '../../src/types';

describe('FAIRRESOLVE — PRACTICAL FINAL VERIFICATION (Tests 1-9)', () => {
  const tenantId = 'tenant-pfv-100';

  // Seeded Users across all 5 RBAC tiers
  let ownerUser: User;
  let adminUser: User;
  let reviewerUser: User;
  let analyst1: User;
  let analyst2: User;
  let viewerUser: User;

  // Real Session Tokens
  let ownerToken: string;
  let adminToken: string;
  let reviewerToken: string;
  let analyst1Token: string;
  let analyst2Token: string;
  let viewerToken: string;

  let testOrder: Order;
  let testCase: Case;

  beforeEach(() => {
    vi.restoreAllMocks();
    db.setPostgresConnected(false, undefined);

    // Clean up in-memory attempts, approvals, outbox and audit events across tests
    for (const key of Object.keys(db.refundAttempts)) delete db.refundAttempts[key];
    for (const key of Object.keys(db.refundApprovals)) delete db.refundApprovals[key];
    db.outbox.length = 0;

    // Ensure private_uploads directory and test evidence file exist for isolated testing
    const uploadsDir = path.resolve(process.cwd(), 'private_uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(uploadsDir, 'ev-pfv-01.jpg'), 'test-evidence-binary');

    // 1. Initialize Tenant in authoritative database
    db.tenants[tenantId] = {
      id: tenantId,
      name: 'Practical Verification Labs',
      slug: 'pfv-labs',
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };

    // 2. Initialize Policy
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
        description: 'Standard Verification Policy v2.1',
      },
    ];

    // 3. Seed Users across all 5 RBAC tiers
    const createTestUser = (id: string, name: string, role: UserRole): { user: User; token: string } => {
      const u: User = { id, name, email: `${id}@pfv.test`, role, tenantId };
      db.users[id] = {
        ...u,
        passwordHash: 'scrypt-hash',
        passwordSalt: 'salt',
        createdAt: new Date().toISOString(),
      };
      const { token } = authService.createSession(id, tenantId);
      return { user: u, token };
    };

    const ownerData = createTestUser('usr-pfv-owner', 'Elena Rostova', 'OWNER');
    ownerUser = ownerData.user;
    ownerToken = ownerData.token;

    const adminData = createTestUser('usr-pfv-admin', 'Marcus Vance', 'ADMIN');
    adminUser = adminData.user;
    adminToken = adminData.token;

    const reviewerData = createTestUser('usr-pfv-reviewer', 'Sarah Chen', 'REVIEWER');
    reviewerUser = reviewerData.user;
    reviewerToken = reviewerData.token;

    const a1Data = createTestUser('usr-pfv-analyst1', 'David Kalu', 'ANALYST');
    analyst1 = a1Data.user;
    analyst1Token = a1Data.token;

    const a2Data = createTestUser('usr-pfv-analyst2', 'Frank Analyst', 'ANALYST');
    analyst2 = a2Data.user;
    analyst2Token = a2Data.token;

    const viewerData = createTestUser('usr-pfv-viewer', 'Rachel Adams', 'VIEWER');
    viewerUser = viewerData.user;
    viewerToken = viewerData.token;

    // 4. Seed Verified PayPal Order ($200.00 Gross, $0 Refunded, $200.00 Refundable)
    testOrder = {
      id: 'ord-pfv-101',
      tenantId,
      paypalOrderId: 'PPO-PFV-101',
      paypalCaptureId: 'CAP-PFV-101',
      orderNumber: 'APX-PFV-101',
      buyerName: 'Alexander Hayes',
      buyerEmail: 'alexander.hayes@example.com',
      transactionDate: new Date().toISOString(),
      currency: 'USD',
      grossAmount: 200.0,
      shippingAmount: 10.0,
      refundedAmount: 0.0,
      refundableAmount: 200.0,
      items: [{ id: 'item-1', name: 'Audiophile DAC', sku: 'DAC-900', quantity: 1, unitPrice: 190.0, totalPrice: 190.0 }],
      status: 'COMPLETED',
    };
    db.orders[testOrder.id] = testOrder;

    // 5. Seed Case in READY_FOR_REVIEW without approval
    testCase = {
      id: 'case-pfv-101',
      tenantId,
      caseNumber: 'FR-PFV-101',
      orderId: testOrder.id,
      orderNumber: testOrder.orderNumber,
      paypalOrderId: testOrder.paypalOrderId,
      paypalCaptureId: testOrder.paypalCaptureId,
      customerName: 'Alexander Hayes',
      customerEmail: 'alexander.hayes@example.com',
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Chassis dented upon delivery',
      customerAccessToken: 'cust-token-pfv-xyz',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [
        {
          id: 'ev-pfv-01',
          caseId: 'case-pfv-101',
          originalFilename: 'chassis.jpg',
          mimeType: 'image/jpeg',
          byteSize: 204800,
          sha256Hash: 'hash-pfv-1',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'clean',
          evidenceType: 'item_photo',
          downloadUrl: '/api/v1/evidence/ev-pfv-01/file',
        },
      ],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.cases[testCase.id] = testCase;
  });

  // ===========================================================================
  // TEST 1: Refund without approval
  // ===========================================================================
  it('Test 1: Refund without approval — backend strictly rejects refund execution when case is in READY_FOR_REVIEW without an active approval record', async () => {
    const paypalRefundSpy = vi.spyOn(paypalGateway, 'refundCapture');

    // Attempt to execute refund via production route
    const res = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-NO-APPROVAL-01' });

    // Must be rejected with 400 Bad Request
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('APPROVED_PENDING_REFUND');

    // PayPal API must NEVER have been called
    expect(paypalRefundSpy).not.toHaveBeenCalled();

    // No refund attempt recorded as successful
    expect(testCase.refundAttempts.length).toBe(0);
    expect(testOrder.refundedAmount).toBe(0.0);
    expect(testOrder.refundableAmount).toBe(200.0);
  });

  // ===========================================================================
  // TEST 2: Four-eyes approval
  // ===========================================================================
  it('Test 2: Four-eyes approval — User A approves $50, self-execution is rejected, User B executes at most approved amount', async () => {
    // 1. User A (Admin) approves refund of $50 via production review route
    const resApprove = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVE', requestedAmount: 50.0, reason: 'Valid physical damage verified' });

    expect(resApprove.status).toBe(200);
    expect(testCase.status).toBe('APPROVED_PENDING_REFUND');
    expect(testCase.activeApproval).toBeDefined();
    expect(testCase.activeApproval?.approvedAmount).toBe(50.0);
    expect(testCase.activeApproval?.authorizedBy).toBe(adminUser.id);

    // 2. User A attempts to execute the refund they approved -> Must be rejected (Four-Eyes Violation)
    const resSelfExec = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-FOUR-EYES-SELF' });

    expect(resSelfExec.status).toBe(403);
    expect(resSelfExec.body.error).toMatch(/Separation of duties|Four-Eyes|approver cannot execute/i);

    // 3. User B (Owner) attempts to execute more than approved $50 (e.g. $75) -> Must be rejected
    const resOverAmount = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 75.0, idempotencyKey: 'IDEMP-FOUR-EYES-OVER' });

    expect(resOverAmount.status).toBe(400);
    expect(resOverAmount.body.error).toMatch(/exceeds authorized approval amount|exceeds approved amount/i);

    // 4. User B (Owner) executes the approved $50 -> Accepted!
    const paypalRefundSpy = vi.spyOn(paypalGateway, 'refundCapture').mockResolvedValueOnce({
      refundId: 'REF-PAYPAL-FE-99',
      status: 'COMPLETED',
      amount: 50.0,
      currency: 'USD',
      createTime: new Date().toISOString(),
      idempotencyKey: 'IDEMP-FOUR-EYES-VALID',
      isSimulated: true,
    });

    const resValidExec = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-FOUR-EYES-VALID' });

    expect(resValidExec.status).toBe(200);
    expect(resValidExec.body.success).toBe(true);
    expect(resValidExec.body.refundAttempt.amount).toBe(50.0);
    expect(resValidExec.body.refundAttempt.approverId).toBe(adminUser.id);
    expect(resValidExec.body.refundAttempt.executorId).toBe(ownerUser.id);

    // Balances updated accurately in integer minor units
    expect(testOrder.refundedAmount).toBe(50.0);
    expect(testOrder.refundableAmount).toBe(150.0);
    expect(paypalRefundSpy).toHaveBeenCalledTimes(1);
  });

  // ===========================================================================
  // TEST 3: Duplicate refund (Atomic Concurrency)
  // ===========================================================================
  it('Test 3: Duplicate refund — concurrent requests for the same case and capture result in at most one execution and non-negative balance', async () => {
    // Approve refund of $100
    approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 100.0,
      reason: 'Concurrence test approval',
    });

    const paypalRefundSpy = vi.spyOn(paypalGateway, 'refundCapture').mockImplementation(async (params) => {
      // Small artificial delay to force concurrency overlap
      await new Promise((r) => setTimeout(r, 40));
      return {
        refundId: `REF-${Date.now()}`,
        status: 'COMPLETED',
        amount: params.amount,
        currency: params.currency,
        createTime: new Date().toISOString(),
        idempotencyKey: params.idempotencyKey,
        isSimulated: true,
      };
    });

    // Fire two requests simultaneously with different idempotency keys
    const req1 = supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100.0, idempotencyKey: 'IDEMP-CONCUR-KEY-1' });

    const req2 = supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100.0, idempotencyKey: 'IDEMP-CONCUR-KEY-2' });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200), the other must be rejected due to concurrent flight (409)
    expect(statuses).toEqual([200, 409]);

    // Financial integrity assertions
    expect(testOrder.refundableAmount).toBeGreaterThanOrEqual(0);
    expect(testOrder.refundedAmount).toBe(100.0);
    expect(testOrder.refundableAmount).toBe(100.0);
    expect(paypalRefundSpy).toHaveBeenCalledTimes(1);
  });

  // ===========================================================================
  // TEST 4: PayPal timeout
  // ===========================================================================
  it('Test 4: PayPal timeout — network timeout transitions case to REFUND_PENDING / RECONCILIATION_REQUIRED without decrementing balance', async () => {
    approvalService.createRefundApproval({
      caseId: testCase.id,
      tenantId,
      approver: reviewerUser,
      requestedAmount: 50.0,
      reason: 'Timeout test approval',
    });

    const initialRefunded = testOrder.refundedAmount;
    const initialRefundable = testOrder.refundableAmount;

    // Simulate gateway network timeout
    vi.spyOn(paypalGateway, 'refundCapture').mockRejectedValueOnce(
      Object.assign(new Error('ETIMEDOUT: Connection to PayPal Sandbox timed out'), { code: 'ETIMEDOUT' })
    );

    const res = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-TIMEOUT-01' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('RECONCILIATION_REQUIRED');

    // Financial balance MUST NOT be decremented on uncertain state
    expect(testOrder.refundedAmount).toBe(initialRefunded);
    expect(testOrder.refundableAmount).toBe(initialRefundable);
    expect(testCase.status).toBe('REFUND_PENDING');

    // Transactional outbox reconciler event queued
    const queuedOutbox = db.outbox.find((o) => o.eventType === 'RECONCILE_PENDING_REFUND');
    expect(queuedOutbox).toBeDefined();
    expect(queuedOutbox?.payload.caseId).toBe(testCase.id);
  });

  // ===========================================================================
  // TEST 5: PostgreSQL persistence
  // ===========================================================================
  it('Test 5: PostgreSQL persistence — verifies user/case registration in real PostgreSQL tables and recovery across restart', async () => {
    // 1. Initialize real in-memory PostgreSQL engine via pg-mem
    const memDb = newDb();
    memDb.registerExtension('uuid-ossp', (schema) => {
      schema.registerFunction({
        name: 'uuid_generate_v4',
        implementation: () => crypto.randomUUID(),
      });
    });

    const schemaCandidates = [
      path.resolve(__dirname, '../../src/server/database/schema.sql'),
      path.resolve(process.cwd(), 'src/server/database/schema.sql'),
    ];
    const schemaPath = schemaCandidates.find((p) => fs.existsSync(p));
    expect(schemaPath).toBeDefined();
    const schemaSql = fs.readFileSync(schemaPath!, 'utf-8');
    memDb.public.none(schemaSql);

    const pgPoolClass = memDb.adapters.createPg().Pool;
    const pool = new pgPoolClass();

    try {
      // Attach PostgreSQL pool to authoritative database
      await db.initTestPostgres(pool);
      expect(db.isPostgresActive()).toBe(true);

      // 2. Register user via production API
      const regRes = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Postgres Architect',
          email: 'architect@pgtest.io',
          password: 'SecurePostgres2026!',
          companyName: 'Postgres Solutions Inc',
        });

      expect(regRes.status).toBe(200);
      const registeredUserId = regRes.body.user.id;

      // 3. Inspect ACTUAL PostgreSQL rows directly via SQL query
      const userRowRes = await pool.query('SELECT * FROM users WHERE id = $1', [registeredUserId]);
      expect(userRowRes.rows.length).toBe(1);
      expect(userRowRes.rows[0].email).toBe('architect@pgtest.io');
      expect(userRowRes.rows[0].role).toBe('OWNER');

      // 4. Create and persist a new case row directly in PostgreSQL
      const testCaseId = 'case-pg-persisted-1';
      await pool.query(
        `INSERT INTO cases (
          id, tenant_id, case_number, order_id, order_number, paypal_order_id, paypal_capture_id,
          customer_name, customer_email, status, issue_type, requested_resolution, customer_description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          testCaseId,
          regRes.body.user.tenantId,
          'FR-PG-001',
          testOrder.id,
          testOrder.orderNumber,
          testOrder.paypalOrderId,
          testOrder.paypalCaptureId,
          'Postgres Customer',
          'pg.customer@test.io',
          'READY_FOR_REVIEW',
          'damaged_item',
          'full_refund',
          'Verified in real PostgreSQL tables',
        ]
      );

      // Verify row was inserted into real PostgreSQL table
      const caseRowRes = await pool.query('SELECT * FROM cases WHERE id = $1', [testCaseId]);
      expect(caseRowRes.rows.length).toBe(1);
      expect(caseRowRes.rows[0].customer_name).toBe('Postgres Customer');

      // 5. Restart simulation: Instantiate fresh Database instance connected to the same PostgreSQL pool
      const restartedDb = new Database();
      await restartedDb.initTestPostgres(pool);

      // Verify the registered user and case exist in the restarted instance directly from PostgreSQL
      expect(restartedDb.users[registeredUserId]).toBeDefined();
      expect(restartedDb.users[registeredUserId].email).toBe('architect@pgtest.io');
      expect(restartedDb.cases[testCaseId]).toBeDefined();
      expect(restartedDb.cases[testCaseId].customerName).toBe('Postgres Customer');

      // 6. Verify production mode fail-closed behavior: without DATABASE_URL, restart throws
      const origEnv = process.env.NODE_ENV;
      const origDb = process.env.DATABASE_URL;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;
        expect(() => new Database()).toThrow('DATABASE_URL is required in production');
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origDb) process.env.DATABASE_URL = origDb;
      }
    } finally {
      db.setPostgresConnected(false, undefined);
    }
  });

  // ===========================================================================
  // TEST 6: Role restrictions
  // ===========================================================================
  it('Test 6: Role restrictions — verifies permissions for OWNER, ADMIN, REVIEWER, ANALYST, and VIEWER on production routes', async () => {
    // 1. VIEWER cannot download evidence files
    const resViewerEvidence = await supertest(app)
      .get(`/api/v1/evidence/${testCase.evidence[0].id}/file`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(resViewerEvidence.status).toBe(403);

    // 2. VIEWER receives masked customer PII
    const resViewerOrders = await supertest(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(resViewerOrders.status).toBe(200);
    const maskedOrder = resViewerOrders.body.orders.find((o: any) => o.id === testOrder.id);
    expect(maskedOrder.buyerName).toContain('***');
    expect(maskedOrder.buyerEmail).toContain('***');

    // 3. ANALYST cannot access case assigned to another analyst
    testCase.assignedTo = analyst1.id;
    const resForbiddenAnalyst = await supertest(app)
      .get(`/api/v1/cases/${testCase.id}`)
      .set('Authorization', `Bearer ${analyst2Token}`);
    expect(resForbiddenAnalyst.status).toBe(403);
    expect(resForbiddenAnalyst.body.error).toContain('not assigned to this case');

    // 4. REVIEWER can approve
    const resReviewerApprove = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ decision: 'APPROVE', requestedAmount: 50.0, reason: 'Reviewer approval valid' });
    expect(resReviewerApprove.status).toBe(200);

    // 5. REVIEWER cannot execute refunds (RBAC guard requires OWNER or ADMIN)
    const resReviewerExec = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-REV-EXEC' });
    expect(resReviewerExec.status).toBe(403);

    // 6. ADMIN can execute when approved by REVIEWER
    vi.spyOn(paypalGateway, 'refundCapture').mockResolvedValueOnce({
      refundId: 'REF-PAYPAL-ADM-EXEC',
      status: 'COMPLETED',
      amount: 50.0,
      currency: 'USD',
      createTime: new Date().toISOString(),
      idempotencyKey: 'IDEMP-ADM-EXEC',
      isSimulated: true,
    });

    const resAdminExec = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-ADM-EXEC' });
    expect(resAdminExec.status).toBe(200);
  });

  // ===========================================================================
  // TEST 7: Security (CORS & CSRF)
  // ===========================================================================
  it('Test 7: Security — blocks unauthorized cross-origin requests and rejects forged CSRF requests on production routes', async () => {
    // 1. Cross-Origin block on production app
    const resCorsBlocked = await supertest(app)
      .get('/api/v1/orders')
      .set('Origin', 'http://malicious-cross-origin.com')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resCorsBlocked.status).toBe(500);

    // 2. CSRF block on mutating production route authenticated via cookie without anti-CSRF header
    const resCsrfBlocked = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/review`)
      .set('Cookie', `fairresolve_session=${adminToken}`)
      .send({ decision: 'APPROVE', requestedAmount: 50.0 });
    expect(resCsrfBlocked.status).toBe(403);
    expect(resCsrfBlocked.body.error).toContain('CSRF verification failed');

    // 3. Legitimate request with X-Requested-With header passes CSRF verification
    const resCsrfAllowed = await supertest(app)
      .post(`/api/v1/cases/${testCase.id}/review`)
      .set('Cookie', `fairresolve_session=${adminToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ decision: 'APPROVE', requestedAmount: 50.0, reason: 'CSRF header present' });
    expect(resCsrfAllowed.status).toBe(200);
  });

  // ===========================================================================
  // TEST 8: PayPal response integrity
  // ===========================================================================
  it('Test 8: PayPal response integrity — rejects missing capture ID, missing amount, invalid currency, and unknown status', async () => {
    // 1. Missing capture ID
    await expect(
      paypalGateway.refundCapture({
        captureId: '',
        amount: 50.0,
        currency: 'USD',
        idempotencyKey: 'KEY-1',
      })
    ).rejects.toThrow('Missing required capture ID');

    // 2. Missing or zero amount
    await expect(
      paypalGateway.refundCapture({
        captureId: 'CAP-123',
        amount: 0,
        currency: 'USD',
        idempotencyKey: 'KEY-2',
      })
    ).rejects.toThrow('Invalid or missing refund amount');

    // 3. Invalid currency
    await expect(
      paypalGateway.refundCapture({
        captureId: 'CAP-123',
        amount: 50.0,
        currency: 'INVALID',
        idempotencyKey: 'KEY-3',
      })
    ).rejects.toThrow('Missing or invalid currency code');

    // 4. Response with unknown status is mapped to UNKNOWN and never defaulted to COMPLETED
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'REF-UNK-01',
        status: 'UNRECOGNIZED_STRANGE_STATUS',
        amount: { value: '50.00', currency_code: 'USD' },
      }),
    });
    const origFetch = global.fetch;
    global.fetch = mockFetch;
    try {
      vi.spyOn(paypalGateway, 'isConfigured').mockReturnValue(true);
      vi.spyOn(paypalGateway, 'getAccessToken').mockResolvedValue('test-token');

      const result = await paypalGateway.refundCapture({
        captureId: 'CAP-LIVE-SANDBOX-999',
        amount: 50.0,
        currency: 'USD',
        idempotencyKey: 'KEY-UNKNOWN-STATUS',
      });
      expect(result.status).toBe('UNKNOWN');
      expect(result.status).not.toBe('COMPLETED');
    } finally {
      global.fetch = origFetch;
    }
  });

  // ===========================================================================
  // TEST 9: Worker
  // ===========================================================================
  it('Test 9: Worker — processes jobs durably, retries with backoff, dead-letters after max attempts, and handles unknown events', async () => {
    const worker = new BackgroundWorker();

    // 1. Unknown event type throws and is not marked COMPLETED
    const unknownEvent: OutboxEvent = {
      id: 'box-unk-01',
      eventType: 'TOTALLY_UNKNOWN_EVENT_TYPE',
      tenantId,
      payload: {},
      status: 'PENDING',
      attempts: 0,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.outbox.push(unknownEvent);
    await worker.pollAndProcess();
    expect(unknownEvent.status).toBe('PENDING'); // remains pending with backoff
    expect(unknownEvent.attempts).toBe(1);
    expect(unknownEvent.lastError).toContain('Unsupported or unknown outbox event type');

    // 2. Dead-lettering: event exceeding 5 attempts is marked FAILED
    unknownEvent.attempts = 4;
    unknownEvent.nextAttemptAt = undefined;
    await worker.pollAndProcess();
    expect(unknownEvent.status).toBe('FAILED');
    expect(unknownEvent.lastError).toContain('Exceeded max 5 attempts');

    // 3. Expired lease acquisition
    const expiredLeaseEvent: OutboxEvent = {
      id: 'box-lease-01',
      eventType: 'INVITATION_EXPIRY_SWEEP',
      tenantId,
      payload: {},
      status: 'PROCESSING',
      lockedAt: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago (> 60s timeout)
      lockedBy: 'worker-dead-node',
      attempts: 1,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.outbox.push(expiredLeaseEvent);
    const processed = await worker.pollAndProcess();
    expect(processed).toBe(1);
    expect(expiredLeaseEvent.status).toBe('COMPLETED');
  });

  afterAll(async () => {
    db.setPostgresConnected(false, undefined);
  });
});
