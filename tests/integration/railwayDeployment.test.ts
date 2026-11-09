import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import pg from 'pg';
import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';
import { app } from '../../server';
import { db, Database } from '../../src/server/database';
import { authService } from '../../src/server/auth';
import { approvalService } from '../../src/server/approvalService';
import { paypalGateway } from '../../src/server/paypalGateway';
import { evidenceProcessor, getUploadsDir } from '../../src/server/evidenceProcessor';
import { backgroundWorker } from '../../src/server/worker';
import config from '../../src/server/config';
import { User, UserRole } from '../../src/types';

describe('FAIRRESOLVE — MINIMAL RAILWAY DEPLOYMENT VERIFICATION', () => {
  const tenantId = 'tenant-railway-01';
  let pool: pg.Pool;
  let ownerToken: string;
  let reviewerToken: string;
  let adminToken: string;
  let ownerUser: User;
  let reviewerUser: User;
  let adminUser: User;

  beforeEach(async () => {
    vi.restoreAllMocks();

    Object.keys(db.orders).forEach((k) => delete db.orders[k]);
    Object.keys(db.cases).forEach((k) => delete db.cases[k]);
    Object.keys(db.refundApprovals).forEach((k) => delete db.refundApprovals[k]);
    Object.keys(db.refundAttempts).forEach((k) => delete db.refundAttempts[k]);
    db.outbox.length = 0;

    // 1. Setup in-memory PostgreSQL instance for isolated testing
    const memDb = newDb();
    memDb.registerExtension('uuid-ossp', (schema) =>
      schema.registerFunction({
        name: 'uuid_generate_v4',
        implementation: () => crypto.randomUUID(),
      })
    );

    const schemaCandidates = [
      path.resolve(process.cwd(), 'src/server/database/schema.sql'),
      path.resolve(__dirname, '../../src/server/database/schema.sql'),
    ];
    const schemaFile = schemaCandidates.find((f) => fs.existsSync(f));
    if (!schemaFile) {
      throw new Error('schema.sql file not found for Railway tests.');
    }
    const schemaSql = fs.readFileSync(schemaFile, 'utf-8');
    memDb.public.none(schemaSql);

    const pgAdapter = memDb.adapters.createPg();
    pool = new pgAdapter.Pool() as unknown as pg.Pool;

    // Seed Tenant in memory before initTestPostgres so syncInitialDataToPostgres succeeds
    db.tenants[tenantId] = {
      id: tenantId,
      name: 'Railway Audio Labs',
      slug: 'railway-audio',
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };
    db.policies[tenantId] = [
      {
        version: 'v2.1',
        publishedAt: new Date().toISOString(),
        returnWindowDays: 30,
        requirePackagingPhotoForDamage: false,
        requireLabelPhotoForWrongItem: false,
        carrierDeliveryVerificationDays: 3,
        maxInstantRefundAmount: 250.0,
        mandatoryReturnThreshold: 200.0,
        allowPartialRefundsWithoutReturn: true,
        maxPartialRefundPercentage: 100,
        flagDuplicateEvidenceHash: true,
        description: 'Standard Railway Policy',
      },
    ];

    await db.initTestPostgres(pool);

    await pool.query(
      `INSERT INTO tenants (id, name, slug, currency) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, 'Railway Audio Labs', 'railway-audio', 'USD']
    );

    // 3. Seed Users & Sessions
    const setupUser = async (id: string, name: string, role: UserRole) => {
      const u: User = { id, name, email: `${id}@railway.fairresolve.io`, role, tenantId };
      db.users[id] = {
        ...u,
        passwordHash: 'scrypt$dummy_hash',
        passwordSalt: 'dummy_salt',
        createdAt: new Date().toISOString(),
      };
      await pool.query(
        `INSERT INTO users (id, tenant_id, email, name, role, password_hash, password_salt)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.tenantId, u.email, u.name, u.role, 'scrypt$dummy_hash', 'dummy_salt']
      );
      const { token } = authService.createSession(id, tenantId);
      return { user: u, token };
    };

    const oData = await setupUser('usr-rw-owner', 'Elena Railway', 'OWNER');
    ownerUser = oData.user;
    ownerToken = oData.token;

    const rData = await setupUser('usr-rw-reviewer', 'Sarah Reviewer', 'REVIEWER');
    reviewerUser = rData.user;
    reviewerToken = rData.token;

    const aData = await setupUser('usr-rw-admin', 'Marcus Admin', 'ADMIN');
    adminUser = aData.user;
    adminToken = aData.token;
  });

  afterAll(async () => {
    db.setPostgresConnected(false, undefined);
  });

  it('1. Database Readiness: db.waitForReady() resolves and /health/ready reflects postgres active', async () => {
    await expect(db.waitForReady()).resolves.toBeUndefined();

    const res = await supertest(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.postgresActive).toBe(true);
  });

  it('2. Actual Checkout Records Persist: Order, items, and case are persisted to PostgreSQL before 200 response', async () => {
    const paypalOrderId = 'PPO-RW-CAPTURE-100';

    // Mock PayPal capture order
    vi.spyOn(paypalGateway, 'captureOrder').mockResolvedValueOnce({
      orderId: paypalOrderId,
      captureId: 'CAP-RW-TEST-100',
      status: 'COMPLETED',
      grossAmount: 150.0,
      currency: 'USD',
      payerEmail: 'buyer.railway@example.com',
      isSimulated: true,
    });

    const res = await supertest(app)
      .post(`/api/v1/paypal/orders/${paypalOrderId}/capture`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        productType: 'headphones',
        buyerName: 'Railway Buyer',
        buyerEmail: 'buyer.railway@example.com',
        orderNumber: 'APX-RW-100',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.case).toBeDefined();

    const createdOrderId = res.body.order.id;
    const createdCaseId = res.body.case.id;

    // Verify order row exists in PostgreSQL
    const orderRows = await pool.query('SELECT * FROM orders WHERE id = $1', [createdOrderId]);
    expect(orderRows.rows.length).toBe(1);
    expect(orderRows.rows[0].paypal_capture_id).toBe('CAP-RW-TEST-100');
    expect(orderRows.rows[0].gross_amount_cents).toBe(15999);

    // Verify items exist in PostgreSQL order_items
    const itemRows = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [createdOrderId]);
    expect(itemRows.rows.length).toBeGreaterThan(0);
    expect(itemRows.rows[0].order_id).toBe(createdOrderId);

    // Verify case exists in PostgreSQL cases
    const caseRows = await pool.query('SELECT * FROM cases WHERE id = $1', [createdCaseId]);
    expect(caseRows.rows.length).toBe(1);
    expect(caseRows.rows[0].customer_name).toBe('Railway Buyer');
  });

  it('3. Refund Approval & Reservation: Persists to PostgreSQL and reserveRefundTransaction() locks rows successfully', async () => {
    // Seed Order in PostgreSQL
    const orderId = `ord-rw-persist-${Date.now()}`;
    const caseId = `case-rw-persist-${Date.now()}`;
    const captureId = `CAP-RW-LOCK-${Date.now()}`;
    const orderNumber = `APX-RW-LOCK-${Date.now()}`;

    await pool.query(
      `INSERT INTO orders (
        id, tenant_id, paypal_order_id, paypal_capture_id, order_number, buyer_name,
        buyer_email, currency, gross_amount_cents, shipping_amount_cents,
        refunded_amount_cents, refundable_amount_cents, status, transaction_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        orderId,
        tenantId,
        'PPO-RW-01',
        captureId,
        orderNumber,
        'Lock Customer',
        'lock@example.com',
        'USD',
        10000,
        0,
        0,
        10000,
        'COMPLETED',
        new Date().toISOString(),
      ]
    );

    // Seed Case in PostgreSQL
    await pool.query(
      `INSERT INTO cases (
        id, tenant_id, case_number, order_id, order_number, paypal_order_id, paypal_capture_id,
        customer_name, customer_email, status, issue_type, requested_resolution, customer_description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        caseId,
        tenantId,
        'FR-RW-01',
        orderId,
        orderNumber,
        'PPO-RW-01',
        captureId,
        'Lock Customer',
        'lock@example.com',
        'READY_FOR_REVIEW',
        'damaged_item',
        'full_refund',
        'Testing durable approval flow',
      ]
    );

    // Sync in-memory records
    db.orders[orderId] = {
      id: orderId,
      tenantId,
      paypalOrderId: 'PPO-RW-01',
      paypalCaptureId: captureId,
      orderNumber,
      buyerName: 'Lock Customer',
      buyerEmail: 'lock@example.com',
      currency: 'USD',
      grossAmount: 100.0,
      shippingAmount: 0.0,
      refundedAmount: 0.0,
      refundableAmount: 100.0,
      status: 'COMPLETED',
      items: [],
      transactionDate: new Date().toISOString(),
    };

    db.cases[caseId] = {
      id: caseId,
      tenantId,
      caseNumber: 'FR-RW-01',
      orderId,
      orderNumber,
      paypalOrderId: 'PPO-RW-01',
      paypalCaptureId: captureId,
      customerName: 'Lock Customer',
      customerEmail: 'lock@example.com',
      customerAccessToken: 'tok_test',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Testing durable approval flow',
      evidence: [],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Reviewer approves refund via API
    const approveRes = await supertest(app)
      .post(`/api/v1/cases/${caseId}/approve-refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 60.0, reason: 'Approved under return policy' });

    expect(approveRes.status).toBe(200);
    const approvalId = approveRes.body.approval.id;

    // Verify approval row exists in PostgreSQL
    const approvalRows = await pool.query('SELECT * FROM refund_approvals WHERE id = $1', [approvalId]);
    expect(approvalRows.rows.length).toBe(1);
    expect(approvalRows.rows[0].approved_amount_cents).toBe(6000);
    expect(approvalRows.rows[0].status).toBe('ACTIVE');

    // Admin reserves refund transaction against PostgreSQL
    const reservation = await db.reserveRefundTransaction({
      caseId,
      orderId,
      tenantId,
      approvalId,
      approverId: reviewerUser.id,
      executorId: adminUser.id,
      captureId,
      idempotencyKey: 'IDEMP-RW-LOCK-01',
      amountCents: 6000,
      amountDollars: 60.0,
      currency: 'USD',
      reason: 'Execution of approved refund',
      user: adminUser,
    });

    expect(reservation.refundAttempt).toBeDefined();
    expect(reservation.refundAttempt.status).toBe('RESERVED');
    expect(reservation.refundAttempt.amount).toBe(60.0);
  });

  it('4. Durable Outbox: backgroundWorker.enqueue() inserts to PostgreSQL before resolving', async () => {
    const event = await backgroundWorker.enqueue({
      eventType: 'RECONCILE_PENDING_REFUND',
      tenantId,
      payload: {
        caseId: 'case-recon-rw',
        refundAttemptId: 'ref-rw-01',
        captureId: 'CAP-RW-01',
      },
    });

    expect(event.id).toBeDefined();
    expect(event.status).toBe('PENDING');

    // Verify row was inserted into PostgreSQL outbox_events table
    const outboxRows = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [event.id]);
    expect(outboxRows.rows.length).toBe(1);
    expect(outboxRows.rows[0].event_type).toBe('RECONCILE_PENDING_REFUND');
    expect(outboxRows.rows[0].status).toBe('PENDING');
  });

  it('5. Storage Path: Evidence processor honors FAIRRESOLVE_STORAGE_DIR', async () => {
    const testDir = path.resolve(process.cwd(), 'temp_test_storage');
    config.FAIRRESOLVE_STORAGE_DIR = testDir;

    const expectedUploadsDir = path.join(testDir, 'private_uploads');
    const actualUploadsDir = getUploadsDir();

    expect(actualUploadsDir).toBe(expectedUploadsDir);
    expect(fs.existsSync(actualUploadsDir)).toBe(true);

    // Clean up temp dir
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_) {}
    config.FAIRRESOLVE_STORAGE_DIR = '';
  });

  it('6. PayPal Sandbox Safety Guard: Live payments remain disabled', () => {
    const diag = paypalGateway.getDiagnostics();
    expect(diag.isConfigured).toBeDefined();
    expect(config.PAYPAL_ENVIRONMENT).toBe('sandbox');
    expect(config.PAYPAL_LIVE_ENABLED).toBe(false);

    const status = db.getGatewayStatus();
    expect(status.environment).toBe('sandbox');
    expect(status.liveEnabled).toBe(false);
  });
});
