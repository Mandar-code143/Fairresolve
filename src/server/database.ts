/**
 * FairResolve Durable Database & Persistence Layer
 *
 * Provides transactional file-backed relational persistence for:
 * - Tenants, Users, Memberships, Sessions
 * - PayPal Orders, Captures, Items
 * - Dispute Cases, Evidence Objects, Customer Tokens
 * - Immutable Policy Versions & Evaluations
 * - Refund Attempts (with PayPal-Request-Id idempotency)
 * - Tamper-evident Audit Events with SHA-256 hash chaining
 * - Asynchronous Transactional Outbox Events
 *
 * Data is atomically written to disk and survives server restarts.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import {
  Case,
  CaseEvent,
  EvidenceObject,
  MerchantInvitation,
  Order,
  PayPalGatewayStatus,
  RefundApproval,
  RefundAttempt,
  RefundPolicy,
  Tenant,
  User,
  UserRole,
} from '../types';
import { paypalGateway } from './paypalGateway';
import config from './config';

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
  ipAddress?: string;
  isRevoked: boolean;
}

export interface UserAccount extends User {
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface OutboxEvent {
  id: string;
  eventType: string;
  tenantId?: string;
  payload: any;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  retryCount: number;
  attempts?: number;
  idempotencyKey?: string;
  lockedAt?: string;
  lockedBy?: string;
  nextAttemptAt?: string;
  createdAt: string;
  processedAt?: string;
  lastError?: string;
}

export interface DatabaseSchema {
  version: number;
  tenants: Record<string, Tenant>;
  users: Record<string, UserAccount>;
  sessions: Record<string, Session>;
  orders: Record<string, Order>;
  cases: Record<string, Case>;
  policies: Record<string, RefundPolicy[]>;
  refundAttempts: Record<string, RefundAttempt>;
  refundApprovals: Record<string, RefundApproval>;
  auditEvents: CaseEvent[];
  outbox: OutboxEvent[];
  invitations: Record<string, MerchantInvitation>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'fairresolve_db.json');

export class Database {
  private data: DatabaseSchema;
  private saveDebounceTimer?: NodeJS.Timeout;
  private pgPool?: pg.Pool;
  private isPostgresConnected: boolean = false;
  private processedWebhookIds: Set<string> = new Set();

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.warn('Failed to parse database file, re-initializing schema:', err);
        this.data = this.getDefaultSchema();
        this.saveSync();
      }
    } else {
      this.data = this.getDefaultSchema();
      this.seedInitialData();
      this.saveSync();
    }

    if (process.env.NODE_ENV === 'production' && (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '')) {
      console.error('[Database] FATAL: Production environment requires DATABASE_URL to be configured.');
      throw new Error('Production database connection failed: DATABASE_URL is required in production.');
    }

    this.initPostgres().catch((err) => {
      if (process.env.NODE_ENV === 'production') {
        console.error('[Database] Unhandled PostgreSQL connection error in production:', err);
      }
    });
  }

  public async initPostgres() {
    const dbUrl = process.env.DATABASE_URL;

    if (process.env.NODE_ENV === 'production' && (!dbUrl || dbUrl.trim() === '')) {
      console.error('[Database] FATAL: Production environment requires DATABASE_URL to be configured.');
      throw new Error('Production database connection failed: DATABASE_URL is required in production.');
    }

    if (dbUrl && dbUrl.trim() !== '') {
      try {
        this.pgPool = new pg.Pool({ connectionString: dbUrl, max: 10 });
        const client = await this.pgPool.connect();
        try {
          // Verify or create schema migrations registry
          await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INT PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `);

          const res = await client.query('SELECT version FROM schema_migrations WHERE version = 1');
          if (res.rows.length === 0) {
            const candidates = [
              path.resolve(__dirname, 'database', 'schema.sql'),
              path.resolve(__dirname, '../src/server/database/schema.sql'),
              path.resolve(process.cwd(), 'src/server/database/schema.sql'),
              path.resolve(process.cwd(), 'dist/database/schema.sql'),
            ];
            const schemaPath = candidates.find((p) => fs.existsSync(p));
            if (schemaPath) {
              const sql = fs.readFileSync(schemaPath, 'utf-8');
              await client.query(sql);
              await client.query('INSERT INTO schema_migrations (version, name) VALUES (1, $1)', ['initial_relational_schema']);
              console.log('[Database] Applied migration 1: initial_relational_schema from ' + schemaPath);
            }
          }
          this.isPostgresConnected = true;
          console.log('[Database] PostgreSQL connected and schema verified successfully.');
        } finally {
          client.release();
        }

        await this.syncInitialDataToPostgres();
        await this.loadFromPostgres();
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
          console.error('[Database] FATAL: PostgreSQL connection failed:', err.message);
          throw new Error(`Production database connection failed: ${err.message}`);
        }
        console.warn('[Database] PostgreSQL connection failed, operating with durable atomic persistence:', err.message);
        this.isPostgresConnected = false;
      }
    }
  }

  public setPostgresConnected(active: boolean, pool?: pg.Pool) {
    this.isPostgresConnected = active;
    this.pgPool = pool;
  }

  /**
   * Test-only initialization allowing injection of in-memory or mock PostgreSQL pool
   */
  public async initTestPostgres(pool: pg.Pool) {
    this.pgPool = pool;
    this.isPostgresConnected = true;

    const client = await this.pgPool.connect();
    try {
      const res = await client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants'").catch(() => ({ rows: [] }));
      if (res.rows.length === 0) {
        const candidates = [
          path.resolve(__dirname, 'database', 'schema.sql'),
          path.resolve(__dirname, '../src/server/database/schema.sql'),
          path.resolve(process.cwd(), 'src/server/database/schema.sql'),
          path.resolve(process.cwd(), 'dist/database/schema.sql'),
        ];
        const schemaPath = candidates.find((p) => fs.existsSync(p));
        if (schemaPath) {
          const sql = fs.readFileSync(schemaPath, 'utf-8');
          await client.query(sql);
        }
      }
    } finally {
      client.release();
    }

    await this.syncInitialDataToPostgres();
    await this.loadFromPostgres();
  }

  /**
   * Seed relational PostgreSQL tables from in-memory initial state if empty
   */
  public async syncInitialDataToPostgres() {
    if (!this.pgPool || !this.isPostgresConnected) return;

    try {
      const tenantCheck = await this.pgPool.query('SELECT COUNT(*) as count FROM tenants');
      if (parseInt(tenantCheck.rows[0].count, 10) === 0) {
        // Sync tenants
        for (const t of Object.values(this.data.tenants)) {
          await this.pgPool.query(
            `INSERT INTO tenants (id, name, slug, currency, created_at)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
            [t.id, t.name, t.slug, t.currency, t.createdAt]
          );
        }

        // Sync users
        for (const u of Object.values(this.data.users)) {
          await this.pgPool.query(
            `INSERT INTO users (id, tenant_id, email, name, role, password_hash, password_salt, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
            [u.id, u.tenantId, u.email, u.name, u.role, u.passwordHash, u.passwordSalt, u.createdAt]
          );
        }

        // Sync policies
        for (const [tenantId, policies] of Object.entries(this.data.policies)) {
          for (const p of policies) {
            const policyId = `pol-${tenantId}-${p.version}`;
            await this.pgPool.query(
              `INSERT INTO policies (
                id, tenant_id, version, return_window_days, require_packaging_photo_for_damage,
                require_label_photo_for_wrong_item, carrier_delivery_verification_days,
                max_instant_refund_cents, mandatory_return_threshold_cents,
                allow_partial_refunds_without_return, max_partial_refund_percentage,
                flag_duplicate_evidence_hash, description, published_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (id) DO NOTHING`,
              [
                policyId,
                tenantId,
                p.version,
                p.returnWindowDays,
                p.requirePackagingPhotoForDamage,
                p.requireLabelPhotoForWrongItem,
                p.carrierDeliveryVerificationDays,
                Math.round(p.maxInstantRefundAmount * 100),
                Math.round(p.mandatoryReturnThreshold * 100),
                p.allowPartialRefundsWithoutReturn,
                p.maxPartialRefundPercentage,
                p.flagDuplicateEvidenceHash,
                p.description,
                p.publishedAt,
              ]
            );
          }
        }

        // Sync orders
        for (const o of Object.values(this.data.orders)) {
          await this.pgPool.query(
            `INSERT INTO orders (
              id, tenant_id, paypal_order_id, paypal_capture_id, order_number, buyer_name,
              buyer_email, currency, gross_amount_cents, shipping_amount_cents,
              refunded_amount_cents, refundable_amount_cents, shipping_carrier, tracking_number,
              delivery_date, status, transaction_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO NOTHING`,
            [
              o.id,
              o.tenantId,
              o.paypalOrderId,
              o.paypalCaptureId,
              o.orderNumber,
              o.buyerName,
              o.buyerEmail,
              o.currency,
              Math.round(o.grossAmount * 100),
              Math.round((o.shippingAmount || 0) * 100),
              Math.round(o.refundedAmount * 100),
              Math.round(o.refundableAmount * 100),
              o.shippingCarrier || null,
              o.trackingNumber || null,
              o.deliveryDate || null,
              o.status,
              o.transactionDate,
            ]
          );

          if (o.items) {
            for (const item of o.items) {
              await this.pgPool.query(
                `INSERT INTO order_items (id, order_id, sku, name, quantity, unit_price_cents, total_price_cents)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
                [
                  item.id,
                  o.id,
                  item.sku,
                  item.name,
                  item.quantity,
                  Math.round(item.unitPrice * 100),
                  Math.round(item.totalPrice * 100),
                ]
              );
            }
          }
        }

        // Sync cases
        for (const c of Object.values(this.data.cases)) {
          await this.pgPool.query(
            `INSERT INTO cases (
              id, tenant_id, case_number, order_id, order_number, paypal_order_id, paypal_capture_id,
              customer_name, customer_email, status, issue_type, requested_resolution,
              customer_description, merchant_notes, assigned_to, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO NOTHING`,
            [
              c.id,
              c.tenantId,
              c.caseNumber,
              c.orderId,
              c.orderNumber,
              c.paypalOrderId,
              c.paypalCaptureId,
              c.customerName,
              c.customerEmail,
              c.status,
              c.issueType,
              c.requestedResolution,
              c.customerDescription,
              c.merchantNotes || null,
              c.assignedTo || null,
              c.createdAt,
              c.updatedAt,
            ]
          );

          if (c.evidence) {
            for (const ev of c.evidence) {
              await this.pgPool.query(
                `INSERT INTO evidence_objects (
                  id, case_id, tenant_id, original_filename, storage_path, mime_type, byte_size,
                  width, height, sha256_hash, is_duplicate, scan_status, evidence_type, caption, uploaded_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                ON CONFLICT (id) DO NOTHING`,
                [
                  ev.id,
                  c.id,
                  c.tenantId,
                  ev.originalFilename,
                  ev.downloadUrl || `/api/v1/evidence/${ev.id}/file`,
                  ev.mimeType,
                  ev.byteSize,
                  ev.width || null,
                  ev.height || null,
                  ev.sha256Hash,
                  ev.isDuplicate || false,
                  ev.scanStatus || 'clean',
                  ev.evidenceType || 'item_photo',
                  ev.caption || null,
                  ev.uploadedAt,
                ]
              );
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[Database] Sync to PostgreSQL encountered an issue:', err.message);
    }
  }

  /**
   * Authoritative read from PostgreSQL: populates internal state strictly from DB tables
   */
  public async loadFromPostgres() {
    if (!this.pgPool || !this.isPostgresConnected) return;

    try {
      // 1. Tenants
      const tRes = await this.pgPool.query('SELECT * FROM tenants');
      for (const row of tRes.rows) {
        this.data.tenants[row.id] = {
          id: row.id,
          name: row.name,
          slug: row.slug,
          currency: row.currency,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        };
      }

      // 2. Users
      const uRes = await this.pgPool.query('SELECT * FROM users');
      for (const row of uRes.rows) {
        this.data.users[row.id] = {
          id: row.id,
          tenantId: row.tenant_id,
          email: row.email,
          name: row.name,
          role: row.role as UserRole,
          passwordHash: row.password_hash,
          passwordSalt: row.password_salt,
          avatarUrl: row.avatar_url || undefined,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        };
      }

      // 3. Sessions
      const sRes = await this.pgPool.query('SELECT * FROM sessions WHERE is_revoked = false');
      for (const row of sRes.rows) {
        this.data.sessions[row.id] = {
          id: row.id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          tokenHash: row.token_hash,
          userAgent: row.user_agent || undefined,
          ipAddress: row.ip_address || undefined,
          isRevoked: Boolean(row.is_revoked),
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : new Date().toISOString(),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        };
      }

      // 4. Policies
      const pRes = await this.pgPool.query('SELECT * FROM policies');
      for (const row of pRes.rows) {
        if (!this.data.policies[row.tenant_id]) {
          this.data.policies[row.tenant_id] = [];
        }
        const pol: RefundPolicy = {
          version: row.version,
          publishedAt: row.published_at ? new Date(row.published_at).toISOString() : new Date().toISOString(),
          returnWindowDays: row.return_window_days,
          requirePackagingPhotoForDamage: Boolean(row.require_packaging_photo_for_damage),
          requireLabelPhotoForWrongItem: Boolean(row.require_label_photo_for_wrong_item),
          carrierDeliveryVerificationDays: row.carrier_delivery_verification_days,
          maxInstantRefundAmount: Number(row.max_instant_refund_cents) / 100,
          mandatoryReturnThreshold: Number(row.mandatory_return_threshold_cents) / 100,
          allowPartialRefundsWithoutReturn: Boolean(row.allow_partial_refunds_without_return),
          maxPartialRefundPercentage: row.max_partial_refund_percentage,
          flagDuplicateEvidenceHash: Boolean(row.flag_duplicate_evidence_hash),
          description: row.description || '',
        };
        const exists = this.data.policies[row.tenant_id].some((p) => p.version === pol.version);
        if (!exists) {
          this.data.policies[row.tenant_id].push(pol);
        }
      }

      // 5. Orders & Items
      const oRes = await this.pgPool.query('SELECT * FROM orders');
      const itemsRes = await this.pgPool.query('SELECT * FROM order_items');
      const itemsByOrder: Record<string, any[]> = {};
      for (const itemRow of itemsRes.rows) {
        if (!itemsByOrder[itemRow.order_id]) itemsByOrder[itemRow.order_id] = [];
        itemsByOrder[itemRow.order_id].push({
          id: itemRow.id,
          sku: itemRow.sku,
          name: itemRow.name,
          quantity: itemRow.quantity,
          unitPrice: Number(itemRow.unit_price_cents) / 100,
          totalPrice: Number(itemRow.total_price_cents) / 100,
          imageUrl: itemRow.image_url || undefined,
        });
      }

      for (const row of oRes.rows) {
        this.data.orders[row.id] = {
          id: row.id,
          tenantId: row.tenant_id,
          paypalOrderId: row.paypal_order_id,
          paypalCaptureId: row.paypal_capture_id,
          orderNumber: row.order_number,
          buyerName: row.buyer_name,
          buyerEmail: row.buyer_email,
          currency: row.currency,
          grossAmount: Number(row.gross_amount_cents) / 100,
          shippingAmount: Number(row.shipping_amount_cents) / 100,
          refundedAmount: Number(row.refunded_amount_cents) / 100,
          refundableAmount: Number(row.refundable_amount_cents) / 100,
          shippingCarrier: row.shipping_carrier || undefined,
          trackingNumber: row.tracking_number || undefined,
          deliveryDate: row.delivery_date ? new Date(row.delivery_date).toISOString() : undefined,
          status: row.status,
          transactionDate: row.transaction_date ? new Date(row.transaction_date).toISOString() : new Date().toISOString(),
          items: itemsByOrder[row.id] || [],
        };
      }

      // 6. Cases & Evidence
      const cRes = await this.pgPool.query('SELECT * FROM cases');
      const evRes = await this.pgPool.query('SELECT * FROM evidence_objects');
      const evByCase: Record<string, EvidenceObject[]> = {};
      for (const evRow of evRes.rows) {
        if (!evByCase[evRow.case_id]) evByCase[evRow.case_id] = [];
        evByCase[evRow.case_id].push({
          id: evRow.id,
          caseId: evRow.case_id,
          originalFilename: evRow.original_filename,
          mimeType: evRow.mime_type,
          byteSize: Number(evRow.byte_size),
          width: evRow.width || undefined,
          height: evRow.height || undefined,
          sha256Hash: evRow.sha256_hash,
          isDuplicate: Boolean(evRow.is_duplicate),
          scanStatus: evRow.scan_status,
          evidenceType: evRow.evidence_type,
          caption: evRow.caption || undefined,
          downloadUrl: evRow.storage_path || `/api/v1/evidence/${evRow.id}/file`,
          uploadedAt: evRow.uploaded_at ? new Date(evRow.uploaded_at).toISOString() : new Date().toISOString(),
        });
      }

      for (const row of cRes.rows) {
        const existing = this.data.cases[row.id];
        this.data.cases[row.id] = {
          id: row.id,
          tenantId: row.tenant_id,
          caseNumber: row.case_number,
          orderId: row.order_id,
          orderNumber: row.order_number,
          paypalOrderId: row.paypal_order_id,
          paypalCaptureId: row.paypal_capture_id,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          status: row.status,
          issueType: row.issue_type,
          requestedResolution: row.requested_resolution,
          customerDescription: row.customer_description,
          customerAccessToken: existing?.customerAccessToken || `tok_${row.id}`,
          tokenExpiresAt: existing?.tokenExpiresAt || new Date(Date.now() + 86400000 * 30).toISOString(),
          evidence: evByCase[row.id] || existing?.evidence || [],
          aiInvestigation: existing?.aiInvestigation,
          policyEvaluation: existing?.policyEvaluation,
          activeApproval: existing?.activeApproval,
          refundAttempts: existing?.refundAttempts || [],
          timeline: existing?.timeline || [],
          merchantNotes: row.merchant_notes || undefined,
          assignedTo: row.assigned_to || undefined,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        };
      }

      // 7. Refund Approvals
      const appRes = await this.pgPool.query('SELECT * FROM refund_approvals');
      for (const row of appRes.rows) {
        const approval: RefundApproval = {
          id: row.id,
          caseId: row.case_id,
          tenantId: row.tenant_id,
          orderId: this.data.cases[row.case_id]?.orderId || 'ord-unknown',
          authorizedBy: row.authorized_by,
          authorizedByName: this.data.users[row.authorized_by]?.name || 'Authorized Approver',
          authorizedByRole: this.data.users[row.authorized_by]?.role || 'REVIEWER',
          approvedAmount: Number(row.approved_amount_cents) / 100,
          approvedAmountCents: Number(row.approved_amount_cents),
          currency: row.currency,
          captureId: row.capture_id,
          caseVersion: row.case_version,
          policyVersion: row.policy_version,
          notes: row.notes || undefined,
          status: row.status,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          expiresAt: new Date((row.created_at ? new Date(row.created_at).getTime() : Date.now()) + 86400000 * 7).toISOString(),
        };
        this.data.refundApprovals[row.id] = approval;
        if (this.data.cases[row.case_id] && approval.status === 'ACTIVE') {
          this.data.cases[row.case_id].activeApproval = approval;
        }
      }

      // 8. Refund Attempts
      const attRes = await this.pgPool.query('SELECT * FROM refund_attempts');
      for (const row of attRes.rows) {
        const attempt: RefundAttempt = {
          id: row.id,
          caseId: row.case_id,
          approvalId: row.approval_id || undefined,
          captureId: row.capture_id,
          idempotencyKey: row.idempotency_key,
          amount: Number(row.amount_cents) / 100,
          amountCents: Number(row.amount_cents),
          currency: row.currency,
          reason: row.reason,
          status: row.status,
          paypalRefundId: row.paypal_refund_id || undefined,
          paypalResponse: row.paypal_response ? JSON.parse(JSON.stringify(row.paypal_response)) : undefined,
          errorCode: row.error_code || undefined,
          errorMessage: row.error_message || undefined,
          authorizedBy: {
            userId: row.authorized_by_user_id,
            userName: this.data.users[row.authorized_by_user_id]?.name || 'System Operator',
            userRole: this.data.users[row.authorized_by_user_id]?.role || 'ADMIN',
          },
          isSimulated: Boolean(row.is_simulated),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
          completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
        };
        this.data.refundAttempts[row.id] = attempt;
        if (this.data.cases[row.case_id]) {
          const c = this.data.cases[row.case_id];
          if (!c.refundAttempts.some((a) => a.id === attempt.id)) {
            c.refundAttempts.push(attempt);
          }
        }
      }

      // 9. Webhooks
      const whRes = await this.pgPool.query('SELECT event_id FROM paypal_webhook_events WHERE processed = true');
      for (const row of whRes.rows) {
        this.processedWebhookIds.add(row.event_id);
      }

      console.log('[Database] Loaded authoritative records from PostgreSQL successfully.');
    } catch (err: any) {
      console.error('[Database] Failed to load data from PostgreSQL:', err.message);
    }
  }

  public async query(text: string, params?: any[]): Promise<pg.QueryResult<any>> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool is not initialized');
    }
    return await this.pgPool.query(text, params);
  }

  public async withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!this.pgPool) {
      throw new Error('PostgreSQL pool is not initialized');
    }
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cross-Process Atomic Refund Reservation Transaction
   * Executes inside a PostgreSQL transaction with SELECT ... FOR UPDATE row locks.
   * Serializes concurrent attempts and fails closed if in-flight conflicts exist.
   */
  public async reserveRefundTransaction(params: {
    caseId: string;
    orderId: string;
    tenantId: string;
    approvalId?: string;
    approverId?: string;
    executorId: string;
    captureId: string;
    idempotencyKey: string;
    requestFingerprint?: string;
    amountCents: number;
    amountDollars: number;
    currency: string;
    reason: string;
    user: User;
  }): Promise<{ refundAttempt: RefundAttempt }> {
    if (this.isPostgresConnected && this.pgPool) {
      return await this.withTransaction(async (client) => {
        // 1. Lock the order row
        const orderRes = await client.query(
          'SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
          [params.orderId, params.tenantId]
        );
        if (orderRes.rows.length === 0) {
          const err: any = new Error('Order not found');
          err.statusCode = 404;
          throw err;
        }
        const orderRow = orderRes.rows[0];

        // 2. Lock the case row
        const caseRes = await client.query(
          'SELECT * FROM cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
          [params.caseId, params.tenantId]
        );
        if (caseRes.rows.length === 0) {
          const err: any = new Error('Case not found');
          err.statusCode = 404;
          throw err;
        }

        // 3. Check for active in-flight refund attempt on this case or capture
        const inFlightRes = await client.query(
          `SELECT * FROM refund_attempts
           WHERE (case_id = $1 OR capture_id = $2)
             AND status IN ('RESERVED', 'SUBMITTED', 'PENDING', 'UNKNOWN', 'RECONCILIATION_REQUIRED')
           LIMIT 1 FOR UPDATE`,
          [params.caseId, params.captureId]
        );
        if (inFlightRes.rows.length > 0) {
          const activeAttempt = inFlightRes.rows[0];
          const err: any = new Error(
            `A refund attempt (${activeAttempt.id}) is already in progress or awaiting reconciliation for this case.`
          );
          err.statusCode = 409;
          err.conflictAttempt = activeAttempt;
          throw err;
        }

        // 4. Check remaining refundable balance
        const refundableCents = BigInt(orderRow.refundable_amount_cents);
        if (BigInt(params.amountCents) > refundableCents) {
          const err: any = new Error(
            `Requested amount exceeds remaining refundable balance (${Number(refundableCents) / 100} ${orderRow.currency})`
          );
          err.statusCode = 400;
          throw err;
        }

        // 5. Check idempotency key
        const existingKeyRes = await client.query(
          'SELECT * FROM refund_attempts WHERE idempotency_key = $1 FOR UPDATE',
          [params.idempotencyKey]
        );
        if (existingKeyRes.rows.length > 0) {
          const err: any = new Error(`Concurrent refund attempt detected with matching idempotency key: ${params.idempotencyKey}`);
          err.statusCode = 409;
          throw err;
        }

        // 6. Insert refund attempt with status 'RESERVED'
        const attemptId = `ref-att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await client.query(
          `INSERT INTO refund_attempts (
            id, case_id, tenant_id, approval_id, capture_id, idempotency_key,
            amount_cents, currency, reason, status, authorized_by_user_id, is_simulated, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'RESERVED', $10, $11, CURRENT_TIMESTAMP)`,
          [
            attemptId,
            params.caseId,
            params.tenantId,
            params.approvalId || null,
            params.captureId,
            params.idempotencyKey,
            params.amountCents,
            params.currency,
            params.reason,
            params.executorId,
            false,
          ]
        );

        // 7. Update case status to 'REFUND_SUBMITTED'
        await client.query(
          `UPDATE cases SET status = 'REFUND_SUBMITTED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [params.caseId]
        );

        const attempt: RefundAttempt = {
          id: attemptId,
          caseId: params.caseId,
          approvalId: params.approvalId,
          approverId: params.approverId,
          executorId: params.executorId,
          captureId: params.captureId,
          idempotencyKey: params.idempotencyKey,
          requestFingerprint: params.requestFingerprint,
          amount: params.amountDollars,
          amountCents: params.amountCents,
          currency: params.currency,
          reason: params.reason,
          status: 'RESERVED',
          authorizedBy: {
            userId: params.user.id,
            userName: params.user.name,
            userRole: params.user.role,
          },
          createdAt: new Date().toISOString(),
        };

        // Synchronize in-memory cache
        const memCase = this.data.cases[params.caseId];
        if (memCase) {
          memCase.status = 'REFUND_SUBMITTED';
          memCase.refundAttempts.push(attempt);
        }
        this.data.refundAttempts[attempt.id] = attempt;
        this.scheduleSave();

        return { refundAttempt: attempt };
      });
    }

    // In-memory atomic fallback
    const memCase = this.data.cases[params.caseId];
    if (!memCase) {
      const err: any = new Error('Case not found');
      err.statusCode = 404;
      throw err;
    }
    const memOrder = this.data.orders[params.orderId];
    if (!memOrder) {
      const err: any = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    const activePending = memCase.refundAttempts.find(
      (a) =>
        a.status === 'RESERVED' ||
        a.status === 'SUBMITTED' ||
        a.status === 'PENDING' ||
        a.status === 'UNKNOWN' ||
        a.status === 'RECONCILIATION_REQUIRED'
    );
    if (activePending) {
      const err: any = new Error(
        `A refund attempt (${activePending.id}) is already in progress or awaiting reconciliation for this case.`
      );
      err.statusCode = 409;
      throw err;
    }

    const existingKey = Object.values(this.data.refundAttempts).find((a) => a.idempotencyKey === params.idempotencyKey);
    if (existingKey) {
      const err: any = new Error(`Concurrent refund attempt detected with matching idempotency key: ${params.idempotencyKey}`);
      err.statusCode = 409;
      throw err;
    }

    const attemptId = `ref-att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const attempt: RefundAttempt = {
      id: attemptId,
      caseId: params.caseId,
      approvalId: params.approvalId,
      approverId: params.approverId,
      executorId: params.executorId,
      captureId: params.captureId,
      idempotencyKey: params.idempotencyKey,
      requestFingerprint: params.requestFingerprint,
      amount: params.amountDollars,
      amountCents: params.amountCents,
      currency: params.currency,
      reason: params.reason,
      status: 'RESERVED',
      authorizedBy: {
        userId: params.user.id,
        userName: params.user.name,
        userRole: params.user.role,
      },
      createdAt: new Date().toISOString(),
    };

    memCase.status = 'REFUND_SUBMITTED';
    memCase.refundAttempts.push(attempt);
    this.data.refundAttempts[attempt.id] = attempt;
    this.scheduleSave();

    return { refundAttempt: attempt };
  }

  /**
   * Persist or reserve a refund attempt in PostgreSQL if active
   */
  public async reserveRefundAttempt(attempt: RefundAttempt): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO refund_attempts (
          id, case_id, tenant_id, approval_id, capture_id, idempotency_key,
          amount_cents, currency, reason, status, authorized_by_user_id, is_simulated, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents`,
        [
          attempt.id,
          attempt.caseId,
          this.data.cases[attempt.caseId]?.tenantId || 'tenant-apex-101',
          attempt.approvalId || null,
          attempt.captureId,
          attempt.idempotencyKey,
          attempt.amountCents || Math.round(attempt.amount * 100),
          attempt.currency,
          attempt.reason,
          attempt.status,
          attempt.authorizedBy.userId,
          attempt.isSimulated || false,
          attempt.createdAt,
        ]
      );
    }
  }

  public async updateRefundAttemptState(attempt: RefundAttempt): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `UPDATE refund_attempts SET
          status = $1,
          paypal_refund_id = $2,
          paypal_response = $3,
          completed_at = $4,
          error_code = $5,
          error_message = $6,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $7`,
        [
          attempt.status,
          attempt.paypalRefundId || null,
          attempt.paypalResponse ? JSON.stringify(attempt.paypalResponse) : null,
          attempt.completedAt || null,
          attempt.errorCode || null,
          attempt.errorMessage || null,
          attempt.id,
        ]
      );
    }
  }

  /**
   * Save or update tenant in PostgreSQL
   */
  public async saveTenantPg(t: Tenant): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO tenants (id, name, slug, currency, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           currency = EXCLUDED.currency`,
        [t.id, t.name, t.slug, t.currency, t.createdAt]
      );
    }
  }

  /**
   * Update order refund balance atomically in PostgreSQL
   */
  public async updateOrderBalancePg(params: {
    orderId: string;
    refundedAmountDollars: number;
    refundableAmountDollars: number;
    status: 'COMPLETED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  }): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `UPDATE orders SET
          refunded_amount_cents = $1,
          refundable_amount_cents = $2,
          status = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
        [
          Math.round(params.refundedAmountDollars * 100),
          Math.round(params.refundableAmountDollars * 100),
          params.status,
          params.orderId,
        ]
      );
    }
  }

  /**
   * Save or update an order in PostgreSQL
   */
  public async saveOrderPg(order: Order): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO orders (
          id, tenant_id, paypal_order_id, paypal_capture_id, order_number, buyer_name,
          buyer_email, currency, gross_amount_cents, shipping_amount_cents,
          refunded_amount_cents, refundable_amount_cents, shipping_carrier, tracking_number,
          delivery_date, status, transaction_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          refunded_amount_cents = EXCLUDED.refunded_amount_cents,
          refundable_amount_cents = EXCLUDED.refundable_amount_cents,
          status = EXCLUDED.status,
          updated_at = CURRENT_TIMESTAMP`,
        [
          order.id,
          order.tenantId,
          order.paypalOrderId,
          order.paypalCaptureId,
          order.orderNumber,
          order.buyerName,
          order.buyerEmail,
          order.currency,
          Math.round(order.grossAmount * 100),
          Math.round((order.shippingAmount || 0) * 100),
          Math.round(order.refundedAmount * 100),
          Math.round(order.refundableAmount * 100),
          order.shippingCarrier || null,
          order.trackingNumber || null,
          order.deliveryDate || null,
          order.status,
          order.transactionDate,
        ]
      );

      if (order.items) {
        for (const item of order.items) {
          await this.pgPool.query(
            `INSERT INTO order_items (id, order_id, sku, name, quantity, unit_price_cents, total_price_cents)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
            [
              item.id,
              order.id,
              item.sku,
              item.name,
              item.quantity,
              Math.round(item.unitPrice * 100),
              Math.round(item.totalPrice * 100),
            ]
          );
        }
      }
    }
  }

  /**
   * Save or update a case in PostgreSQL
   */
  public async saveCasePg(c: Case): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO cases (
          id, tenant_id, case_number, order_id, order_number, paypal_order_id, paypal_capture_id,
          customer_name, customer_email, status, issue_type, requested_resolution,
          customer_description, merchant_notes, assigned_to, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          merchant_notes = EXCLUDED.merchant_notes,
          assigned_to = EXCLUDED.assigned_to,
          updated_at = CURRENT_TIMESTAMP`,
        [
          c.id,
          c.tenantId,
          c.caseNumber,
          c.orderId,
          c.orderNumber,
          c.paypalOrderId,
          c.paypalCaptureId,
          c.customerName,
          c.customerEmail,
          c.status,
          c.issueType,
          c.requestedResolution,
          c.customerDescription,
          c.merchantNotes || null,
          c.assignedTo || null,
          c.createdAt,
          c.updatedAt,
        ]
      );
    }
  }

  /**
   * Save user account in PostgreSQL
   */
  public async saveUserPg(u: UserAccount): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO users (id, tenant_id, email, name, role, password_hash, password_salt, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           password_hash = EXCLUDED.password_hash,
           updated_at = CURRENT_TIMESTAMP`,
        [u.id, u.tenantId, u.email, u.name, u.role, u.passwordHash, u.passwordSalt, u.createdAt]
      );
    }
  }

  /**
   * Save session in PostgreSQL
   */
  public async saveSessionPg(s: Session): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO sessions (id, user_id, tenant_id, token_hash, user_agent, ip_address, is_revoked, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           is_revoked = EXCLUDED.is_revoked,
           expires_at = EXCLUDED.expires_at`,
        [s.id, s.userId, s.tenantId, s.tokenHash, s.userAgent || null, s.ipAddress || null, s.isRevoked, s.expiresAt, s.createdAt]
      );
    }
  }

  /**
   * Save refund approval in PostgreSQL
   */
  public async saveRefundApprovalPg(a: RefundApproval): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO refund_approvals (
          id, case_id, tenant_id, authorized_by, approved_amount_cents, currency,
          capture_id, case_version, policy_version, notes, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status`,
        [
          a.id,
          a.caseId,
          a.tenantId,
          a.authorizedBy,
          Math.round(a.approvedAmount * 100),
          a.currency,
          a.captureId,
          a.caseVersion,
          a.policyVersion,
          a.notes || null,
          a.status,
          a.createdAt,
        ]
      );
    }
  }

  /**
   * Enqueue outbox event into PostgreSQL
   */
  public async enqueueOutboxPg(event: OutboxEvent): Promise<void> {
    if (this.isPostgresConnected && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO outbox_events (
          id, tenant_id, event_type, payload, status, retry_count, max_retries,
          next_attempt_at, idempotency_key, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          event.tenantId || 'tenant-apex-101',
          event.eventType,
          JSON.stringify(event.payload),
          event.status,
          event.retryCount || 0,
          5,
          event.nextAttemptAt ? new Date(event.nextAttemptAt) : new Date(),
          event.idempotencyKey || null,
          event.createdAt ? new Date(event.createdAt) : new Date(),
        ]
      );
    }
  }

  public isPostgresActive(): boolean {
    return this.isPostgresConnected;
  }

  public getPgPool(): pg.Pool | undefined {
    return this.pgPool;
  }

  public isWebhookProcessed(eventId: string): boolean {
    return this.processedWebhookIds.has(eventId);
  }

  public markWebhookProcessed(eventId: string): void {
    this.processedWebhookIds.add(eventId);
  }

  private getDefaultSchema(): DatabaseSchema {
    return {
      version: 1,
      tenants: {},
      users: {},
      sessions: {},
      orders: {},
      cases: {},
      policies: {},
      refundAttempts: {},
      refundApprovals: {},
      auditEvents: [],
      outbox: [],
      invitations: {},
    };
  }

  /**
   * Atomic file persistence with write-to-temp and rename to prevent corruption
   */
  public saveSync() {
    const tempFile = `${DB_FILE}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(tempFile, serialized, 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  }

  public scheduleSave() {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveSync();
    }, 100);
  }

  // -------------------------------------------------------------
  // SEED DATA INITIALIZER
  // -------------------------------------------------------------
  private seedInitialData() {
    const tenantApex: Tenant = {
      id: 'tenant-apex-101',
      name: 'Apex Audio & Gear',
      slug: 'apex-audio',
      currency: 'USD',
      createdAt: '2026-01-15T09:00:00Z',
    };
    this.data.tenants[tenantApex.id] = tenantApex;

    // Hardened password hashing (scrypt with N=16384, r=8, p=1, 64-byte key)
    const hashPw = (password: string, salt: string) => {
      return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    };

    // Pre-seed demo users across all 5 RBAC tiers with DEMO DATA labels
    const seedUsers = [
      {
        id: 'usr-01',
        name: 'Elena Rostova (Store Owner)',
        email: 'owner@apexaudio.com',
        role: 'OWNER' as UserRole,
        password: 'DemoOwner2026!',
      },
      {
        id: 'usr-02',
        name: 'Marcus Vance (Operations Admin)',
        email: 'ops.lead@apexaudio.com',
        role: 'ADMIN' as UserRole,
        password: 'DemoAdmin2026!',
      },
      {
        id: 'usr-03',
        name: 'Sarah Chen (Senior Dispute Reviewer)',
        email: 'sarah.support@apexaudio.com',
        role: 'REVIEWER' as UserRole,
        password: 'DemoReviewer2026!',
      },
      {
        id: 'usr-04',
        name: 'David Kalu (Risk Analyst)',
        email: 'david.analyst@apexaudio.com',
        role: 'ANALYST' as UserRole,
        password: 'DemoAnalyst2026!',
      },
      {
        id: 'usr-05',
        name: 'Rachel Adams (Auditor / Viewer)',
        email: 'auditor.extern@apexaudio.com',
        role: 'VIEWER' as UserRole,
        password: 'DemoViewer2026!',
      },
    ];

    seedUsers.forEach((u) => {
      const salt = crypto.randomBytes(32).toString('hex');
      const hash = hashPw(u.password, salt);
      this.data.users[u.id] = {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        tenantId: tenantApex.id,
        passwordSalt: salt,
        passwordHash: hash,
        createdAt: '2026-01-15T09:00:00Z',
      };
    });

    // Default Published Refund Policy (v2.1)
    const defaultPolicy: RefundPolicy = {
      version: 'v2.1',
      publishedAt: '2026-02-01T12:00:00Z',
      returnWindowDays: 30,
      requirePackagingPhotoForDamage: true,
      requireLabelPhotoForWrongItem: true,
      carrierDeliveryVerificationDays: 3,
      maxInstantRefundAmount: 250.0,
      mandatoryReturnThreshold: 200.0,
      allowPartialRefundsWithoutReturn: true,
      maxPartialRefundPercentage: 50,
      flagDuplicateEvidenceHash: true,
      description:
        'Standard FairResolve Merchant Policy: 30-day window, visual packaging proof required for damage claims, mandatory return required for items over $200.00.',
    };
    this.data.policies[tenantApex.id] = [defaultPolicy];

    // Seed Verified PayPal Orders
    const orders: Order[] = [
      {
        id: 'ord-88101',
        tenantId: tenantApex.id,
        paypalOrderId: '5C7829103849102X',
        paypalCaptureId: '7K1928304910293Y',
        orderNumber: 'APX-2026-9481',
        buyerName: 'Alexander Hayes',
        buyerEmail: 'alex.hayes@example.com',
        transactionDate: '2026-10-24T14:32:00Z',
        currency: 'USD',
        grossAmount: 189.99,
        shippingAmount: 15.0,
        refundedAmount: 0.0,
        refundableAmount: 189.99,
        items: [
          {
            id: 'item-01',
            sku: 'APX-H900-BLK',
            name: 'AuraSound ANC Wireless Studio Headphones',
            quantity: 1,
            unitPrice: 174.99,
            totalPrice: 174.99,
          },
        ],
        shippingCarrier: 'FedEx',
        trackingNumber: '782910492810',
        deliveryDate: '2026-10-27T11:15:00Z',
        status: 'COMPLETED',
      },
      {
        id: 'ord-88102',
        tenantId: tenantApex.id,
        paypalOrderId: '3A9182740192837B',
        paypalCaptureId: '4M9281740192847C',
        orderNumber: 'APX-2026-9502',
        buyerName: 'Maya Chen',
        buyerEmail: 'maya.chen@example.com',
        transactionDate: '2026-10-28T16:45:00Z',
        currency: 'USD',
        grossAmount: 129.5,
        shippingAmount: 9.5,
        refundedAmount: 0.0,
        refundableAmount: 129.5,
        items: [
          {
            id: 'item-02',
            sku: 'APX-TRAIL-11M',
            name: 'ProTrail Ultralight Running Shoes (Size 11M, Olive)',
            quantity: 1,
            unitPrice: 120.0,
            totalPrice: 120.0,
          },
        ],
        shippingCarrier: 'UPS',
        trackingNumber: '1Z9999999999999999',
        deliveryDate: '2026-10-31T15:20:00Z',
        status: 'COMPLETED',
      },
      {
        id: 'ord-88103',
        tenantId: tenantApex.id,
        paypalOrderId: '8D1928374650192E',
        paypalCaptureId: '9F1029384756102G',
        orderNumber: 'APX-2026-9524',
        buyerName: 'Jordan Taylor',
        buyerEmail: 'jordan.t@example.com',
        transactionDate: '2026-11-01T08:12:00Z',
        currency: 'USD',
        grossAmount: 79.0,
        shippingAmount: 0.0,
        refundedAmount: 0.0,
        refundableAmount: 79.0,
        items: [
          {
            id: 'item-03',
            sku: 'APX-FIT-OLED',
            name: 'PulseFit Pro Smart Tracker - Obsidian Black',
            quantity: 1,
            unitPrice: 79.0,
            totalPrice: 79.0,
          },
        ],
        shippingCarrier: 'USPS',
        trackingNumber: '9400100000000000000000',
        deliveryDate: undefined,
        status: 'COMPLETED',
      },
      {
        id: 'ord-88104',
        tenantId: tenantApex.id,
        paypalOrderId: '1J8291038475610K',
        paypalCaptureId: '2L9182736450192M',
        orderNumber: 'APX-2026-9120',
        buyerName: 'Robert Vance',
        buyerEmail: 'rvance@example.com',
        transactionDate: '2026-08-14T10:00:00Z',
        currency: 'USD',
        grossAmount: 249.99,
        shippingAmount: 0.0,
        refundedAmount: 0.0,
        refundableAmount: 249.99,
        items: [
          {
            id: 'item-04',
            sku: 'APX-AMP-MK2',
            name: 'Apex Valve Desktop Headphone Amplifier',
            quantity: 1,
            unitPrice: 249.99,
            totalPrice: 249.99,
          },
        ],
        shippingCarrier: 'FedEx',
        trackingNumber: '782910499999',
        deliveryDate: '2026-08-18T14:00:00Z',
        status: 'COMPLETED',
      },
      {
        id: 'ord-88105',
        tenantId: tenantApex.id,
        paypalOrderId: '4P8192837465019Q',
        paypalCaptureId: '5R9182736450192S',
        orderNumber: 'APX-2026-9560',
        buyerName: 'Clara Oswald',
        buyerEmail: 'clara.o@example.com',
        transactionDate: '2026-10-30T11:20:00Z',
        currency: 'USD',
        grossAmount: 110.0,
        shippingAmount: 10.0,
        refundedAmount: 0.0,
        refundableAmount: 110.0,
        items: [
          {
            id: 'item-05',
            sku: 'APX-MIC-USB',
            name: 'Apex Studio Podcasting Microphone Kit',
            quantity: 1,
            unitPrice: 100.0,
            totalPrice: 100.0,
          },
        ],
        shippingCarrier: 'UPS',
        trackingNumber: '1Z8888888888888888',
        deliveryDate: '2026-11-02T13:40:00Z',
        status: 'COMPLETED',
      },
      {
        id: 'ord-88106',
        tenantId: tenantApex.id,
        paypalOrderId: '7T9182736450192U',
        paypalCaptureId: '8V9182736450192W',
        orderNumber: 'APX-2026-9588',
        buyerName: 'Liam Brody',
        buyerEmail: 'liam.b@example.com',
        transactionDate: '2026-11-02T09:15:00Z',
        currency: 'USD',
        grossAmount: 159.0,
        shippingAmount: 0.0,
        refundedAmount: 0.0,
        refundableAmount: 159.0,
        items: [
          {
            id: 'item-06',
            sku: 'APX-SPK-MINI',
            name: 'AuraSound Portable HiFi Bluetooth Speaker',
            quantity: 1,
            unitPrice: 159.0,
            totalPrice: 159.0,
          },
        ],
        shippingCarrier: 'FedEx',
        trackingNumber: '782910400111',
        deliveryDate: '2026-11-04T16:30:00Z',
        status: 'COMPLETED',
      },
    ];

    orders.forEach((o) => {
      this.data.orders[o.id] = o;
    });

    // Seed Representative Cases
    const cases: Case[] = [
      {
        id: 'case-101',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-001',
        orderId: 'ord-88101',
        orderNumber: 'APX-2026-9481',
        paypalOrderId: '5C7829103849102X',
        paypalCaptureId: '7K1928304910293Y',
        customerName: 'Alexander Hayes',
        customerEmail: 'alex.hayes@example.com',
        status: 'READY_FOR_REVIEW',
        issueType: 'damaged_item',
        requestedResolution: 'full_refund',
        customerDescription:
          'Package arrived crushed on one side. When I opened the box, the left hinge on the headphones was cracked and loose. The audio works in one ear only.',
        customerAccessToken: 'tok_alex_48102a9b',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [
          {
            id: 'ev-01',
            caseId: 'case-101',
            originalFilename: 'cracked_earcup_hinge.jpg',
            mimeType: 'image/jpeg',
            byteSize: 184200,
            width: 1200,
            height: 900,
            sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            isDuplicate: false,
            uploadedAt: '2026-10-28T09:30:00Z',
            scanStatus: 'clean',
            evidenceType: 'item_photo',
            caption: 'Close-up of hairline fracture at swivel joint',
            downloadUrl: '/api/v1/evidence/ev-01/file',
          },
          {
            id: 'ev-02',
            caseId: 'case-101',
            originalFilename: 'outer_box_crease.jpg',
            mimeType: 'image/jpeg',
            byteSize: 210500,
            width: 1200,
            height: 900,
            sha256Hash: 'a7c9381920384756192837465019283746501928374650192837465019283746',
            isDuplicate: false,
            uploadedAt: '2026-10-28T09:31:00Z',
            scanStatus: 'clean',
            evidenceType: 'packaging_photo',
            caption: 'Cardboard box showing diagonal impact dent',
            downloadUrl: '/api/v1/evidence/ev-02/file',
          },
        ],
        aiInvestigation: {
          issue_type: 'damaged_item',
          customer_claim:
            'Customer claims headphones arrived with physical fracture at the left earcup hinge and non-functioning left speaker channel.',
          reported_facts: [
            'Order delivered on October 27, 2026 via FedEx.',
            'Dispute opened within 24 hours of documented delivery.',
            'Customer uploaded 2 photos covering both item damage and exterior shipping carton.',
          ],
          evidence_observations: [
            'Uploaded image shows a distinct mechanical stress fracture at the polymer swivel arm near the left driver assembly.',
            'Second photograph shows structural deformation and compression creasing along the corrugated shipping parcel corner.',
          ],
          missing_information: [
            'Serial number sticker on inside headband not clearly visible in provided angle.',
          ],
          inconsistencies: [],
          policy_references: [
            'Section 4.1: Damaged items reported within 30 days are eligible for refund/replacement.',
            'Section 4.2: Packaging photo requirement satisfied.',
          ],
          limitations: [
            'Photographs confirm visible mechanical fracture but cannot verify audio channel failure.',
            'Damage is consistent with shipping transit shock, but transit fault versus pre-existing defect cannot be definitively proven solely by imagery.',
          ],
          recommended_next_step: 'eligible_for_merchant_review',
          explanation:
            'The complaint is fully documented with both item and parcel evidence. Verified transit timeline matches reported defect. Recommend merchant approval for full refund under standard transit warranty.',
          analyzed_at: '2026-10-28T09:32:15Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'ELIGIBLE_FOR_MERCHANT_REVIEW',
          policy_version: 'v2.1',
          eligible_amount: 189.99,
          missing_requirements: [],
          reason_codes: ['POLICY_CRITERIA_MET'],
          rules_evaluated: [
            {
              ruleId: 'R-01',
              ruleName: 'Within Refund Window',
              description: 'Claim must be filed within 30 days of delivery',
              passed: true,
              details: 'Filed 1 day after delivery (Limit: 30 days)',
            },
            {
              ruleId: 'R-02',
              ruleName: 'Damage Packaging Evidence',
              description: 'Must provide photo of exterior package for transit damage claims',
              passed: true,
              details: 'Packaging photo provided and verified',
            },
            {
              ruleId: 'R-03',
              ruleName: 'Mandatory Return Inspection Threshold',
              description: 'Orders exceeding $200.00 require physical return before refund',
              passed: true,
              details: 'Gross amount $189.99 is below the $200.00 physical return threshold',
            },
          ],
          evaluated_at: '2026-10-28T09:32:16Z',
        },
        refundAttempts: [],
        timeline: [
          {
            id: 'ev-log-01',
            caseId: 'case-101',
            eventType: 'CASE_CREATED',
            actor: { type: 'CUSTOMER', name: 'Alexander Hayes' },
            summary: 'Customer submitted dispute for damaged item received',
            timestamp: '2026-10-28T09:30:00Z',
          },
          {
            id: 'ev-log-02',
            caseId: 'case-101',
            eventType: 'EVIDENCE_UPLOADED',
            actor: { type: 'CUSTOMER', name: 'Alexander Hayes' },
            summary: 'Uploaded 2 evidence photos: cracked_earcup_hinge.jpg and outer_box_crease.jpg',
            timestamp: '2026-10-28T09:31:00Z',
          },
          {
            id: 'ev-log-03',
            caseId: 'case-101',
            eventType: 'AI_INVESTIGATION_COMPLETED',
            actor: { type: 'AI_ENGINE', name: 'Gemini 3.8 Flash' },
            summary: 'Completed multimodal observation and policy grounding',
            timestamp: '2026-10-28T09:32:15Z',
          },
        ],
        createdAt: '2026-10-28T09:30:00Z',
        updatedAt: '2026-10-28T09:32:16Z',
      },
      {
        id: 'case-102',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-002',
        orderId: 'ord-88102',
        orderNumber: 'APX-2026-9502',
        paypalOrderId: '3A9182740192837B',
        paypalCaptureId: '4M9281740192847C',
        customerName: 'Maya Chen',
        customerEmail: 'maya.chen@example.com',
        status: 'READY_FOR_REVIEW',
        issueType: 'wrong_item',
        requestedResolution: 'full_refund',
        customerDescription:
          'I ordered ProTrail shoes in Size 11 Men, Olive Green. The box sent contains Size 9 Men, Navy Blue. The barcode on the outside of the shoe box says 9M Navy.',
        customerAccessToken: 'tok_maya_81920b3c',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [
          {
            id: 'ev-03',
            caseId: 'case-102',
            originalFilename: 'shoe_box_barcode_label.jpg',
            mimeType: 'image/jpeg',
            byteSize: 198400,
            width: 1200,
            height: 900,
            sha256Hash: 'b8d9102938475610293847561029384756102938475610293847561029384756',
            isDuplicate: false,
            uploadedAt: '2026-11-01T10:14:00Z',
            scanStatus: 'clean',
            evidenceType: 'shipping_label',
            caption: 'Shoe manufacturer box label showing SKU APX-TRAIL-9M-NVY',
            downloadUrl: '/api/v1/evidence/ev-03/file',
          },
        ],
        aiInvestigation: {
          issue_type: 'wrong_item',
          customer_claim: 'Customer reports receiving Size 9M Navy instead of ordered Size 11M Olive.',
          reported_facts: [
            'Customer ordered APX-TRAIL-11M (Size 11M, Olive).',
            'Box label photograph indicates SKU ending in 9M-NVY.',
          ],
          evidence_observations: [
            'Uploaded label photograph clearly shows text "Size: US 9.0 M / UK 8.5 / EUR 42.5 Color: Navy/White".',
            'Order record specifies US 11.0 M Olive.',
          ],
          missing_information: [
            'Photo of the shoes themselves outside the box not included, though box label is legible.',
          ],
          inconsistencies: [],
          policy_references: [
            'Section 5.1: Fulfillment mis-shipment verified by box label qualifies for returnless or prepaid exchange.',
          ],
          limitations: [
            'Verification relies on the uploaded retail box label. Actual contents inside box are assumed to match box label.',
          ],
          recommended_next_step: 'eligible_for_merchant_review',
          explanation:
            'Warehouse mis-pick is substantiated by photographic evidence of box SKU label. Verified transaction balance $129.50.',
          analyzed_at: '2026-11-01T10:15:30Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'ELIGIBLE_FOR_MERCHANT_REVIEW',
          policy_version: 'v2.1',
          eligible_amount: 129.5,
          missing_requirements: [],
          reason_codes: ['POLICY_CRITERIA_MET'],
          rules_evaluated: [
            {
              ruleId: 'R-01',
              ruleName: 'Within Refund Window',
              description: 'Claim filed within 30 days',
              passed: true,
              details: 'Filed 1 day after receipt',
            },
            {
              ruleId: 'R-04',
              ruleName: 'Wrong Item Label Photo',
              description: 'Must provide photo of item label or barcode for wrong-item claim',
              passed: true,
              details: 'Label photo verified against order line item SKU',
            },
          ],
          evaluated_at: '2026-11-01T10:15:31Z',
        },
        refundAttempts: [],
        timeline: [
          {
            id: 'ev-log-05',
            caseId: 'case-102',
            eventType: 'CASE_CREATED',
            actor: { type: 'CUSTOMER', name: 'Maya Chen' },
            summary: 'Customer submitted wrong item received dispute',
            timestamp: '2026-11-01T10:14:00Z',
          },
        ],
        createdAt: '2026-11-01T10:14:00Z',
        updatedAt: '2026-11-01T10:15:31Z',
      },
      {
        id: 'case-103',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-003',
        orderId: 'ord-88103',
        orderNumber: 'APX-2026-9524',
        paypalOrderId: '8D1928374650192E',
        paypalCaptureId: '9F1029384756102G',
        customerName: 'Jordan Taylor',
        customerEmail: 'jordan.t@example.com',
        status: 'NEEDS_MORE_INFORMATION',
        issueType: 'item_not_received',
        requestedResolution: 'full_refund',
        customerDescription:
          'I placed the order 5 days ago and the tracking has not updated past origin sorting facility in Memphis. I want a refund now.',
        customerAccessToken: 'tok_jordan_9102c4d',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [],
        aiInvestigation: {
          issue_type: 'item_not_received',
          customer_claim: 'Customer reports parcel has not arrived 5 days after placing order.',
          reported_facts: [
            'Order created on November 1, 2026.',
            'USPS tracking number 9400100000000000000000 issued.',
            'Estimated delivery standard is 3 to 7 business days.',
          ],
          evidence_observations: ['No customer documents uploaded.'],
          missing_information: [
            'Carrier final delivery scan confirmation or carrier lost parcel declaration.',
          ],
          inconsistencies: [
            'Order is currently still within carrier standard delivery SLA (order placed 5 days ago).',
          ],
          policy_references: [
            'Section 3.2: Item Not Received claims require waiting at least 7 business days from dispatch before initiating refund.',
          ],
          limitations: [
            'Carrier integration reflects package in-transit status; lost parcel cannot be confirmed yet.',
          ],
          recommended_next_step: 'request_more_information',
          explanation:
            'Order was dispatched recently and is still within standard postal transit window. Recommended to hold claim for 3 more business days before issuing refund.',
          analyzed_at: '2026-11-06T06:00:00Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'MORE_INFORMATION_REQUIRED',
          policy_version: 'v2.1',
          eligible_amount: null,
          missing_requirements: [
            'Carrier delivery verification window not yet expired (minimum 7 business days required for INR claim)',
          ],
          reason_codes: ['CARRIER_IN_TRANSIT_WINDOW_ACTIVE'],
          rules_evaluated: [
            {
              ruleId: 'R-05',
              ruleName: 'INR Carrier SLA Wait Period',
              description: 'Must allow standard transit SLA before declaring non-receipt',
              passed: false,
              details: 'Dispatched 5 days ago. Policy requires 7 days minimum before refund.',
            },
          ],
          evaluated_at: '2026-11-06T06:00:01Z',
        },
        refundAttempts: [],
        timeline: [],
        createdAt: '2026-11-06T05:50:00Z',
        updatedAt: '2026-11-06T06:00:01Z',
      },
      {
        id: 'case-104',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-004',
        orderId: 'ord-88104',
        orderNumber: 'APX-2026-9120',
        paypalOrderId: '1J8291038475610K',
        paypalCaptureId: '2L9182736450192M',
        customerName: 'Robert Vance',
        customerEmail: 'rvance@example.com',
        status: 'READY_FOR_REVIEW',
        issueType: 'damaged_item',
        requestedResolution: 'full_refund',
        customerDescription:
          'The amplifier worked for two months, but yesterday the right channel started crackling. I would like a complete refund to my original payment method.',
        customerAccessToken: 'tok_robert_10293d',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [],
        aiInvestigation: {
          issue_type: 'damaged_item',
          customer_claim: 'Customer reports electronic component failure after approximately two months of use.',
          reported_facts: [
            'Order delivered August 18, 2026.',
            'Claim initiated November 2026 (~80 days elapsed post-delivery).',
          ],
          evidence_observations: ['No audio or visual evidence provided.'],
          missing_information: ['Manufacturer warranty card or repair diagnostic.'],
          inconsistencies: [],
          policy_references: [
            'Section 2.1: Store refund window strictly expires 30 calendar days from delivery date.',
          ],
          limitations: ['Post-30-day defects fall under manufacturer limited warranty, not store refund.'],
          recommended_next_step: 'ineligible_under_policy',
          explanation:
            'Order was delivered over 80 days ago. The configured merchant refund window is 30 days. Recommend directing customer to manufacturer warranty service.',
          analyzed_at: '2026-11-04T11:00:00Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'INELIGIBLE_UNDER_CONFIGURED_POLICY',
          policy_version: 'v2.1',
          eligible_amount: 0.0,
          missing_requirements: [
            'Claim submitted outside the allowable 30-day return window (Elapsed: 80 days)',
          ],
          reason_codes: ['RETURN_WINDOW_EXCEEDED'],
          rules_evaluated: [
            {
              ruleId: 'R-01',
              ruleName: 'Within Refund Window',
              description: 'Must file within 30 days',
              passed: false,
              details: 'Elapsed time 80 days exceeds 30-day policy ceiling',
            },
          ],
          evaluated_at: '2026-11-04T11:00:01Z',
        },
        refundAttempts: [],
        timeline: [],
        createdAt: '2026-11-04T10:45:00Z',
        updatedAt: '2026-11-04T11:00:01Z',
      },
      {
        id: 'case-105',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-005',
        orderId: 'ord-88105',
        orderNumber: 'APX-2026-9560',
        paypalOrderId: '4P8192837465019Q',
        paypalCaptureId: '5R9182736450192S',
        customerName: 'Clara Oswald',
        customerEmail: 'clara.o@example.com',
        status: 'READY_FOR_REVIEW',
        issueType: 'damaged_item',
        requestedResolution: 'partial_refund',
        customerDescription:
          'The microphone works well, but there is a 2cm cosmetic scratch along the boom arm coating. I would prefer keeping it rather than shipping it back if I can get a $25 discount.',
        customerAccessToken: 'tok_clara_19284e',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [
          {
            id: 'ev-04',
            caseId: 'case-105',
            originalFilename: 'boom_arm_scratch.png',
            mimeType: 'image/png',
            byteSize: 312000,
            width: 1080,
            height: 1080,
            sha256Hash: 'c9e0192837465019283746501928374650192837465019283746501928374650',
            isDuplicate: false,
            uploadedAt: '2026-11-03T14:10:00Z',
            scanStatus: 'clean',
            evidenceType: 'item_photo',
            caption: 'Surface scratch on matte black arm finish',
            downloadUrl: '/api/v1/evidence/ev-04/file',
          },
        ],
        aiInvestigation: {
          issue_type: 'damaged_item',
          customer_claim: 'Customer reports minor surface abrasion and requests $25 partial concession.',
          reported_facts: [
            'Item is functional and customer wishes to retain possession.',
            'Requested partial amount: $25.00 against $110.00 total order (22.7%).',
          ],
          evidence_observations: [
            'Photo depicts minor linear paint coat scratch on aluminum tubular arm.',
            'No structural deformation or functional impairment visible.',
          ],
          missing_information: [],
          inconsistencies: [],
          policy_references: [
            'Section 6.2: Partial refund without return permitted up to 50% for minor cosmetic blemishes.',
          ],
          limitations: ['Cannot confirm acoustic recording performance from photograph.'],
          recommended_next_step: 'eligible_for_merchant_review',
          explanation:
            'Claim meets criteria for voluntary partial refund without return. The requested amount ($25.00) is well within policy limit (max $55.00).',
          analyzed_at: '2026-11-03T14:12:00Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'ELIGIBLE_FOR_MERCHANT_REVIEW',
          policy_version: 'v2.1',
          eligible_amount: 25.0,
          missing_requirements: [],
          reason_codes: ['PARTIAL_REFUND_CRITERIA_SATISFIED'],
          rules_evaluated: [
            {
              ruleId: 'R-06',
              ruleName: 'Partial Refund Cap',
              description: 'Partial refund without return capped at 50% ($55.00)',
              passed: true,
              details: 'Requested $25.00 is 22.7% of order total (Limit: 50%)',
            },
          ],
          evaluated_at: '2026-11-03T14:12:01Z',
        },
        refundAttempts: [],
        timeline: [],
        createdAt: '2026-11-03T14:10:00Z',
        updatedAt: '2026-11-03T14:12:01Z',
      },
      {
        id: 'case-106',
        tenantId: tenantApex.id,
        caseNumber: 'FR-2026-006',
        orderId: 'ord-88106',
        orderNumber: 'APX-2026-9588',
        paypalOrderId: '7T9182736450192U',
        paypalCaptureId: '8V9182736450192W',
        customerName: 'Liam Brody',
        customerEmail: 'liam.b@example.com',
        status: 'ESCALATED',
        issueType: 'damaged_item',
        requestedResolution: 'full_refund',
        customerDescription:
          'Speaker grill has a huge dent in it straight out of the box. Need full refund immediately.',
        customerAccessToken: 'tok_liam_29385f',
        tokenExpiresAt: '2026-12-01T00:00:00Z',
        evidence: [
          {
            id: 'ev-05',
            caseId: 'case-106',
            originalFilename: 'speaker_dented_mesh.jpg',
            mimeType: 'image/jpeg',
            byteSize: 184200,
            width: 1200,
            height: 900,
            sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            isDuplicate: true,
            duplicateCaseIds: ['case-101'],
            uploadedAt: '2026-11-05T08:20:00Z',
            scanStatus: 'suspicious',
            evidenceType: 'item_photo',
            caption: 'Re-uploaded evidence matching previous case',
            downloadUrl: '/api/v1/evidence/ev-05/file',
          },
        ],
        aiInvestigation: {
          issue_type: 'damaged_item',
          customer_claim: 'Customer reports dented speaker grill on newly received portable speaker.',
          reported_facts: ['Customer claims physical damage out of box.'],
          evidence_observations: [
            'System integrity check: SHA-256 fingerprint matches an identical file previously uploaded in Case FR-2026-001 (different customer/order).',
          ],
          missing_information: ['Authentic photo of the actual serial number and speaker unit.'],
          inconsistencies: [
            'Exact duplicate file byte match with an earlier case involving headphones.',
          ],
          policy_references: [
            'Section 7.1: Re-used or duplicate photographic evidence triggers mandatory investigation escalation.',
          ],
          limitations: [
            'Evidence authenticity cannot be established. Do not authorize automated refund.',
          ],
          recommended_next_step: 'manual_inspection_required',
          explanation:
            'Security alert: Evidence hash collision detected across separate cases. Requires human security review before any refund consideration.',
          analyzed_at: '2026-11-05T08:22:00Z',
          model_used: 'gemini-3.8-flash',
        },
        policyEvaluation: {
          result: 'MANUAL_REVIEW_REQUIRED',
          policy_version: 'v2.1',
          eligible_amount: null,
          missing_requirements: [
            'Duplicate cryptographic evidence hash detected across prior claims',
          ],
          reason_codes: ['DUPLICATE_EVIDENCE_HASH_DETECTED', 'MANUAL_SECURITY_REVIEW_TRIGGERED'],
          rules_evaluated: [
            {
              ruleId: 'R-07',
              ruleName: 'Evidence Deduplication Check',
              description: 'Flags re-uploaded images identical to previous cases',
              passed: false,
              details: 'Exact SHA-256 matches case-101. Auto-escalated for manual review.',
            },
          ],
          evaluated_at: '2026-11-05T08:22:01Z',
        },
        refundAttempts: [],
        timeline: [],
        createdAt: '2026-11-05T08:20:00Z',
        updatedAt: '2026-11-05T08:22:01Z',
      },
    ];

    cases.forEach((c) => {
      this.data.cases[c.id] = c;
    });
  }

  // -------------------------------------------------------------
  // ENTITY ACCESSORS
  // -------------------------------------------------------------
  get tenants() {
    return this.data.tenants;
  }
  get users() {
    return this.data.users;
  }
  get sessions() {
    return this.data.sessions;
  }
  get orders() {
    return this.data.orders;
  }
  get cases() {
    return this.data.cases;
  }
  get policies() {
    return this.data.policies;
  }
  get refundAttempts() {
    return this.data.refundAttempts;
  }
  get refundApprovals() {
    if (!this.data.refundApprovals) {
      this.data.refundApprovals = {};
    }
    return this.data.refundApprovals;
  }
  get auditEvents() {
    return this.data.auditEvents;
  }
  get outbox() {
    return this.data.outbox;
  }
  get invitations() {
    if (!this.data.invitations) {
      this.data.invitations = {};
    }
    return this.data.invitations;
  }

  // -------------------------------------------------------------
  // AUDIT LOGGING WITH CRYPTOGRAPHIC SHA-256 HASH CHAINING
  // -------------------------------------------------------------
  public appendAuditEvent(event: CaseEvent) {
    const lastEvent = this.data.auditEvents[this.data.auditEvents.length - 1];
    const previousHash = lastEvent?.currentHash || '0000000000000000000000000000000000000000000000000000000000000000';
    const payload = `${previousHash}|${event.caseId}|${event.eventType}|${event.timestamp}|${JSON.stringify(event.details || {})}`;
    event.previousHash = previousHash;
    event.currentHash = crypto.createHash('sha256').update(payload).digest('hex');

    this.data.auditEvents.push(event);
    this.scheduleSave();

    if (this.isPostgresConnected && this.pgPool) {
      this.pgPool.query(
        `INSERT INTO audit_events (
          id, tenant_id, case_id, event_type, actor_type, actor_id, actor_name, actor_role,
          summary, details, previous_hash, current_hash, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO NOTHING`,
        [
          event.id,
          this.data.cases[event.caseId]?.tenantId || 'tenant-apex-101',
          event.caseId,
          event.eventType,
          event.actor.type,
          event.actor.id || null,
          event.actor.name,
          event.actor.role || null,
          event.summary,
          event.details ? JSON.stringify(event.details) : null,
          event.previousHash,
          event.currentHash,
          event.timestamp,
        ]
      ).catch((err) => console.warn('[Database] Failed to insert audit event into Postgres:', err.message));
    }
  }

  public verifyAuditChainIntegrity(): { isValid: boolean; checkedCount: number; brokenAtIndex?: number } {
    const events = this.data.auditEvents;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const prev = i > 0 ? events[i - 1].currentHash : '0000000000000000000000000000000000000000000000000000000000000000';
      if (e.previousHash && e.previousHash !== prev) {
        return { isValid: false, checkedCount: i, brokenAtIndex: i };
      }
      if (e.currentHash) {
        const payload = `${e.previousHash || prev}|${e.caseId}|${e.eventType}|${e.timestamp}|${JSON.stringify(e.details || {})}`;
        const recomputed = crypto.createHash('sha256').update(payload).digest('hex');
        if (recomputed !== e.currentHash) {
          return { isValid: false, checkedCount: i, brokenAtIndex: i };
        }
      }
    }
    return { isValid: true, checkedCount: events.length };
  }

  // -------------------------------------------------------------
  // EVIDENCE HASH SEARCH
  // -------------------------------------------------------------
  public findDuplicateEvidence(hash: string, excludeCaseId?: string): string[] {
    const matchedCaseIds: string[] = [];
    for (const c of Object.values(this.data.cases)) {
      if (excludeCaseId && c.id === excludeCaseId) continue;
      for (const ev of c.evidence) {
        if (ev.sha256Hash === hash) {
          matchedCaseIds.push(c.id);
          break;
        }
      }
    }
    return matchedCaseIds;
  }

  // -------------------------------------------------------------
  // STATUS HELPER
  // -------------------------------------------------------------
  public getGatewayStatus(): PayPalGatewayStatus {
    const diag = paypalGateway.getDiagnostics();
    let genuineRefundedGross = 0;
    let simulatedRefundedGross = 0;
    let genuineRefundCount = 0;
    let simulatedRefundCount = 0;

    for (const c of Object.values(this.data.cases)) {
      for (const r of c.refundAttempts) {
        if (r.status === 'SUCCEEDED') {
          if (r.isSimulated) {
            simulatedRefundCount++;
            simulatedRefundedGross += r.amount;
          } else {
            genuineRefundCount++;
            genuineRefundedGross += r.amount;
          }
        }
      }
    }

    return {
      environment: 'sandbox',
      isConfigured: diag.isConfigured,
      clientIdMasked: diag.clientIdMasked,
      liveEnabled: false,
      verificationStatus: diag.verificationStatus,
      lastVerifiedAt: diag.lastVerifiedAt,
      lastError: diag.lastError,
      activeOrderCount: Object.keys(this.data.orders).length,
      refundCount: genuineRefundCount + simulatedRefundCount,
      genuineRefundCount,
      simulatedRefundCount,
      totalRefundedGross: genuineRefundedGross + simulatedRefundedGross,
      genuineRefundedGross,
      simulatedRefundedGross,
    };
  }
}

export const db = new Database();
