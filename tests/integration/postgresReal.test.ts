import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import pg from 'pg';
import crypto from 'crypto';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { app } from '../../server';
import { db, Database } from '../../src/server/database';
import { runMigrations } from '../../src/server/database/migrations';
import { backgroundWorker } from '../../src/server/worker';
import { geminiService } from '../../src/server/geminiService';
import { paypalGateway } from '../../src/server/paypalGateway';
import { toCents } from '../../src/server/policyEngine';
import config from '../../src/server/config';

const RAW_DATABASE_URL = process.env.DATABASE_URL?.trim() || '';
const HAS_REAL_PG = Boolean(RAW_DATABASE_URL);

describe('FAIRRESOLVE — REAL POSTGRESQL 16 AUTHORITATIVE PERSISTENCE & MIGRATION TESTS', () => {
  let pool: pg.Pool;
  let tempStorageDir: string;
  const origStorageDir = config.FAIRRESOLVE_STORAGE_DIR;
  const origClientId = (paypalGateway as any).clientId;
  const origClientSecret = (paypalGateway as any).clientSecret;
  const origGeminiAi = (geminiService as any).ai;

  it('requires real PostgreSQL in CI environment (never silently skipped in CI)', () => {
    if (process.env.CI === 'true' && !HAS_REAL_PG) {
      throw new Error('CI pipeline MUST provide DATABASE_URL pointing to PostgreSQL.');
    }
    if (!HAS_REAL_PG) {
      console.warn('[postgresReal.test.ts] Skipping live PostgreSQL suite locally because DATABASE_URL is unset.');
    }
    expect(true).toBe(true);
  });

  beforeAll(async () => {
    if (!HAS_REAL_PG) return;

    tempStorageDir = path.resolve(process.cwd(), `temp_pg_real_${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    config.FAIRRESOLVE_STORAGE_DIR = tempStorageDir;
    (paypalGateway as any).clientId = '';
    (paypalGateway as any).clientSecret = '';
    (geminiService as any).ai = undefined;

    pool = new pg.Pool({ connectionString: RAW_DATABASE_URL });
    await pool.query('SELECT 1');

    // Start from a completely clean public schema so v1 -> v2 -> v3 migration upgrade path is exercised
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  });

  afterAll(async () => {
    (paypalGateway as any).clientId = origClientId;
    (paypalGateway as any).clientSecret = origClientSecret;
    (geminiService as any).ai = origGeminiAi;
    config.FAIRRESOLVE_STORAGE_DIR = origStorageDir;
    if (tempStorageDir && fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
    if (pool) {
      await pool.end().catch(() => {});
    }
    await db.closePool().catch(() => {});
  });

  it.runIf(HAS_REAL_PG)(
    '1. Applies migrations v1->v2->v3 idempotently, preserves COMPLETED->SUCCEEDED compatibility, and survives schema_migrations rerun',
    async () => {
      // Simulate an existing v1 database with legacy 'COMPLETED' refund attempt row before running v2+v3
      const schemaSql = fs.readFileSync(path.resolve(process.cwd(), 'src/server/database/schema.sql'), 'utf-8');
      await pool.query(schemaSql);

      // Seed minimal tenant, user, order, case, and legacy COMPLETED refund attempt
      await pool.query(`INSERT INTO tenants (id, name, slug) VALUES ('t-mig', 'Mig Corp', 'mig-corp')`);
      await pool.query(
        `INSERT INTO users (id, tenant_id, name, email, role, password_salt, password_hash) VALUES ('u-mig', 't-mig', 'Owner', 'owner@mig.test', 'OWNER', 'salt', 'hash')`
      );
      await pool.query(
        `INSERT INTO orders (id, tenant_id, paypal_order_id, paypal_capture_id, order_number, buyer_name, buyer_email, currency, gross_amount_cents, shipping_amount_cents, refunded_amount_cents, refundable_amount_cents, status, transaction_date)
         VALUES ('o-mig', 't-mig', 'PPO-MIG', 'CAP-MIG', 'APX-MIG', 'Buyer', 'buyer@mig.test', 'USD', 5000, 0, 5000, 0, 'REFUNDED', NOW())`
      );
      await pool.query(
        `INSERT INTO cases (id, tenant_id, case_number, order_id, order_number, paypal_order_id, paypal_capture_id, customer_name, customer_email, status, issue_type, requested_resolution, customer_description)
         VALUES ('c-mig', 't-mig', 'FR-MIG', 'o-mig', 'APX-MIG', 'PPO-MIG', 'CAP-MIG', 'Buyer', 'buyer@mig.test', 'REFUNDED', 'damaged_item', 'full_refund', 'test')`
      );
      await pool.query(
        `INSERT INTO refund_attempts (id, case_id, tenant_id, capture_id, idempotency_key, amount_cents, currency, reason, status, authorized_by_user_id)
         VALUES ('att-legacy-completed', 'c-mig', 't-mig', 'CAP-MIG', 'idemp-mig', 5000, 'USD', 'Legacy completed refund', 'COMPLETED', 'u-mig')`
      );

      // Simulate pre-migration schema without schema_migrations / pending_checkouts
      await pool.query('DROP TABLE IF EXISTS pending_checkouts, schema_migrations CASCADE');

      const firstRun = await runMigrations(pool);
      expect(firstRun.appliedVersions).toContain(2);
      expect(firstRun.appliedVersions).toContain(3);
      expect(firstRun.appliedVersions).toContain(4);

      const secondRun = await runMigrations(pool);
      expect(secondRun.appliedVersions).toEqual([]);

      // Verify legacy 'COMPLETED' refund attempt is normalized to 'SUCCEEDED' when loaded by Database
      await db.initPostgres(RAW_DATABASE_URL);
      expect(db.isPostgresActive()).toBe(true);
      expect(await db.pingPostgres()).toBe(true);
      expect(db.refundAttempts['att-legacy-completed']?.status).toBe('SUCCEEDED');

      // Also verify /health/ready succeeds against real Postgres 16
      const readyRes = await supertest(app).get('/health/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.status).toBe('ready');
      expect(readyRes.body.postgresActive).toBe(true);
      expect(readyRes.body.postgresPingOk).toBe(true);
      expect(readyRes.body.migrationVersion).toBeGreaterThanOrEqual(4);
    }
  );

  it.runIf(HAS_REAL_PG)(
    '2. Full E2E API lifecycle persists to PostgreSQL 16 and survives fresh Database reload without JSON reliance',
    async () => {
      vi.restoreAllMocks();
      // Reset to clean migrated schema and clean in-memory DB state
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      db.reseed();
      await db.initPostgres(RAW_DATABASE_URL);

      // A. Register OWNER merchant
      const regRes = await supertest(app)
        .post('/api/v1/auth/register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Real PG Owner',
          email: 'owner.pg@fairresolve.test',
          password: 'PgPassword123!',
          companyName: 'Real PG Audio Store',
        });
      expect(regRes.status).toBe(200);
      const ownerToken = regRes.body.token;
      const tenantId = regRes.body.user.tenantId;

      // B. Invite and accept ADMIN user for four-eyes execution
      const invRes = await supertest(app)
        .post('/api/v1/merchant/team/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'PG Admin', email: 'admin.pg@fairresolve.test', role: 'ADMIN' });
      expect(invRes.status).toBe(200);

      const acceptRes = await supertest(app)
        .post('/api/v1/merchant/invitations/accept')
        .send({
          token: invRes.body.rawInviteToken,
          name: 'Real PG Admin',
          password: 'PgPassword123!',
        });
      expect(acceptRes.status).toBe(200);
      const adminToken = acceptRes.body.token;

      // C. Publish merchant refund policy
      const polRes = await supertest(app)
        .post('/api/v1/policies/publish')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          returnWindowDays: 45,
          requirePackagingPhotoForDamage: true,
          requireLabelPhotoForWrongItem: true,
          mandatoryReturnThreshold: 300,
          allowPartialRefundsWithoutReturn: true,
          maxPartialRefundPercentage: 50,
          description: 'Real PG Policy v2',
        });
      expect(polRes.status).toBe(200);
      const polRows = await pool.query('SELECT * FROM policies WHERE tenant_id = $1', [tenantId]);
      expect(polRows.rows.length).toBeGreaterThanOrEqual(2);

      // D. Two-step PayPal checkout (create + capture)
      const createRes = await supertest(app)
        .post('/api/v1/paypal/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ productType: 'shoes', buyerName: 'PG Customer', buyerEmail: 'buyer.pg@test.com' });
      expect(createRes.status).toBe(200);
      const paypalOrderId = createRes.body.orderId;
      expect(createRes.body.grossAmount).toBe(129.0);

      const capRes = await supertest(app)
        .post(`/api/v1/paypal/orders/${paypalOrderId}/capture`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});
      expect(capRes.status).toBe(200);
      const orderId = capRes.body.order.id;
      const caseId = capRes.body.case.id;
      const customerToken = capRes.body.case.customerAccessToken;

      // E. Customer portal submit with real PNG created by sharp
      const validPng = await sharp({
        create: { width: 48, height: 48, channels: 3, background: { r: 10, g: 120, b: 220 } },
      })
        .png()
        .toBuffer();

      const submitRes = await supertest(app)
        .post(`/api/v1/customer/case/${customerToken}/submit`)
        .send({
          issueType: 'damaged_item',
          description: 'Arrived cracked in shipping box; packaging photo attached.',
          requestedResolution: 'full_refund',
          uploadedFiles: [
            {
              filename: 'damage-pg.png',
              fileBase64: `data:image/png;base64,${validPng.toString('base64')}`,
              evidenceType: 'packaging_photo',
            },
          ],
        });
      expect(submitRes.status).toBe(200);

      const evRows = await pool.query('SELECT * FROM evidence_objects WHERE case_id = $1', [caseId]);
      expect(evRows.rows.length).toBe(1);
      const polEvalRows = await pool.query('SELECT * FROM policy_evaluations WHERE case_id = $1', [caseId]);
      expect(polEvalRows.rows.length).toBeGreaterThanOrEqual(1);

      // F. Merchant OWNER approves refund, ADMIN executes $50 partial refund
      const appRes = await supertest(app)
        .post(`/api/v1/cases/${caseId}/approve-refund`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ amount: 50.0, reason: 'PG partial settlement' });
      expect(appRes.status).toBe(200);

      const execRes = await supertest(app)
        .post(`/api/v1/cases/${caseId}/execute-refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50.0, idempotencyKey: `PG-REF-KEY-${Date.now()}` });
      expect(execRes.status).toBe(200);
      expect(execRes.body.success).toBe(true);
      expect(execRes.body.refundAttempt.status).toBe('SUCCEEDED');
      expect(toCents(execRes.body.order.refundableAmount)).toBe(7900); // 129.00 - 50.00 = 79.00

      // Verify PostgreSQL tables directly
      const ordPg = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      expect(Number(ordPg.rows[0].refunded_amount_cents)).toBe(5000);
      expect(Number(ordPg.rows[0].refundable_amount_cents)).toBe(7900);
      expect(ordPg.rows[0].status).toBe('PARTIALLY_REFUNDED');

      const attPg = await pool.query('SELECT * FROM refund_attempts WHERE case_id = $1', [caseId]);
      expect(attPg.rows.length).toBe(1);
      expect(attPg.rows[0].status).toBe('SUCCEEDED');
      expect(attPg.rows[0].approver_id).toBe(regRes.body.user.id);
      expect(attPg.rows[0].executor_id).toBe(acceptRes.body.user.id);

      const auditPg = await pool.query('SELECT * FROM audit_events WHERE case_id = $1 ORDER BY timestamp ASC', [caseId]);
      expect(auditPg.rows.some((r) => r.event_type === 'REFUND_EXECUTED')).toBe(true);

      // G. Simulated Server Restart: Flush in-flight async writes, delete JSON mirror, and reload fresh Database from PostgreSQL
      await db.flush();
      const jsonPath = path.join(tempStorageDir, 'fairresolve_db.json');
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

      const reloadedDb = new Database();
      await reloadedDb.initPostgres(RAW_DATABASE_URL);
      try {
        expect(reloadedDb.users[regRes.body.user.id]?.email).toBe('owner.pg@fairresolve.test');
        expect(reloadedDb.users[acceptRes.body.user.id]?.role).toBe('ADMIN');
        expect(reloadedDb.orders[orderId]?.refundableAmount).toBe(79.0);
        expect(reloadedDb.cases[caseId]?.evidence.length).toBe(1);
        expect(reloadedDb.cases[caseId]?.refundAttempts[0]?.status).toBe('SUCCEEDED');
        expect(reloadedDb.verifyAuditChainIntegrity().isValid).toBe(true);
      } finally {
        await reloadedDb.closePool();
      }
    }
  );

  it.runIf(HAS_REAL_PG)(
    '3. Timeout refund reconciliation and webhook persistence work end-to-end against real PostgreSQL 16',
    async () => {
      vi.restoreAllMocks();
      const origSecret = config.PAYPAL_WEBHOOK_ID;
      const origCid = (paypalGateway as any).clientId;
      const origCsec = (paypalGateway as any).clientSecret;

      try {
        // Use seeded/existing tenant & approve/execute second refund against same case created or fresh order
        const createRes = await supertest(app)
          .post('/api/v1/auth/register')
          .send({
            name: 'Recon Owner',
            email: `recon.owner.${Date.now()}@test.com`,
            password: 'PgPassword123!',
            companyName: 'Recon Corp',
          });
        const ownerTok = createRes.body.token;
        const inv = await supertest(app)
          .post('/api/v1/merchant/team/invite')
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({ name: 'Recon Admin', email: `recon.admin.${Date.now()}@test.com`, role: 'ADMIN' });
        const acc = await supertest(app)
          .post('/api/v1/merchant/invitations/accept')
          .send({ token: inv.body.rawInviteToken, name: 'Recon Admin', password: 'PgPassword123!' });
        const adminTok = acc.body.token;

        const ordCreate = await supertest(app)
          .post('/api/v1/paypal/orders')
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({ productType: 'tracker' });
        const cap = await supertest(app)
          .post(`/api/v1/paypal/orders/${ordCreate.body.orderId}/capture`)
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({});
        const caseId = cap.body.case.id;
        const orderId = cap.body.order.id;

        const appRes = await supertest(app)
          .post(`/api/v1/cases/${caseId}/approve-refund`)
          .set('Authorization', `Bearer ${ownerTok}`)
          .send({ amount: 30.0, reason: 'Timeout recon test' });
        expect(appRes.status).toBe(200);

        const timeoutErr: any = new Error('Gateway socket timeout');
        timeoutErr.code = 'ETIMEDOUT';
        vi.spyOn(paypalGateway, 'refundCapture').mockRejectedValueOnce(timeoutErr);

        const execRes = await supertest(app)
          .post(`/api/v1/cases/${caseId}/execute-refund`)
          .set('Authorization', `Bearer ${adminTok}`)
          .send({ amount: 30.0, idempotencyKey: `PG-RECON-${Date.now()}` });

        expect(execRes.status).toBe(202);
        expect(execRes.body.status).toBe('RECONCILIATION_REQUIRED');

        const attemptId = execRes.body.refundAttempt.id;
        // Simulate provider refund ID discovered + outbox eligible immediately for deterministic worker check
        await pool.query(
          `UPDATE refund_attempts SET paypal_refund_id = 'SIM-SANDBOX-REF-PG1' WHERE id = $1`,
          [attemptId]
        );
        db.refundAttempts[attemptId].paypalRefundId = 'SIM-SANDBOX-REF-PG1';
        await pool.query(
          `UPDATE outbox_events SET next_attempt_at = NOW() - INTERVAL '5 seconds' WHERE event_type = 'RECONCILE_PENDING_REFUND'`
        );

        const processed = await backgroundWorker.pollAndProcess();
        expect(processed).toBe(1);

        const ordAfter = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        expect(Number(ordAfter.rows[0].refunded_amount_cents)).toBe(3000);
        expect(Number(ordAfter.rows[0].refundable_amount_cents)).toBe(3900);

        // Verified webhook persistence check
        (paypalGateway as any).clientId = 'sb-cid';
        (paypalGateway as any).clientSecret = 'sb-sec';
        config.PAYPAL_WEBHOOK_ID = 'WH-PG-TEST';
        vi.spyOn(paypalGateway, 'verifyWebhookSignature').mockResolvedValueOnce(true);

        const whId = `WH-PG-EV-${Date.now()}`;
        const whRes = await supertest(app)
          .post('/api/v1/webhooks/paypal')
          .set('paypal-auth-algo', 'SHA256withRSA')
          .set('paypal-cert-url', 'https://api.sandbox.paypal.com/cert.pem')
          .set('paypal-transmission-id', 'tx-pg-1')
          .set('paypal-transmission-sig', 'sig-pg-1')
          .set('paypal-transmission-time', new Date().toISOString())
          .send({ id: whId, event_type: 'CHECKOUT.ORDER.APPROVED', resource: {} });
        expect(whRes.status).toBe(200);

        const whRows = await pool.query('SELECT * FROM paypal_webhook_events WHERE event_id = $1', [whId]);
        expect(whRows.rows.length).toBe(1);
        expect(whRows.rows[0].processed).toBe(true);
      } finally {
        (paypalGateway as any).clientId = origCid;
        (paypalGateway as any).clientSecret = origCsec;
        config.PAYPAL_WEBHOOK_ID = origSecret;
      }
    }
  );
});
