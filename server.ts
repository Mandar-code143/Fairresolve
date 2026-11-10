/**
 * FairResolve Production-Grade Fintech Server
 *
 * Express 4 API server with Vite dev middleware mounting.
 * Provides:
 * - Real Session Authentication & RBAC (OWNER, ADMIN, REVIEWER, ANALYST, VIEWER)
 * - HttpOnly, Secure Session Cookies & Bearer Token Authentication
 * - Multi-Tenant Data Isolation
 * - Durable Database Persistence (Atomic JSON persistence engine & PostgreSQL compatibility)
 * - Multimodal AI Investigation with Gemini 2.5/3.8 Flash & strict Zod schema validation
 * - Deterministic Policy Engine with minor-unit (cents) integer arithmetic
 * - Authentic PayPal Sandbox Gateway (Orders v2 create/capture, Payments v2 refund captures)
 * - Strict Idempotency via PayPal-Request-Id
 * - Private Evidence Processing with Sharp, EXIF stripping, and magic byte validation
 * - Tamper-Evident SHA-256 Hash-Chained Audit Ledger
 * - Transactional Outbox Background Worker
 */

import express, { Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { db, OutboxEvent } from './src/server/database';
import {
  authService,
  requireAuth,
  requireRoles,
  requirePermission,
  AuthenticatedRequest,
} from './src/server/auth';
import { permissionService } from './src/server/permissions';
import { approvalService } from './src/server/approvalService';
import { paypalGateway } from './src/server/paypalGateway';
import { geminiService } from './src/server/geminiService';
import { policyEngine, toCents, toDollars } from './src/server/policyEngine';
import { evidenceProcessor } from './src/server/evidenceProcessor';
import { backgroundWorker } from './src/server/worker';
import { CaseEvent, MerchantInvitation, PendingCheckout, RefundApproval, RefundAttempt, UserRole } from './src/types';
import config from './src/server/config';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : config.PORT;
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || config.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE !== 'false' && config.DEMO_MODE;

// -------------------------------------------------------------
// CORE SECURITY MIDDLEWARE
// -------------------------------------------------------------

// Helmet security headers (configured for Vite inline scripts in dev)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cookieParser(config.SESSION_SECRET));

// Explicit CORS Origin Allowlist - rejects arbitrary unknown origins
const allowedOrigins = config.ALLOWED_ORIGINS;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (mobile, server-to-server, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked: Origin ${origin} is not allowed by policy.`));
    },
    credentials: true,
  })
);

// Body parsing with generous ceiling for high-res evidence uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// -------------------------------------------------------------
// RATE LIMITERS
// -------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const refundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Refund rate limit exceeded. Please wait before submitting more refunds.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Upload rate limit reached. Please wait before uploading more files.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// -------------------------------------------------------------
// HEALTH ENDPOINTS
// -------------------------------------------------------------
app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  const failures: string[] = [];

  if (process.env.NODE_ENV !== 'test') {
    try {
      await db.waitForReady();
    } catch (err: any) {
      failures.push(`Database readiness failed: ${err.message}`);
    }
  }

  const isPostgresRequired = IS_PRODUCTION || (process.env.NODE_ENV !== 'test' && Boolean(config.DATABASE_URL));
  const isPostgresReady = db.isPostgresActive();
  let postgresPingOk = false;
  let migrationVersion = 0;

  if (isPostgresReady) {
    postgresPingOk = await db.pingPostgres();
    if (!postgresPingOk) {
      failures.push('PostgreSQL health check query (SELECT 1) failed');
    } else if (db.getPgPool()) {
      try {
        const migRes = await db.getPgPool()!.query('SELECT MAX(version) AS max_ver FROM schema_migrations');
        migrationVersion = Number(migRes.rows[0]?.max_ver || 0);
        if (migrationVersion < 3) {
          failures.push(`PostgreSQL schema migration incomplete (version=${migrationVersion}, expected>=3)`);
        }
      } catch (err: any) {
        failures.push(`Failed to inspect schema_migrations: ${err.message}`);
      }
    }
  } else if (isPostgresRequired) {
    failures.push('PostgreSQL connection is required and not currently active');
  }

  const storageWritable = db.verifyStorageWritable();
  if (!storageWritable) {
    failures.push(`Storage directory is not writable (${db.getDataDir()})`);
  }

  const initialDataLoaded = db.isInitialDataLoaded();
  if (!initialDataLoaded) {
    failures.push('Initial tenant/seed state has not finished loading');
  }

  const workerRequired =
    process.env.NODE_ENV !== 'test' &&
    process.env.SERVICE_TYPE !== 'worker' &&
    config.RUN_IN_PROCESS_WORKER;
  const workerActive = backgroundWorker.isActive();
  if (workerRequired && !workerActive) {
    failures.push('In-process background outbox worker is not active');
  }

  const auditVerification = db.verifyAuditChainIntegrity();
  const gatewayStatus = db.getGatewayStatus();

  if (failures.length > 0) {
    return res.status(503).json({
      status: 'not_ready',
      errors: failures,
      postgresActive: isPostgresReady,
      postgresPingOk,
      migrationVersion,
      storageWritable,
      initialDataLoaded,
      workerActive,
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    postgresActive: isPostgresReady,
    postgresPingOk,
    migrationVersion,
    storageWritable,
    storageDir: db.getDataDir(),
    durableDatabaseLoaded: initialDataLoaded,
    workerActive,
    paypalConfigured: gatewayStatus.isConfigured,
    paypalVerificationStatus: gatewayStatus.verificationStatus,
    aiAvailable: geminiService.isAvailable(),
    auditChainIntact: auditVerification.isValid,
    auditCheckedCount: auditVerification.checkedCount,
  });
});

// -------------------------------------------------------------
// AUTHENTICATION & SESSION API
// -------------------------------------------------------------

// List public demo accounts for local development / test evaluation
app.get('/api/v1/auth/demo-accounts', (_req, res) => {
  if (IS_PRODUCTION && process.env.DEMO_MODE !== 'true') {
    return res.status(403).json({ error: 'Demo accounts are strictly disabled in production.' });
  }

  const demoUsers = Object.values(db.users).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    tenantName: db.tenants[u.tenantId]?.name || 'Apex Audio & Gear',
  }));
  res.json({ demoUsers });
});

// Demo Login: Issues a real session token and HttpOnly cookie for an explicitly requested account
app.post('/api/v1/auth/demo-login', authLimiter, async (req, res) => {
  if (IS_PRODUCTION && process.env.DEMO_MODE !== 'true') {
    return res.status(403).json({ error: 'Demo login is strictly disabled in production.' });
  }

  const { userId } = req.body;
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'Explicit userId parameter is required for demo login.' });
  }

  const userAccount = db.users[userId.trim()];
  if (!userAccount) {
    return res.status(404).json({ error: `Demo account '${userId}' not found.` });
  }

  const { session, token } = authService.createSession(userAccount.id, userAccount.tenantId, req);
  if (db.isPostgresActive()) {
    await db.saveSessionPg(session);
  }
  authService.setAuthCookie(res, token);
  const tenant = db.tenants[userAccount.tenantId];

  res.json({
    token,
    user: {
      id: userAccount.id,
      name: userAccount.name,
      email: userAccount.email,
      role: userAccount.role,
      tenantId: userAccount.tenantId,
      avatarUrl: userAccount.avatarUrl,
    },
    tenant,
    expiresAt: session.expiresAt,
  });
});

// Regular Login: Verifies email and password using timing-safe scrypt
app.post('/api/v1/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const userAccount = Object.values(db.users).find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );

  if (!userAccount) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const isValid = authService.verifyPassword(password, userAccount.passwordSalt, userAccount.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { session, token } = authService.createSession(userAccount.id, userAccount.tenantId, req);
  if (db.isPostgresActive()) {
    await db.saveSessionPg(session);
  }
  authService.setAuthCookie(res, token);
  const tenant = db.tenants[userAccount.tenantId];

  res.json({
    token,
    user: {
      id: userAccount.id,
      name: userAccount.name,
      email: userAccount.email,
      role: userAccount.role,
      tenantId: userAccount.tenantId,
      avatarUrl: userAccount.avatarUrl,
    },
    tenant,
    expiresAt: session.expiresAt,
  });
});

// Register New Merchant Owner
app.post('/api/v1/auth/register', authLimiter, async (req, res) => {
  const { name, email, password, companyName } = req.body;
  if (!name || !email || !password || !companyName) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const strength = authService.validatePasswordStrength(password);
  if (!strength.isValid) {
    return res.status(400).json({ error: strength.message });
  }

  const existing = Object.values(db.users).find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const tenantId = `tenant-${crypto.randomUUID().substring(0, 8)}`;
  db.tenants[tenantId] = {
    id: tenantId,
    name: companyName,
    slug: companyName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    currency: 'USD',
    createdAt: new Date().toISOString(),
  };

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = authService.hashPassword(password, salt);
  const userId = `usr-${crypto.randomUUID().substring(0, 8)}`;

  const newUser = {
    id: userId,
    name,
    email,
    role: 'OWNER' as UserRole,
    tenantId,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  db.users[userId] = newUser;
  await db.saveTenantPg(db.tenants[tenantId]);
  await db.saveUserPg(newUser);

  // Initial default policy for new tenant
  db.policies[tenantId] = [
    {
      version: 'v1.0',
      publishedAt: new Date().toISOString(),
      returnWindowDays: 30,
      requirePackagingPhotoForDamage: true,
      requireLabelPhotoForWrongItem: true,
      carrierDeliveryVerificationDays: 3,
      maxInstantRefundAmount: 250,
      mandatoryReturnThreshold: 200,
      allowPartialRefundsWithoutReturn: true,
      maxPartialRefundPercentage: 50,
      flagDuplicateEvidenceHash: true,
      description: `Default policy initialized for ${companyName}`,
    },
  ];

  db.scheduleSave();

  const { session, token } = authService.createSession(userId, tenantId, req);
  if (db.isPostgresActive()) {
    await db.savePolicyPg(tenantId, db.policies[tenantId][0]);
    await db.saveSessionPg(session);
  }
  authService.setAuthCookie(res, token);

  res.json({
    token,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, tenantId },
    tenant: db.tenants[tenantId],
    expiresAt: session.expiresAt,
  });
});

// Logout: Revokes session token & clears cookie
app.post('/api/v1/auth/logout', (req, res) => {
  let rawToken: string | undefined;
  if (req.cookies && req.cookies.fairresolve_session) {
    rawToken = req.cookies.fairresolve_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.substring(7);
  }
  if (rawToken) {
    authService.revokeSession(rawToken);
  }
  authService.clearAuthCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current session user
app.get('/api/v1/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const tenant = db.tenants[req.user!.tenantId];
  res.json({ user: req.user, tenant });
});

// -------------------------------------------------------------
// TEAM INVITATIONS API
// -------------------------------------------------------------

app.get('/api/v1/merchant/team', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const members = Object.values(db.users)
    .filter((u) => u.tenantId === req.tenantId)
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
    }));
  res.json({ members });
});

app.get('/api/v1/merchant/team/invitations', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const invitations = Object.values(db.invitations).filter(
    (inv) => inv.tenantId === req.tenantId && inv.status === 'PENDING'
  );
  res.json({ invitations });
});

// Create secure team invitation (returns copyable invitation link)
app.post(
  '/api/v1/merchant/team/invite',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role are required' });
    }

    const validRoles: UserRole[] = ['ADMIN', 'REVIEWER', 'ANALYST', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Permitted: ${validRoles.join(', ')}` });
    }

    // Check if user already exists
    const existing = Object.values(db.users).find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.tenantId === req.tenantId
    );
    if (existing) {
      return res.status(409).json({ error: 'A team member with this email already exists.' });
    }

    const rawInviteToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawInviteToken).digest('hex');
    const invitationId = `inv-${crypto.randomUUID().substring(0, 8)}`;

    const invitation: MerchantInvitation = {
      id: invitationId,
      tenantId: req.tenantId!,
      email: email.toLowerCase().trim(),
      role: role as UserRole,
      tokenHash,
      invitedByUserId: req.user!.id,
      invitedByName: req.user!.name,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };

    db.invitations[invitation.id] = invitation;
    if (db.isPostgresActive()) {
      await db.saveInvitationPg(invitation);
    }
    db.scheduleSave();

    const inviteLink = `/accept-invite?token=${rawInviteToken}`;
    res.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      inviteLink,
      rawInviteToken,
    });
  }
);

// Verify an invitation token before display
app.get('/api/v1/merchant/invitations/verify', async (req, res) => {
  const rawToken = req.query.token as string;
  if (!rawToken) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const inv = Object.values(db.invitations).find(
    (i) => i.tokenHash === tokenHash && i.status === 'PENDING'
  );

  if (!inv) {
    return res.status(404).json({ error: 'Invitation not found or has already been used.' });
  }

  if (new Date(inv.expiresAt).getTime() < Date.now()) {
    inv.status = 'EXPIRED';
    if (db.isPostgresActive()) {
      await db.saveInvitationPg(inv);
    }
    db.scheduleSave();
    return res.status(410).json({ error: 'This invitation has expired. Please request a new invite.' });
  }

  const tenant = db.tenants[inv.tenantId];
  res.json({
    isValid: true,
    email: inv.email,
    role: inv.role,
    tenantName: tenant?.name || 'FairResolve Merchant',
    invitedByName: inv.invitedByName,
  });
});

// Accept invitation & establish password
app.post('/api/v1/merchant/invitations/accept', authLimiter, async (req, res) => {
  const { token, name, password } = req.body;
  if (!token || !name || !password) {
    return res.status(400).json({ error: 'Token, name, and password are required' });
  }

  const strength = authService.validatePasswordStrength(password);
  if (!strength.isValid) {
    return res.status(400).json({ error: strength.message });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const inv = Object.values(db.invitations).find(
    (i) => i.tokenHash === tokenHash && i.status === 'PENDING'
  );

  if (!inv) {
    return res.status(404).json({ error: 'Invalid or already accepted invitation.' });
  }

  if (new Date(inv.expiresAt).getTime() < Date.now()) {
    inv.status = 'EXPIRED';
    if (db.isPostgresActive()) {
      await db.saveInvitationPg(inv);
    }
    db.scheduleSave();
    return res.status(410).json({ error: 'This invitation has expired.' });
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = authService.hashPassword(password, salt);
  const userId = `usr-${crypto.randomUUID().substring(0, 8)}`;

  const newUser = {
    id: userId,
    name,
    email: inv.email,
    role: inv.role,
    tenantId: inv.tenantId,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };

  db.users[userId] = newUser;
  inv.status = 'ACCEPTED';
  inv.acceptedAt = new Date().toISOString();

  const { session, token: sessionToken } = authService.createSession(userId, inv.tenantId, req);
  if (db.isPostgresActive()) {
    await db.saveUserPg(newUser);
    await db.saveInvitationPg(inv);
    await db.saveSessionPg(session);
  }
  db.scheduleSave();

  authService.setAuthCookie(res, sessionToken);

  res.json({
    success: true,
    token: sessionToken,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, tenantId: newUser.tenantId },
    tenant: db.tenants[newUser.tenantId],
  });
});

// Revoke invitation
app.delete(
  '/api/v1/merchant/team/invitations/:id',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    const inv = db.invitations[req.params.id];
    if (!inv || inv.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    inv.status = 'REVOKED';
    if (db.isPostgresActive()) {
      await db.saveInvitationPg(inv);
    }
    db.scheduleSave();
    res.json({ success: true, message: 'Invitation revoked' });
  }
);

// -------------------------------------------------------------
// DISPUTE CASES API (Protected with requireAuth)
// -------------------------------------------------------------

app.get('/api/v1/cases', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { status, issueType, search } = req.query;
  const tenantId = req.tenantId!;
  const user = req.user!;

  let cases = Object.values(db.cases).filter((c) => c.tenantId === tenantId);

  // Scope filter: Analysts only view cases assigned to them or unassigned
  cases = cases.filter((c) => permissionService.canAccessCase(user, c));

  if (status && status !== 'ALL') {
    cases = cases.filter((c) => c.status === status);
  }

  if (issueType && issueType !== 'ALL') {
    cases = cases.filter((c) => c.issueType === issueType);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    cases = cases.filter(
      (c) =>
        c.caseNumber.toLowerCase().includes(q) ||
        c.orderNumber.toLowerCase().includes(q) ||
        (user.role !== 'VIEWER' && c.customerName.toLowerCase().includes(q)) ||
        c.customerDescription.toLowerCase().includes(q)
    );
  }

  cases.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Serialize and redact according to role permissions (e.g. mask PII and strip private tokens for VIEWER)
  const serialized = cases.map((c) => permissionService.serializeCase(c, user));
  res.json({ cases: serialized, total: serialized.length });
});

app.get('/api/v1/cases/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const c = db.cases[req.params.id];
  if (!c || c.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const user = req.user!;
  if (!permissionService.canAccessCase(user, c)) {
    return res.status(403).json({ error: 'Access denied: You are not assigned to this case.' });
  }

  const order = db.orders[c.orderId];
  const tenantPolicies = db.policies[c.tenantId] || [];
  const activePolicy = tenantPolicies[tenantPolicies.length - 1];

  const serialized = permissionService.serializeCase(c, user);
  res.json({ case: serialized, order, policy: activePolicy });
});

// Re-run AI investigation & policy evaluation
app.post(
  '/api/v1/cases/:id/re-analyze',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'REVIEWER', 'ANALYST']),
  async (req: AuthenticatedRequest, res: Response) => {
    const c = db.cases[req.params.id];
    if (!c || c.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const order = db.orders[c.orderId];
    if (!order) return res.status(404).json({ error: 'Associated order not found' });

    const tenantPolicies = db.policies[c.tenantId] || [];
    const policy = tenantPolicies[tenantPolicies.length - 1];

    c.status = 'ANALYZING';

    try {
      const imagesBase64: Array<{ mimeType: string; data: string; filename: string }> = [];
      for (const ev of c.evidence) {
        if (ev.thumbnailBase64 && ev.thumbnailBase64.includes('base64,')) {
          imagesBase64.push({
            mimeType: ev.mimeType,
            data: ev.thumbnailBase64.split('base64,')[1],
            filename: ev.originalFilename,
          });
        }
      }

      const aiResult = await geminiService.runInvestigation({
        issueType: c.issueType,
        customerClaim: c.customerDescription,
        orderNumber: c.orderNumber,
        itemsOrdered: order.items.map((i) => ({ name: i.name, sku: i.sku, quantity: i.quantity })),
        policy,
        imagesBase64,
      });

      c.aiInvestigation = aiResult;

      // Deterministic policy evaluation
      const policyResult = policyEngine.evaluate(c, order, policy);
      c.policyEvaluation = policyResult;

      if (policyResult.result === 'ELIGIBLE_FOR_MERCHANT_REVIEW') {
        c.status = 'READY_FOR_REVIEW';
      } else if (policyResult.result === 'MORE_INFORMATION_REQUIRED') {
        c.status = 'NEEDS_MORE_INFORMATION';
      } else if (policyResult.result === 'MANUAL_REVIEW_REQUIRED') {
        c.status = 'ESCALATED';
      } else {
        c.status = 'READY_FOR_REVIEW';
      }

      c.updatedAt = new Date().toISOString();

      const event: CaseEvent = {
        id: `ev-log-${Date.now()}`,
        caseId: c.id,
        eventType: 'AI_INVESTIGATION_COMPLETED',
        actor: { type: 'AI_ENGINE', name: aiResult.model_used },
        summary: `AI analysis completed. Policy outcome: ${policyResult.result}`,
        details: { aiResult, policyResult },
        timestamp: new Date().toISOString(),
      };
      c.timeline.push(event);
      db.appendAuditEvent(event);
      if (db.isPostgresActive()) {
        await db.saveAiRunPg(c.id, aiResult);
        await db.savePolicyEvaluationPg(c.id, policyResult);
        await db.saveCasePg(c);
      }
      db.scheduleSave();

      res.json({ success: true, case: c });
    } catch (err: any) {
      c.status = 'READY_FOR_REVIEW';
      if (db.isPostgresActive()) {
        await db.saveCasePg(c).catch(() => {});
      }
      db.scheduleSave();
      res.status(500).json({ error: err.message || 'AI analysis failed' });
    }
  }
);

// Merchant decision review
app.post(
  '/api/v1/cases/:id/review',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
  async (req: AuthenticatedRequest, res: Response) => {
    const { decision, reason, notes, requestedAmount } = req.body;
    const c = db.cases[req.params.id];
    if (!c || c.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const user = req.user!;

    if (decision === 'APPROVE') {
      try {
        const result = approvalService.createRefundApproval({
          caseId: c.id,
          tenantId: c.tenantId,
          approver: user,
          requestedAmount: requestedAmount !== undefined ? parseFloat(requestedAmount) : undefined,
          notes: notes || reason,
          reason,
        });
        if (notes) result.case.merchantNotes = notes;
        if (db.isPostgresActive() && result.approval) {
          await db.saveRefundApprovalPg(result.approval);
          await db.saveCasePg(result.case);
        }
        return res.json({ success: true, case: result.case, approval: result.approval });
      } catch (err: any) {
        return res.status(err.statusCode || 400).json({ error: err.message || 'Failed to approve case' });
      }
    } else if (decision === 'REJECT') {
      try {
        const updatedCase = approvalService.revokeApproval(c.id, c.tenantId, user, reason);
        if (notes) updatedCase.merchantNotes = notes;
        if (db.isPostgresActive()) {
          await db.saveCasePg(updatedCase);
        }
        return res.json({ success: true, case: updatedCase });
      } catch (err: any) {
        return res.status(err.statusCode || 400).json({ error: err.message || 'Failed to revoke case' });
      }
    } else if (decision === 'REQUEST_INFO') {
      c.status = 'NEEDS_MORE_INFORMATION';
    } else if (decision === 'ESCALATE') {
      c.status = 'ESCALATED';
    } else {
      return res.status(400).json({ error: 'Invalid decision specified' });
    }

    if (notes) c.merchantNotes = notes;
    c.updatedAt = new Date().toISOString();

    const event: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'MERCHANT_REVIEWED',
      actor: { type: 'MERCHANT', id: user.id, name: user.name, role: user.role },
      summary: `Merchant marked decision: ${decision}. ${reason ? `Reason: ${reason}` : ''}`,
      details: { decision, reason, notes },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(event);
    db.appendAuditEvent(event);
    if (db.isPostgresActive()) {
      await db.saveCasePg(c);
    }
    db.scheduleSave();

    res.json({ success: true, case: c });
  }
);

// Approve refund recommendation (Role: OWNER or REVIEWER)
app.post(
  '/api/v1/cases/:id/approve-refund',
  requireAuth,
  requireRoles(['OWNER', 'REVIEWER']),
  async (req: AuthenticatedRequest, res: Response) => {
    const { amount, notes, reason } = req.body;
    const user = req.user!;
    try {
      const result = approvalService.createRefundApproval({
        caseId: req.params.id,
        tenantId: req.tenantId!,
        approver: user,
        requestedAmount: amount !== undefined ? parseFloat(amount) : undefined,
        notes,
        reason,
      });
      if (db.isPostgresActive() && result.approval) {
        await db.saveRefundApprovalPg(result.approval);
        await db.saveCasePg(result.case);
      }
      res.json({ success: true, case: result.case, approval: result.approval });
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message || 'Failed to approve refund' });
    }
  }
);

// Assign case to team member (Role: OWNER, ADMIN, REVIEWER)
app.post(
  '/api/v1/cases/:id/assign',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
  async (req: AuthenticatedRequest, res: Response) => {
    const { assignedTo } = req.body;
    const c = db.cases[req.params.id];
    if (!c || c.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (!assignedTo) {
      c.assignedTo = undefined;
      c.assignedToName = undefined;
      c.assignedAt = undefined;
      c.assignedBy = undefined;
      c.updatedAt = new Date().toISOString();
      if (db.isPostgresActive()) {
        await db.saveCasePg(c);
      }
      db.scheduleSave();
      return res.json({ success: true, case: c, message: 'Case unassigned' });
    }

    const assignee = db.users[assignedTo];
    if (!assignee || assignee.tenantId !== req.tenantId) {
      return res.status(400).json({ error: 'Assigned user does not exist in this tenant' });
    }

    const user = req.user!;
    c.assignedTo = assignee.id;
    c.assignedToName = assignee.name;
    c.assignedAt = new Date().toISOString();
    c.assignedBy = user.id;
    c.updatedAt = new Date().toISOString();

    const assignEvent: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'CASE_ASSIGNED',
      actor: { type: 'MERCHANT', id: user.id, name: user.name, role: user.role },
      summary: `Case assigned to ${assignee.name} (${assignee.role}) by ${user.name}`,
      details: {
        assignedTo: assignee.id,
        assignedToName: assignee.name,
        assignedToRole: assignee.role,
        assignedBy: user.id,
      },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(assignEvent);
    db.appendAuditEvent(assignEvent);
    if (db.isPostgresActive()) {
      await db.saveCasePg(c);
    }
    db.scheduleSave();

    res.json({ success: true, case: c });
  }
);

// Unified Four-Eyes Refund Execution Handler
const executeRefundHandler = async (req: AuthenticatedRequest, res: Response) => {
  const { amount, reason, idempotencyKey } = req.body;
  const c = db.cases[req.params.id];
  if (!c || c.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const order = db.orders[c.orderId];
  if (!order) return res.status(404).json({ error: 'Associated order not found' });

  const user = req.user!;

  // 1. Mandatory client idempotencyKey check (no generated fallback)
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return res.status(400).json({ error: 'Missing required idempotencyKey for refund execution' });
  }
  const key = idempotencyKey.trim();

  // 2. Check existing attempt with same idempotency key (deduplication & mismatch detection)
  const existingAttempt =
    c.refundAttempts.find((a) => a.idempotencyKey === key) ||
    Object.values(db.refundAttempts).find((a) => a.idempotencyKey === key) ||
    (await db.findRefundAttemptByIdempotencyKey(key));

  if (existingAttempt) {
    if (amount === undefined && !c.activeApproval) {
      return res.status(400).json({
        error: 'Refund execution requires an explicit active approval record. Cannot infer amount from order balance.',
      });
    }
    const candidateAmountDollars =
      amount !== undefined ? parseFloat(amount) : c.activeApproval!.approvedAmount;
    const candidateAmountCents = toCents(candidateAmountDollars);
    const candidatePayload = JSON.stringify({
      caseId: c.id,
      orderId: order.id,
      captureId: order.paypalCaptureId,
      amountCents: candidateAmountCents,
      currency: order.currency,
      reason: reason || c.activeApproval?.notes || existingAttempt.reason || '',
    });
    const candidateFingerprint = crypto.createHash('sha256').update(candidatePayload).digest('hex');

    // Parameter mismatch: same idempotency key with different financial parameters
    if (existingAttempt.requestFingerprint && existingAttempt.requestFingerprint !== candidateFingerprint) {
      return res.status(422).json({
        error: 'Idempotency key parameter mismatch: request parameters differ from original submission.',
      });
    }

    if (
      existingAttempt.status === 'SUCCEEDED' ||
      existingAttempt.status === 'PENDING' ||
      existingAttempt.status === 'SUBMITTED'
    ) {
      const isSettled = existingAttempt.status === 'SUCCEEDED';
      return res.status(isSettled ? 200 : 202).json({
        success: isSettled,
        status: existingAttempt.status,
        refundAttempt: existingAttempt,
        case: c,
        order,
        isDuplicateSubmission: true,
      });
    }
  }

  // 3. Concurrency lock: Reject if another refund attempt is currently in progress or awaiting reconciliation
  const activePending = c.refundAttempts.find(
    (a) =>
      a.status === 'RESERVED' ||
      a.status === 'SUBMITTED' ||
      a.status === 'PENDING' ||
      a.status === 'UNKNOWN' ||
      a.status === 'RECONCILIATION_REQUIRED'
  );
  if (activePending) {
    return res.status(409).json({
      error: 'A refund attempt (' + activePending.id + ') is already in progress or awaiting reconciliation for this case.',
      refundAttempt: activePending,
    });
  }

  // 4. Strict approval validation using consolidated approval service
  const validation = approvalService.validateApprovalForExecution(
    c,
    order,
    user,
    amount !== undefined ? parseFloat(amount) : undefined
  );

  if (!validation.valid) {
    return res.status(validation.statusCode || 400).json({ error: validation.error });
  }

  const execAmountDollars = validation.executableAmountDollars!;
  const execAmountCents = validation.executableAmountCents!;
  const approval = validation.approval!;

  // 4. Request fingerprint calculation for the new reservation
  const fingerprintPayload = JSON.stringify({
    caseId: c.id,
    orderId: order.id,
    captureId: order.paypalCaptureId,
    amountCents: execAmountCents,
    currency: order.currency,
    reason: reason || approval.notes || '',
  });
  const fingerprint = crypto.createHash('sha256').update(fingerprintPayload).digest('hex');

  // 5. Cross-process atomic reservation transaction in PostgreSQL
  let refundRecord: RefundAttempt;
  try {
    const reservation = await db.reserveRefundTransaction({
      caseId: c.id,
      orderId: order.id,
      tenantId: c.tenantId,
      approvalId: approval.id,
      approverId: approval.authorizedBy,
      executorId: user.id,
      captureId: order.paypalCaptureId,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
      amountCents: execAmountCents,
      amountDollars: execAmountDollars,
      currency: order.currency,
      reason: reason || approval.notes || 'Merchant authorized dispute resolution via FairResolve',
      user,
    });
    refundRecord = reservation.refundAttempt;
  } catch (reserveErr: any) {
    const statusCode = reserveErr.statusCode || (reserveErr.code === '23505' ? 409 : 500);
    return res.status(statusCode).json({ error: reserveErr.message || 'Refund reservation failed' });
  }

  refundRecord.status = 'SUBMITTED';
  await db.updateRefundAttemptState(refundRecord);

  try {
    const result = await paypalGateway.refundCapture({
      captureId: order.paypalCaptureId,
      amount: execAmountDollars,
      currency: order.currency,
      idempotencyKey: key,
      noteToPayer: reason || approval.notes,
    });

    if (result.status === 'COMPLETED') {
      const returnedCents = toCents(result.amount);
      if (
        !result.refundId ||
        !Number.isFinite(returnedCents) ||
        returnedCents !== execAmountCents ||
        result.currency.toUpperCase() !== order.currency.toUpperCase()
      ) {
        const finalizedMismatch = await db.finalizeRefundTransaction({
          attemptId: refundRecord.id,
          outcome: 'RECONCILIATION_REQUIRED',
          paypalRefundId: result.refundId,
          paypalResponse: result.rawResponse,
          errorMessage: `PayPal refund response failed verification checks (returned ${result.amount} ${result.currency}).`,
          isSimulated: result.isSimulated,
          caseStatusOnNonSuccess: 'REFUND_UNKNOWN',
          actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
          summary: `PayPal refund response flagged for reconciliation due to payload/amount mismatch.`,
          eventType: 'REFUND_RECONCILIATION_REQUIRED',
          eventDetails: {
            refundId: result.refundId,
            expectedCents: execAmountCents,
            returnedCents,
            currency: result.currency,
          },
        });
        await backgroundWorker.enqueue({
          eventType: 'RECONCILE_PENDING_REFUND',
          tenantId: c.tenantId,
          payload: {
            caseId: c.id,
            refundAttemptId: refundRecord.id,
            captureId: order.paypalCaptureId,
            idempotencyKey: key,
          },
          runAfterSeconds: 30,
        });
        return res.status(202).json({
          success: false,
          status: 'RECONCILIATION_REQUIRED',
          message: 'PayPal refund response failed exact amount/currency match. Enqueued for reconciliation.',
          refundAttempt: finalizedMismatch.refundAttempt,
          case: finalizedMismatch.case || c,
          order: finalizedMismatch.order || order,
        });
      }

      const finalized = await db.finalizeRefundTransaction({
        attemptId: refundRecord.id,
        outcome: 'SUCCEEDED',
        paypalRefundId: result.refundId,
        paypalResponse: result.rawResponse,
        completedAt: result.createTime,
        isSimulated: result.isSimulated,
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal Sandbox refund of $${execAmountDollars.toFixed(2)} ${order.currency} completed. Refund ID: ${result.refundId} ${result.isSimulated ? '(Simulated Mode)' : '(Live Sandbox)'}`,
        eventType: 'REFUND_EXECUTED',
        eventDetails: {
          refundId: result.refundId,
          amount: execAmountDollars,
          currency: order.currency,
          idempotencyKey: key,
          approverId: approval.authorizedBy,
          executorId: user.id,
          isSimulated: result.isSimulated,
        },
      });

      return res.json({
        success: true,
        refundAttempt: finalized.refundAttempt,
        case: finalized.case || c,
        order: finalized.order || order,
      });
    } else if (result.status === 'PENDING' || result.status === 'UNKNOWN') {
      const finalizedPending = await db.finalizeRefundTransaction({
        attemptId: refundRecord.id,
        outcome: 'PENDING',
        paypalRefundId: result.refundId,
        paypalResponse: result.rawResponse,
        isSimulated: result.isSimulated,
        caseStatusOnNonSuccess: 'REFUND_PENDING',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal refund initiated and currently ${result.status} clearance. Refund ID: ${result.refundId}`,
        eventType: 'REFUND_EXECUTED',
        eventDetails: { refundId: result.refundId, status: result.status, idempotencyKey: key },
      });

      await backgroundWorker.enqueue({
        eventType: 'RECONCILE_PENDING_REFUND',
        tenantId: c.tenantId,
        payload: {
          caseId: c.id,
          refundAttemptId: refundRecord.id,
          captureId: order.paypalCaptureId,
          idempotencyKey: key,
        },
        runAfterSeconds: 30,
      });

      return res.status(202).json({
        success: false,
        status: 'PENDING',
        message: 'PayPal refund accepted and pending settlement. Balance will update upon confirmation.',
        refundAttempt: finalizedPending.refundAttempt,
        case: finalizedPending.case || c,
        order: finalizedPending.order || order,
      });
    } else {
      const finalizedFail = await db.finalizeRefundTransaction({
        attemptId: refundRecord.id,
        outcome: 'FAILED',
        paypalRefundId: result.refundId,
        paypalResponse: result.rawResponse,
        errorMessage: `PayPal rejected refund execution with status: ${result.status}`,
        isSimulated: result.isSimulated,
        caseStatusOnNonSuccess: 'REFUND_FAILED',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal refund failed with provider status: ${result.status}`,
        eventType: 'REFUND_FAILED',
        eventDetails: { refundId: result.refundId, status: result.status, idempotencyKey: key },
      });

      return res.status(502).json({
        success: false,
        error: `PayPal refund failed with status: ${result.status}`,
        refundAttempt: finalizedFail.refundAttempt,
        case: finalizedFail.case || c,
        order: finalizedFail.order || order,
      });
    }
  } catch (err: any) {
    const isTimeoutOrNetworkError =
      err.name === 'AbortError' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.toLowerCase().includes('timeout') ||
      err.message?.toLowerCase().includes('network') ||
      err.message?.toLowerCase().includes('fetch failed');

    if (isTimeoutOrNetworkError) {
      const finalizedRecon = await db.finalizeRefundTransaction({
        attemptId: refundRecord.id,
        outcome: 'RECONCILIATION_REQUIRED',
        errorCode: err.code,
        errorMessage: `Network or gateway timeout: ${err.message}. Enqueued for background reconciliation.`,
        caseStatusOnNonSuccess: 'REFUND_PENDING',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Gateway Reconciliation' },
        summary: `PayPal refund timed out or interrupted. Flagged for outbox reconciliation without blind retry: ${err.message}`,
        eventType: 'REFUND_EXECUTED',
        eventDetails: { error: err.message, status: 'RECONCILIATION_REQUIRED', idempotencyKey: key },
      });

      await backgroundWorker.enqueue({
        eventType: 'RECONCILE_PENDING_REFUND',
        tenantId: c.tenantId,
        payload: {
          caseId: c.id,
          refundAttemptId: refundRecord.id,
          captureId: order.paypalCaptureId,
          idempotencyKey: key,
        },
        runAfterSeconds: 30,
      });

      return res.status(202).json({
        success: false,
        status: 'RECONCILIATION_REQUIRED',
        message: 'Refund request timed out or received uncertain network state. Queued for outbox reconciliation.',
        refundAttempt: finalizedRecon.refundAttempt,
        case: finalizedRecon.case || c,
      });
    }

    const finalizedErr = await db.finalizeRefundTransaction({
      attemptId: refundRecord.id,
      outcome: 'FAILED',
      errorCode: err.code,
      errorMessage: err.message || 'PayPal refund execution failed',
      caseStatusOnNonSuccess: 'REFUND_FAILED',
      actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox' },
      summary: `PayPal refund rejected: ${err.message}`,
      eventType: 'REFUND_FAILED',
      eventDetails: { error: err.message },
    });

    return res.status(500).json({
      success: false,
      error: err.message || 'PayPal refund rejected',
      refundAttempt: finalizedErr.refundAttempt,
      case: finalizedErr.case || c,
    });
  }
};

// Dedicated execute-refund endpoint (OWNER, ADMIN)
app.post(
  '/api/v1/cases/:id/execute-refund',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  refundLimiter,
  executeRefundHandler
);

// Standard refund execution endpoint (OWNER, ADMIN, REVIEWER with four-eyes enforcement)
app.post(
  '/api/v1/cases/:id/refund',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
  refundLimiter,
  executeRefundHandler
);

// -------------------------------------------------------------
// EVIDENCE PIPELINE API
// -------------------------------------------------------------

app.post('/api/v1/evidence/upload', requireAuth, uploadLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const { caseId, filename, fileBase64, evidenceType, caption } = req.body;
  if (!caseId || !filename || !fileBase64) {
    return res.status(400).json({ error: 'Missing required upload parameters' });
  }

  const c = db.cases[caseId];
  if (!c || c.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Case not found' });
  }

  try {
    const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const result = await evidenceProcessor.processUpload(
      caseId,
      filename,
      buffer,
      evidenceType || 'item_photo',
      caption
    );

    c.evidence.push(result.evidence);
    c.updatedAt = new Date().toISOString();

    const timelineEvent: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'EVIDENCE_UPLOADED',
      actor: { type: 'MERCHANT', name: req.user!.name },
      summary: `Uploaded evidence file: ${result.evidence.originalFilename} (${(result.evidence.byteSize / 1024).toFixed(1)} KB)${result.isDuplicate ? ' [DUPLICATE HASH ALERT]' : ''}`,
      details: {
        fileId: result.evidence.id,
        sha256Hash: result.evidence.sha256Hash,
        isDuplicate: result.isDuplicate,
      },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(timelineEvent);
    db.appendAuditEvent(timelineEvent);

    // Re-evaluate deterministic policy
    const order = db.orders[c.orderId];
    const tenantPolicies = db.policies[c.tenantId] || [];
    const policy = tenantPolicies[tenantPolicies.length - 1];

    if (order && policy) {
      const evaluation = policyEngine.evaluate(c, order, policy);
      c.policyEvaluation = evaluation;
      if (evaluation.result === 'ELIGIBLE_FOR_MERCHANT_REVIEW') {
        c.status = 'READY_FOR_REVIEW';
      } else if (evaluation.result === 'MANUAL_REVIEW_REQUIRED') {
        c.status = 'ESCALATED';
      }
    }

    if (db.isPostgresActive()) {
      const storagePath = evidenceProcessor.getFilePath(result.evidence.id) || result.evidence.id;
      await db.saveEvidenceObjectPg(result.evidence, c.tenantId, storagePath, req.user?.id);
      if (c.policyEvaluation) {
        await db.savePolicyEvaluationPg(c.id, c.policyEvaluation);
      }
      await db.saveCasePg(c);
    }

    db.scheduleSave();
    res.json({ success: true, evidence: result.evidence, isDuplicate: result.isDuplicate });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Evidence processing failed' });
  }
});

// Secure Evidence Download / View Endpoint with Multi-Tenant & Customer Token Auth
app.get('/api/v1/evidence/:id/file', (req, res) => {
  const fileId = req.params.id;
  const filePath = evidenceProcessor.getFilePath(fileId);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  // Find which case holds this evidence
  let owningCase: any;
  for (const c of Object.values(db.cases)) {
    if (c.evidence.some((ev) => ev.id === fileId)) {
      owningCase = c;
      break;
    }
  }

  if (!owningCase) {
    return res.status(404).send('Evidence association not found');
  }

  // 1. Authorize via Merchant Session
  let authorized = false;
  let rawToken: string | undefined;
  if (req.cookies && req.cookies.fairresolve_session) {
    rawToken = req.cookies.fairresolve_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.substring(7);
  }

  if (rawToken) {
    const sessionValidation = authService.validateSessionToken(rawToken);
    if (sessionValidation && sessionValidation.session.tenantId === owningCase.tenantId) {
      // Role VIEWER is explicitly blocked from downloading/viewing private raw evidence binaries
      if (sessionValidation.user.role === 'VIEWER') {
        return res.status(403).send('Access denied. Role VIEWER is not permitted to access raw evidence files.');
      }
      authorized = true;
    }
  }

  // 2. Authorize via Customer Portal Token
  const customerToken = req.query.token as string;
  if (!authorized && customerToken) {
    const isTokenMatch = owningCase.customerAccessToken === customerToken;
    const isNotExpired = new Date(owningCase.tokenExpiresAt).getTime() > Date.now();
    if (isTokenMatch && isNotExpired) {
      authorized = true;
    }
  }

  if (!authorized) {
    return res.status(403).send('Access denied. Valid merchant session or unexpired dispute link required.');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath);
});

// -------------------------------------------------------------
// CHECKOUT & ORDERS (PayPal Sandbox v6 Flow)
// -------------------------------------------------------------

app.get('/api/v1/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const orders = Object.values(db.orders).filter((o) => o.tenantId === req.tenantId);
  orders.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

  if (req.user?.role === 'VIEWER') {
    const redactedOrders = orders.map((o) => ({
      ...o,
      buyerName: permissionService.maskCustomerName(o.buyerName),
      buyerEmail: permissionService.maskCustomerEmail(o.buyerEmail),
    }));
    return res.json({ orders: redactedOrders });
  }

  res.json({ orders });
});

app.get('/api/v1/orders/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const order = db.orders[req.params.id];
  if (!order || order.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (req.user?.role === 'VIEWER') {
    return res.json({
      order: {
        ...order,
        buyerName: permissionService.maskCustomerName(order.buyerName),
        buyerEmail: permissionService.maskCustomerEmail(order.buyerEmail),
      },
    });
  }

  res.json({ order });
});

// Catalog of demo products
const DEMO_CATALOG = {
  headphones: {
    name: 'AuraSound ANC Wireless Studio Headphones',
    sku: 'APX-H900-BLK',
    unitPrice: 149.99,
    shipping: 10.0,
  },
  shoes: {
    name: 'ProTrail Ultralight Running Shoes (Size 10M, Slate)',
    sku: 'APX-TRAIL-10M',
    unitPrice: 119.5,
    shipping: 9.5,
  },
  tracker: {
    name: 'PulseFit Pro Smart Tracker - Space Gray',
    sku: 'APX-FIT-GRY',
    unitPrice: 69.0,
    shipping: 0.0,
  },
};

function sanitizeCheckoutResponse(checkout: PendingCheckout) {
  const { stateTokenHash: _redacted, ...safe } = checkout;
  return safe;
}

async function finalizePendingCheckoutCapture(params: {
  checkout: PendingCheckout;
  buyerName?: string;
  buyerEmail?: string;
}): Promise<{
  statusCode: number;
  alreadyCaptured?: boolean;
  error?: string;
  checkout: PendingCheckout;
  order?: any;
  case?: any;
  customerAccessLink?: string;
  isSimulated?: boolean;
}> {
  const { checkout, buyerName, buyerEmail } = params;

  if (checkout.status === 'CAPTURED' && checkout.capturedOrderId && checkout.capturedCaseId) {
    const existingOrder = db.orders[checkout.capturedOrderId];
    const existingCase = db.cases[checkout.capturedCaseId];
    if (existingOrder && existingCase) {
      return {
        statusCode: 200,
        alreadyCaptured: true,
        checkout,
        order: existingOrder,
        case: existingCase,
        customerAccessLink: `/portal/${existingCase.customerAccessToken}`,
        isSimulated: checkout.isSimulated,
      };
    }
  }

  if (checkout.status === 'CANCELLED') {
    return {
      statusCode: 409,
      error: 'Checkout session was cancelled by the buyer and cannot be captured.',
      checkout,
    };
  }

  if (checkout.status === 'EXPIRED' || new Date(checkout.expiresAt).getTime() < Date.now()) {
    checkout.status = 'EXPIRED';
    checkout.failureReason = 'Pending checkout session expired prior to capture.';
    checkout.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(checkout);
    }
    db.scheduleSave();
    return {
      statusCode: 410,
      error: 'Checkout session has expired. Please start a new checkout order.',
      checkout,
    };
  }

  const product = DEMO_CATALOG[checkout.productType];
  if (!product) {
    return {
      statusCode: 400,
      error: `Unknown product catalog item '${checkout.productType}'.`,
      checkout,
    };
  }

  let captureResult;
  try {
    captureResult = await paypalGateway.captureOrder(checkout.paypalOrderId, {
      amount: checkout.grossAmount,
      currency: checkout.currency,
    });
  } catch (err: any) {
    checkout.status = 'FAILED';
    checkout.failureReason = err.message || 'PayPal capture request failed';
    checkout.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(checkout);
    }
    db.scheduleSave();
    return {
      statusCode: 422,
      error: checkout.failureReason,
      checkout,
    };
  }

  // Strictly reject non-COMPLETED captures before creating Order or Case
  if (captureResult.status !== 'COMPLETED') {
    checkout.status = 'FAILED';
    checkout.failureReason = `PayPal capture did not complete (status: ${captureResult.status}). Order and dispute case were not created.`;
    checkout.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(checkout);
    }
    db.scheduleSave();
    return {
      statusCode: captureResult.status === 'PENDING' ? 409 : 422,
      error: checkout.failureReason,
      checkout,
    };
  }

  // Validate capture ID, exact amount (integer cents), and currency
  const expectedCents = toCents(checkout.grossAmount);
  const capturedCents = toCents(captureResult.grossAmount);
  if (
    !captureResult.captureId ||
    !Number.isFinite(capturedCents) ||
    capturedCents !== expectedCents ||
    (captureResult.currency || '').toUpperCase() !== checkout.currency.toUpperCase()
  ) {
    checkout.status = 'FAILED';
    checkout.failureReason = `PayPal capture verification failed: expected ${checkout.grossAmount.toFixed(2)} ${checkout.currency}, got ${captureResult.grossAmount} ${captureResult.currency}.`;
    checkout.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(checkout);
    }
    db.scheduleSave();
    return {
      statusCode: 422,
      error: checkout.failureReason,
      checkout,
    };
  }

  const nowIso = new Date().toISOString();
  const orderId = `ord-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex')}`;
  const newOrder: any = {
    id: orderId,
    tenantId: checkout.tenantId,
    paypalOrderId: checkout.paypalOrderId,
    paypalCaptureId: captureResult.captureId,
    orderNumber: checkout.orderNumber,
    buyerName: buyerName || checkout.buyerName || 'Sandbox Test Customer',
    buyerEmail: buyerEmail || checkout.buyerEmail || captureResult.payerEmail || 'customer.test@example.com',
    transactionDate: nowIso,
    currency: checkout.currency,
    grossAmount: checkout.grossAmount,
    shippingAmount: checkout.shippingAmount,
    refundedAmount: 0.0,
    refundableAmount: checkout.grossAmount,
    items: [
      {
        id: `item-${Date.now()}`,
        sku: product.sku,
        name: product.name,
        quantity: 1,
        unitPrice: product.unitPrice,
        totalPrice: product.unitPrice,
      },
    ],
    shippingCarrier: 'FedEx Express (Simulated Demo Tracking)',
    trackingNumber: `SIM-TRK-${Math.floor(10000000 + Math.random() * 90000000)}`,
    trackingSynthetic: true,
    deliveryDate: nowIso,
    status: 'COMPLETED',
    isSimulated: captureResult.isSimulated,
  };

  db.orders[newOrder.id] = newOrder;

  const customerToken = `tok_${crypto.randomBytes(16).toString('hex')}`;
  const caseId = `case-${Date.now().toString().slice(-5)}-${crypto.randomBytes(2).toString('hex')}`;
  const caseNumber = `FR-2026-${String(Object.keys(db.cases).length + 1).padStart(3, '0')}`;

  const newCase: any = {
    id: caseId,
    tenantId: checkout.tenantId,
    caseNumber,
    orderId: newOrder.id,
    orderNumber: newOrder.orderNumber,
    paypalOrderId: newOrder.paypalOrderId,
    paypalCaptureId: newOrder.paypalCaptureId,
    customerName: newOrder.buyerName,
    customerEmail: newOrder.buyerEmail,
    status: 'NEW',
    issueType: 'damaged_item',
    requestedResolution: 'full_refund',
    customerDescription: 'Transaction completed. Ready for customer claim or merchant investigation.',
    customerAccessToken: customerToken,
    tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    evidence: [],
    refundAttempts: [],
    timeline: [
      {
        id: `ev-log-${Date.now()}`,
        caseId,
        eventType: 'CASE_CREATED',
        actor: { type: 'SYSTEM', name: captureResult.isSimulated ? 'PayPal Simulated Checkout' : 'PayPal Sandbox Checkout' },
        summary: `Verified PayPal checkout capture completed. Capture ID: ${newOrder.paypalCaptureId}`,
        details: { isSimulated: captureResult.isSimulated, checkoutId: checkout.id },
        timestamp: nowIso,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  db.cases[newCase.id] = newCase;

  checkout.status = 'CAPTURED';
  checkout.capturedOrderId = newOrder.id;
  checkout.capturedCaseId = newCase.id;
  checkout.capturedAt = nowIso;
  checkout.updatedAt = nowIso;
  checkout.isSimulated = captureResult.isSimulated;

  if (db.isPostgresActive()) {
    try {
      await db.saveOrderPg(newOrder);
      await db.saveCasePg(newCase);
      await db.saveCustomerAccessTokenPg(newCase.id, customerToken, newCase.tokenExpiresAt);
      await db.savePendingCheckoutPg(checkout);
    } catch (dbErr: any) {
      console.error('[Checkout] Failed to persist order/case to PostgreSQL:', dbErr.message);
      return {
        statusCode: 500,
        error: `Database persistence failed: ${dbErr.message}`,
        checkout,
      };
    }
  }

  db.scheduleSave();

  return {
    statusCode: 200,
    alreadyCaptured: false,
    checkout,
    order: newOrder,
    case: newCase,
    customerAccessLink: `/portal/${customerToken}`,
    isSimulated: captureResult.isSimulated,
  };
}

// Create PayPal Order for Buyer Approval (Step 1)
app.post('/api/v1/paypal/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { productType, buyerName, buyerEmail } = req.body;
  if (!productType || !(productType in DEMO_CATALOG)) {
    return res.status(400).json({
      error: `Invalid productType '${productType}'. Allowed: ${Object.keys(DEMO_CATALOG).join(', ')}`,
    });
  }

  const typedProductKey = productType as keyof typeof DEMO_CATALOG;
  const product = DEMO_CATALOG[typedProductKey];
  const grossCents = toCents(product.unitPrice) + toCents(product.shipping);
  const grossAmount = toDollars(grossCents);
  const orderNumber = `APX-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const checkoutState = crypto.randomBytes(24).toString('hex');
  const stateTokenHash = crypto.createHash('sha256').update(checkoutState).digest('hex');

  const returnUrl = `${config.APP_BASE_URL}/api/v1/paypal/checkout/return?checkoutState=${checkoutState}`;
  const cancelUrl = `${config.APP_BASE_URL}/api/v1/paypal/checkout/cancel?checkoutState=${checkoutState}`;

  try {
    const result = await paypalGateway.createOrder({
      amount: grossAmount,
      currency: 'USD',
      orderNumber,
      items: [{ name: product.name, sku: product.sku, unitPrice: product.unitPrice, quantity: 1 }],
      shippingAmount: product.shipping,
      returnUrl,
      cancelUrl,
    });

    const nowIso = new Date().toISOString();
    const pendingCheckout: PendingCheckout = {
      id: `chk-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: req.tenantId!,
      createdBy: req.user?.id || 'system',
      paypalOrderId: result.orderId,
      orderNumber,
      productType: typedProductKey,
      productSku: product.sku,
      productName: product.name,
      quantity: 1,
      unitPrice: product.unitPrice,
      unitPriceCents: toCents(product.unitPrice),
      shippingAmount: product.shipping,
      shippingAmountCents: toCents(product.shipping),
      grossAmount,
      grossAmountCents: grossCents,
      currency: 'USD',
      buyerName: typeof buyerName === 'string' && buyerName.trim() ? buyerName.trim() : undefined,
      buyerEmail: typeof buyerEmail === 'string' && buyerEmail.trim() ? buyerEmail.trim() : undefined,
      stateTokenHash,
      approveUrl: result.approveUrl,
      isSimulated: result.isSimulated,
      status: 'PENDING',
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    db.pendingCheckouts[pendingCheckout.id] = pendingCheckout;
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(pendingCheckout);
    }
    db.scheduleSave();

    res.json({
      checkoutId: pendingCheckout.id,
      orderId: result.orderId,
      approveUrl: result.approveUrl,
      orderNumber,
      grossAmount,
      unitPrice: product.unitPrice,
      shippingAmount: product.shipping,
      currency: 'USD',
      product,
      checkoutState,
      isSimulated: result.isSimulated,
      payloadPreview: result.payloadPreview,
      expiresAt: pendingCheckout.expiresAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to initialize PayPal order' });
  }
});

// Capture PayPal Order after Buyer Approves (Step 2)
app.post('/api/v1/paypal/orders/:id/capture', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const paypalOrderId = req.params.id;
  const { buyerName, buyerEmail } = req.body;
  const tenantId = req.tenantId!;

  const pendingCheckout = await db.getPendingCheckoutByPayPalOrderId(paypalOrderId);
  if (!pendingCheckout) {
    return res.status(404).json({
      error: `Pending checkout for PayPal order '${paypalOrderId}' not found. Initiate checkout via POST /api/v1/paypal/orders first.`,
    });
  }

  if (pendingCheckout.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Access denied: Pending checkout belongs to a different tenant.' });
  }

  const finalized = await finalizePendingCheckoutCapture({
    checkout: pendingCheckout,
    buyerName,
    buyerEmail,
  });

  if (finalized.error) {
    return res.status(finalized.statusCode).json({
      error: finalized.error,
      checkout: sanitizeCheckoutResponse(finalized.checkout),
    });
  }

  return res.json({
    success: true,
    alreadyCaptured: Boolean(finalized.alreadyCaptured),
    checkout: sanitizeCheckoutResponse(finalized.checkout),
    order: finalized.order,
    case: finalized.case,
    customerAccessLink: finalized.customerAccessLink,
    isSimulated: finalized.isSimulated,
  });
});

// PayPal Return Redirect Callback (authorizes capture via single-use checkoutState token)
app.get('/api/v1/paypal/checkout/return', async (req, res) => {
  const checkoutState = typeof req.query.checkoutState === 'string' ? req.query.checkoutState.trim() : '';
  const paypalToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';

  if (!checkoutState) {
    return res.redirect(302, '/?tab=checkout&checkoutStatus=error&message=' + encodeURIComponent('Missing checkoutState token.'));
  }

  const pendingCheckout = await db.getPendingCheckoutByStateToken(checkoutState);
  if (!pendingCheckout) {
    return res.redirect(302, '/?tab=checkout&checkoutStatus=error&message=' + encodeURIComponent('Checkout state is invalid or unknown.'));
  }

  if (paypalToken && paypalToken !== pendingCheckout.paypalOrderId) {
    return res.redirect(
      302,
      `/?tab=checkout&checkoutStatus=error&checkoutId=${encodeURIComponent(pendingCheckout.id)}&message=${encodeURIComponent('PayPal order token mismatch.')}`
    );
  }

  if (pendingCheckout.status === 'CAPTURED') {
    return res.redirect(
      302,
      `/?tab=checkout&checkoutStatus=captured&checkoutId=${encodeURIComponent(pendingCheckout.id)}&replayed=true`
    );
  }

  if (pendingCheckout.status === 'CANCELLED') {
    return res.redirect(
      302,
      `/?tab=checkout&checkoutStatus=cancelled&checkoutId=${encodeURIComponent(pendingCheckout.id)}`
    );
  }

  const finalized = await finalizePendingCheckoutCapture({ checkout: pendingCheckout });
  if (finalized.error) {
    const statusParam = finalized.checkout.status === 'EXPIRED' ? 'expired' : 'error';
    return res.redirect(
      302,
      `/?tab=checkout&checkoutStatus=${statusParam}&checkoutId=${encodeURIComponent(pendingCheckout.id)}&message=${encodeURIComponent(finalized.error)}`
    );
  }

  return res.redirect(
    302,
    `/?tab=checkout&checkoutStatus=captured&checkoutId=${encodeURIComponent(pendingCheckout.id)}`
  );
});

// PayPal Cancel Redirect Callback
app.get('/api/v1/paypal/checkout/cancel', async (req, res) => {
  const checkoutState = typeof req.query.checkoutState === 'string' ? req.query.checkoutState.trim() : '';
  if (!checkoutState) {
    return res.redirect(302, '/?tab=checkout&checkoutStatus=cancelled');
  }

  const pendingCheckout = await db.getPendingCheckoutByStateToken(checkoutState);
  if (pendingCheckout && pendingCheckout.status === 'PENDING') {
    pendingCheckout.status = 'CANCELLED';
    pendingCheckout.updatedAt = new Date().toISOString();
    if (db.isPostgresActive()) {
      await db.savePendingCheckoutPg(pendingCheckout);
    }
    db.scheduleSave();
  }

  const idParam = pendingCheckout ? `&checkoutId=${encodeURIComponent(pendingCheckout.id)}` : '';
  return res.redirect(302, `/?tab=checkout&checkoutStatus=cancelled${idParam}`);
});

// Fetch verified Checkout/Order/Case result for UI after return redirect
app.get('/api/v1/paypal/checkouts/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const lookup = req.params.id;
  let pendingCheckout =
    db.pendingCheckouts[lookup] ||
    (await db.getPendingCheckoutByPayPalOrderId(lookup));

  if (!pendingCheckout && db.isPostgresActive() && db.getPgPool()) {
    try {
      const result = await db.getPgPool()!.query('SELECT * FROM pending_checkouts WHERE id = $1 LIMIT 1', [lookup]);
      if (result.rows.length > 0) {
        const r = result.rows[0];
        pendingCheckout = {
          id: r.id,
          tenantId: r.tenant_id,
          createdBy: r.created_by || 'system',
          paypalOrderId: r.paypal_order_id,
          orderNumber: r.order_number,
          productType: r.product_type,
          productSku: r.product_sku || '',
          productName: r.product_name,
          quantity: Number(r.quantity || 1),
          unitPrice: Number(r.unit_price_cents) / 100,
          unitPriceCents: Number(r.unit_price_cents),
          shippingAmount: Number(r.shipping_amount_cents) / 100,
          shippingAmountCents: Number(r.shipping_amount_cents),
          grossAmount: Number(r.gross_amount_cents) / 100,
          grossAmountCents: Number(r.gross_amount_cents),
          currency: r.currency,
          buyerName: r.buyer_name || undefined,
          buyerEmail: r.buyer_email || undefined,
          stateTokenHash: r.state_token_hash,
          approveUrl: r.approve_url || undefined,
          isSimulated: Boolean(r.is_simulated),
          status: r.status,
          capturedOrderId: r.captured_order_id || undefined,
          capturedCaseId: r.captured_case_id || undefined,
          failureReason: r.failure_reason || undefined,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
          expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : new Date().toISOString(),
          capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : undefined,
        };
        db.pendingCheckouts[pendingCheckout.id] = pendingCheckout;
      }
    } catch {
      // Ignore PG lookup errors and fall through to 404
    }
  }

  if (!pendingCheckout || pendingCheckout.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Checkout record not found' });
  }

  const order = pendingCheckout.capturedOrderId ? db.orders[pendingCheckout.capturedOrderId] : undefined;
  const c = pendingCheckout.capturedCaseId ? db.cases[pendingCheckout.capturedCaseId] : undefined;

  return res.json({
    checkout: sanitizeCheckoutResponse(pendingCheckout),
    order,
    case: c,
    customerAccessLink: c?.customerAccessToken ? `/portal/${c.customerAccessToken}` : undefined,
  });
});

// Deprecated single-step demo checkout route (enforcing genuine 2-step buyer approval)
app.post('/api/v1/orders/checkout-demo', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.status(410).json({
    error:
      'Legacy single-step checkout is deprecated and removed for fintech security compliance. Please use the official two-step buyer authorization flow: POST /api/v1/paypal/orders followed by POST /api/v1/paypal/orders/:id/capture.',
  });
});

// -------------------------------------------------------------
// PUBLIC CUSTOMER COMPLAINT PORTAL
// -------------------------------------------------------------

app.get('/api/v1/customer/case/:token', (req, res) => {
  const token = req.params.token;
  const c = Object.values(db.cases).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid dispute link' });
  }

  // Token expiration check
  if (new Date(c.tokenExpiresAt).getTime() < Date.now()) {
    return res.status(403).json({ error: 'This dispute link has expired. Please contact the merchant.' });
  }

  const order = db.orders[c.orderId];
  const tenant = db.tenants[c.tenantId];

  res.json({
    caseNumber: c.caseNumber,
    caseId: c.id,
    orderNumber: c.orderNumber,
    merchantName: tenant?.name || 'FairResolve Merchant',
    customerName: c.customerName,
    items: order?.items || [],
    grossAmount: order?.grossAmount || 0,
    currency: order?.currency || 'USD',
    status: c.status,
    customerDescription: c.customerDescription,
    issueType: c.issueType,
    requestedResolution: c.requestedResolution,
    evidenceCount: c.evidence.length,
  });
});

app.post('/api/v1/customer/case/:token/submit', uploadLimiter, async (req, res) => {
  const token = req.params.token;
  const { issueType, description, requestedResolution, uploadedFiles } = req.body;

  const c = Object.values(db.cases).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid dispute link' });
  }

  if (new Date(c.tokenExpiresAt).getTime() < Date.now()) {
    return res.status(403).json({ error: 'This dispute link has expired.' });
  }

  const order = db.orders[c.orderId];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  c.issueType = issueType || c.issueType;
  c.customerDescription = description || c.customerDescription;
  c.requestedResolution = requestedResolution || c.requestedResolution;
  c.status = 'ANALYZING';
  c.updatedAt = new Date().toISOString();

  const uploadedEvidences: any[] = [];
  if (Array.isArray(uploadedFiles)) {
    for (const f of uploadedFiles) {
      if (f.fileBase64 && f.filename) {
        try {
          const buf = Buffer.from(f.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
          const uploaded = await evidenceProcessor.processUpload(
            c.id,
            f.filename,
            buf,
            f.evidenceType || 'item_photo',
            f.caption
          );
          c.evidence.push(uploaded.evidence);
          uploadedEvidences.push(uploaded.evidence);
        } catch (e: any) {
          c.status = c.evidence.length > 0 ? 'READY_FOR_REVIEW' : 'NEW';
          return res.status(400).json({ error: e.message || 'Evidence processing failed for customer portal upload' });
        }
      }
    }
  }

  const tenantPolicies = db.policies[c.tenantId] || [];
  const policy = tenantPolicies[tenantPolicies.length - 1];

  const imagesBase64 = c.evidence
    .filter((e) => e.thumbnailBase64 && e.thumbnailBase64.includes('base64,'))
    .map((e) => ({
      mimeType: e.mimeType,
      data: e.thumbnailBase64!.split('base64,')[1],
      filename: e.originalFilename,
    }));

  try {
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
    } else {
      c.status = 'READY_FOR_REVIEW';
    }
  } catch (err) {
    c.status = 'READY_FOR_REVIEW';
  }

  const submitEvent: CaseEvent = {
    id: `ev-log-${Date.now()}`,
    caseId: c.id,
    eventType: 'CUSTOMER_CONTACTED',
    actor: { type: 'CUSTOMER', name: c.customerName },
    summary: `Customer submitted dispute form: ${c.issueType}. Request: ${c.requestedResolution}`,
    timestamp: new Date().toISOString(),
  };
  c.timeline.push(submitEvent);
  db.appendAuditEvent(submitEvent);

  if (db.isPostgresActive()) {
    for (const ev of uploadedEvidences) {
      const storagePath = evidenceProcessor.getFilePath(ev.id) || ev.id;
      await db.saveEvidenceObjectPg(ev, c.tenantId, storagePath);
    }
    if (c.aiInvestigation) {
      await db.saveAiRunPg(c.id, c.aiInvestigation);
    }
    if (c.policyEvaluation) {
      await db.savePolicyEvaluationPg(c.id, c.policyEvaluation);
    }
    await db.saveCasePg(c);
  }

  db.scheduleSave();

  res.json({ success: true, caseId: c.id, status: c.status });
});

// -------------------------------------------------------------
// POLICY MANAGEMENT API
// -------------------------------------------------------------

app.get('/api/v1/policies', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const policies = db.policies[req.tenantId!] || [];
  res.json({ policies, activePolicy: policies[policies.length - 1] });
});

app.post(
  '/api/v1/policies/publish',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    const {
      returnWindowDays,
      requirePackagingPhotoForDamage,
      requireLabelPhotoForWrongItem,
      mandatoryReturnThreshold,
      allowPartialRefundsWithoutReturn,
      maxPartialRefundPercentage,
      description,
    } = req.body;

    const currentList = db.policies[req.tenantId!] || [];
    const nextVer = `v2.${currentList.length + 1}`;

    const newPolicy = {
      version: nextVer,
      publishedAt: new Date().toISOString(),
      returnWindowDays: parseInt(returnWindowDays, 10) || 30,
      requirePackagingPhotoForDamage: Boolean(requirePackagingPhotoForDamage),
      requireLabelPhotoForWrongItem: Boolean(requireLabelPhotoForWrongItem),
      carrierDeliveryVerificationDays: 3,
      maxInstantRefundAmount: 250,
      mandatoryReturnThreshold: parseFloat(mandatoryReturnThreshold) || 200,
      allowPartialRefundsWithoutReturn: Boolean(allowPartialRefundsWithoutReturn),
      maxPartialRefundPercentage: parseInt(maxPartialRefundPercentage, 10) || 50,
      flagDuplicateEvidenceHash: true,
      description: description || `Policy ${nextVer} published by ${req.user!.name}`,
    };

    currentList.push(newPolicy);
    db.policies[req.tenantId!] = currentList;
    if (db.isPostgresActive()) {
      await db.savePolicyPg(req.tenantId!, newPolicy);
    }
    db.scheduleSave();

    res.json({ success: true, policy: newPolicy });
  }
);

// -------------------------------------------------------------
// PAYPAL INTEGRATION & WEBHOOKS
// -------------------------------------------------------------

app.get('/api/v1/paypal/status', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  const status = db.getGatewayStatus();
  res.json(status);
});

app.post('/api/v1/paypal/verify', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const verifyResult = await paypalGateway.verifyCredentials();
  const status = db.getGatewayStatus();
  return res.json({
    success: verifyResult.success,
    isConfigured: paypalGateway.isConfigured(),
    verificationStatus: verifyResult.status,
    message: verifyResult.message,
    gatewayStatus: status,
  });
});

// PayPal Webhooks endpoint with cryptographic signature verification
app.post('/api/v1/webhooks/paypal', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Malformed PayPal webhook JSON payload' });
  }

  const eventId = req.body.id;
  const eventType = req.body.event_type;
  if (!eventId || typeof eventId !== 'string' || !eventType || typeof eventType !== 'string') {
    return res.status(400).json({ error: 'Missing required PayPal webhook fields (id, event_type)' });
  }

  const webhookId = config.PAYPAL_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID || '';
  if (
    !paypalGateway.isConfigured() ||
    !webhookId ||
    webhookId === 'WH-SANDBOX-DEFAULT' ||
    webhookId === 'UNCONFIGURED' ||
    webhookId.includes('your-')
  ) {
    return res.status(503).json({
      error: 'PayPal Webhook verification is unconfigured. Provide valid PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID.',
      configured: false,
    });
  }

  // Deduplication: A repeated event ID must not be processed twice
  if (db.isWebhookProcessed(eventId)) {
    return res.status(200).json({ received: true, status: 'already_processed' });
  }

  const authAlgo = req.headers['paypal-auth-algo'] as string;
  const certUrl = req.headers['paypal-cert-url'] as string;
  const transmissionId = req.headers['paypal-transmission-id'] as string;
  const transmissionSig = req.headers['paypal-transmission-sig'] as string;
  const transmissionTime = req.headers['paypal-transmission-time'] as string;

  const isValid = await paypalGateway.verifyWebhookSignature({
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime,
    webhookId,
    webhookEvent: req.body,
  });

  if (!isValid) {
    console.warn(`[Webhook] Rejected untrusted PayPal webhook signature for event ${eventId}`);
    return res.status(400).json({ error: 'Invalid PayPal webhook signature' });
  }

  db.markWebhookProcessed(eventId);
  if (db.isPostgresActive()) {
    await db.persistWebhookEventPg({
      eventId,
      eventType,
      resourceType: req.body?.resource_type,
      resourceId: req.body?.resource?.id,
      summary: req.body?.summary,
      verificationStatus: 'VERIFIED',
      rawPayload: req.body,
      processed: true,
    });
  }

  // Enqueue webhook for durable processing
  await backgroundWorker.enqueue({
    eventType: 'PAYPAL_WEBHOOK_EVENT',
    tenantId: 'system',
    payload: {
      webhookEventId: eventId,
      webhookEventType: eventType,
      resource: req.body.resource,
    },
  });

  res.status(200).json({ received: true });
});

// -------------------------------------------------------------
// AUDIT LEDGER API (Cryptographic SHA-256 Verification)
// -------------------------------------------------------------

app.get('/api/v1/audit/events', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId!;
  const tenantCaseIds = new Set(
    Object.values(db.cases)
      .filter((c) => c.tenantId === tenantId)
      .map((c) => c.id)
  );

  const allEvents = db.auditEvents.filter((ev) => tenantCaseIds.has(ev.caseId));
  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({ events: allEvents.slice(0, 100), total: allEvents.length });
});

app.get('/api/v1/audit/verify', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  const verification = db.verifyAuditChainIntegrity();
  res.json(verification);
});

// -------------------------------------------------------------
// VITE DEV SERVER INTEGRATION & LIFECYCLE
// -------------------------------------------------------------

async function startServer() {
  try {
    await db.waitForReady();
    console.log('[Server] Database initialization verified and ready.');
  } catch (err: any) {
    console.error('[Server] FATAL: Database initialization failed during startup:', err.message);
    process.exit(1);
  }

  // Start background worker only if not running standalone worker process
  if (process.env.SERVICE_TYPE !== 'worker' && config.RUN_IN_PROCESS_WORKER) {
    backgroundWorker.start();
  }

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FairResolve Platform active on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown handling
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down FairResolve gracefully...`);
    try {
      await backgroundWorker.stopAndWait();
      await new Promise<void>((resolve) => {
        const forceTimer = setTimeout(() => resolve(), 8000);
        server.close(() => {
          clearTimeout(forceTimer);
          resolve();
        });
      });
      await db.flush();
      await db.closePool();
    } catch (err: any) {
      console.error('Error during graceful shutdown:', err.message);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Ensure unknown /api/* returns JSON 404 even when imported directly in tests without startServer()
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app };
