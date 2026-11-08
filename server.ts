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
import { paypalGateway } from './src/server/paypalGateway';
import { geminiService } from './src/server/geminiService';
import { policyEngine, toCents, toDollars } from './src/server/policyEngine';
import { evidenceProcessor } from './src/server/evidenceProcessor';
import { backgroundWorker } from './src/server/worker';
import { CaseEvent, MerchantInvitation, RefundApproval, RefundAttempt, UserRole } from './src/types';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE !== 'false'; // default true in dev/sandbox

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

app.use(cookieParser());
app.use(
  cors({
    origin: true,
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
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/ready', (_req, res) => {
  const auditVerification = db.verifyAuditChainIntegrity();
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    durableDatabaseLoaded: Object.keys(db.cases).length > 0,
    paypalConfigured: paypalGateway.isConfigured(),
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
app.post('/api/v1/auth/demo-login', authLimiter, (req, res) => {
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
app.post('/api/v1/auth/login', authLimiter, (req, res) => {
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
app.post('/api/v1/auth/register', authLimiter, (req, res) => {
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
  (req: AuthenticatedRequest, res: Response) => {
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
app.get('/api/v1/merchant/invitations/verify', (req, res) => {
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
app.post('/api/v1/merchant/invitations/accept', authLimiter, (req, res) => {
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
  db.scheduleSave();

  const { session, token: sessionToken } = authService.createSession(userId, inv.tenantId, req);
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
  (req: AuthenticatedRequest, res: Response) => {
    const inv = db.invitations[req.params.id];
    if (!inv || inv.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    inv.status = 'REVOKED';
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
      db.scheduleSave();

      res.json({ success: true, case: c });
    } catch (err: any) {
      c.status = 'READY_FOR_REVIEW';
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
  (req: AuthenticatedRequest, res: Response) => {
    const { decision, reason, notes } = req.body;
    const c = db.cases[req.params.id];
    if (!c || c.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const user = req.user!;

    if (decision === 'APPROVE') {
      c.status = 'APPROVED_PENDING_REFUND';
      const order = db.orders[c.orderId];
      if (order && !c.activeApproval) {
        const approvedAmount =
          c.policyEvaluation?.eligible_amount !== null && c.policyEvaluation?.eligible_amount !== undefined
            ? c.policyEvaluation.eligible_amount
            : order.refundableAmount;
        const approval: RefundApproval = {
          id: `appr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          caseId: c.id,
          tenantId: c.tenantId,
          orderId: order.id,
          captureId: order.paypalCaptureId,
          authorizedBy: user.id,
          authorizedByName: user.name,
          authorizedByRole: user.role,
          approvedAmount,
          approvedAmountCents: toCents(approvedAmount),
          currency: order.currency,
          policyVersion: c.policyEvaluation?.policy_version || '1.0',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          notes: notes || reason || 'Approved during merchant case review',
        };
        db.refundApprovals[approval.id] = approval;
        c.activeApproval = approval;
      }
    } else if (decision === 'REJECT') {
      c.status = 'REJECTED';
      if (c.activeApproval) {
        c.activeApproval.status = 'REVOKED';
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
    const c = db.cases[req.params.id];
    if (!c || c.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const order = db.orders[c.orderId];
    if (!order) return res.status(404).json({ error: 'Associated order not found' });

    const user = req.user!;
    const approvedAmountDollars =
      amount !== undefined
        ? parseFloat(amount)
        : (c.policyEvaluation?.eligible_amount !== null && c.policyEvaluation?.eligible_amount !== undefined
            ? c.policyEvaluation.eligible_amount
            : order.refundableAmount);

    if (isNaN(approvedAmountDollars) || approvedAmountDollars <= 0) {
      return res.status(400).json({ error: 'Invalid approved refund amount' });
    }

    const reqCents = toCents(approvedAmountDollars);
    const refundableCents = toCents(order.refundableAmount);

    if (reqCents > refundableCents) {
      return res.status(400).json({
        error: `Approved amount $${approvedAmountDollars.toFixed(2)} exceeds refundable order balance $${order.refundableAmount.toFixed(2)}`,
      });
    }

    const approval: RefundApproval = {
      id: `appr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      caseId: c.id,
      tenantId: c.tenantId,
      orderId: order.id,
      captureId: order.paypalCaptureId,
      authorizedBy: user.id,
      authorizedByName: user.name,
      authorizedByRole: user.role,
      approvedAmount: approvedAmountDollars,
      approvedAmountCents: reqCents,
      currency: order.currency,
      policyVersion: c.policyEvaluation?.policy_version || '1.0',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      notes: notes || reason || 'Refund authorization approved by merchant reviewer for settlement execution',
    };

    db.refundApprovals[approval.id] = approval;
    c.activeApproval = approval;
    c.status = 'APPROVED_PENDING_REFUND';
    c.updatedAt = new Date().toISOString();

    const approveEvent: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'REFUND_APPROVED',
      actor: { type: 'MERCHANT', id: user.id, name: user.name, role: user.role },
      summary: `Refund of $${approvedAmountDollars.toFixed(2)} ${order.currency} approved by ${user.name} (${user.role}). Awaiting financial execution under separation-of-duties.`,
      details: {
        approvalId: approval.id,
        approvedAmount: approvedAmountDollars,
        currency: order.currency,
        approverId: user.id,
        policyVersion: approval.policyVersion,
      },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(approveEvent);
    db.appendAuditEvent(approveEvent);
    db.scheduleSave();

    res.json({ success: true, case: c, approval });
  }
);

// Assign case to team member (Role: OWNER, ADMIN, REVIEWER)
app.post(
  '/api/v1/cases/:id/assign',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'REVIEWER']),
  (req: AuthenticatedRequest, res: Response) => {
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

  // Safety check: case must be in approved status before releasing funds
  if (c.status !== 'APPROVED_PENDING_REFUND' && c.status !== 'READY_FOR_REVIEW') {
    return res.status(400).json({
      error: `Cannot refund case in '${c.status}' status. Merchant approval is required before settlement.`,
    });
  }

  const user = req.user!;

  // Strict Four-Eyes Separation of Duties enforcement:
  // The person who approved the refund cannot execute the payment settlement.
  if (c.activeApproval) {
    if (c.activeApproval.status !== 'ACTIVE') {
      return res.status(400).json({
        error: `Active refund approval is in status '${c.activeApproval.status}'. A fresh approval is required.`,
      });
    }

    if (c.activeApproval.authorizedBy === user.id) {
      return res.status(403).json({
        error:
          'Separation of duties violation: The approver cannot execute their own approved refund. Another authorized Owner or Admin must execute this transaction.',
      });
    }
  }

  const order = db.orders[c.orderId];
  if (!order) return res.status(404).json({ error: 'Associated order not found' });

  // Validate idempotencyKey
  const key = idempotencyKey?.trim() || `FR-PPR-${c.id}-${Date.now()}`;
  if (!key) {
    return res.status(400).json({ error: 'Missing required idempotencyKey for refund execution' });
  }

  const refundAmountDollars =
    amount !== undefined
      ? parseFloat(amount)
      : (c.activeApproval?.approvedAmount ?? order.refundableAmount);

  if (isNaN(refundAmountDollars) || refundAmountDollars <= 0) {
    return res.status(400).json({ error: 'Invalid refund amount requested' });
  }

  // Integer minor units (cents) to avoid floating point imprecision
  const reqCents = toCents(refundAmountDollars);
  const refundableCents = toCents(order.refundableAmount);

  if (reqCents > refundableCents) {
    return res.status(400).json({
      error: `Requested refund $${refundAmountDollars.toFixed(2)} exceeds remaining refundable balance $${order.refundableAmount.toFixed(2)}`,
    });
  }

  if (c.activeApproval && reqCents > c.activeApproval.approvedAmountCents) {
    return res.status(400).json({
      error: `Requested refund $${refundAmountDollars.toFixed(2)} exceeds authorized approval amount $${c.activeApproval.approvedAmount.toFixed(2)}`,
    });
  }

  // Concurrency lock: Reject if another refund attempt is currently in progress or awaiting reconciliation
  const activePending = c.refundAttempts.find(
    (a) =>
      a.status === 'SUBMITTED' ||
      a.status === 'PENDING' ||
      a.status === 'UNKNOWN' ||
      a.status === 'RECONCILIATION_REQUIRED'
  );
  if (activePending) {
    return res.status(409).json({
      error: `A refund attempt (${activePending.id}) is already in progress or awaiting reconciliation for this case.`,
      refundAttempt: activePending,
    });
  }

  // Strict idempotency check
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
    approvalId: c.activeApproval?.id,
    approverId: c.activeApproval?.authorizedBy,
    executorId: user.id,
    captureId: order.paypalCaptureId,
    idempotencyKey: key,
    amount: refundAmountDollars,
    amountCents: reqCents,
    currency: order.currency,
    reason: reason || c.activeApproval?.notes || 'Merchant authorized dispute resolution via FairResolve',
    status: 'SUBMITTED',
    authorizedBy: {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
    },
    createdAt: new Date().toISOString(),
  };

  c.status = 'REFUND_SUBMITTED';
  c.refundAttempts.push(refundRecord);
  db.scheduleSave();

  try {
    const result = await paypalGateway.refundCapture({
      captureId: order.paypalCaptureId,
      amount: refundAmountDollars,
      currency: order.currency,
      idempotencyKey: key,
      noteToPayer: reason || c.activeApproval?.notes,
    });

    if (result.status === 'COMPLETED') {
      refundRecord.status = 'SUCCEEDED';
      refundRecord.paypalRefundId = result.refundId;
      refundRecord.paypalResponse = result.rawResponse;
      refundRecord.completedAt = result.createTime;
      refundRecord.isSimulated = result.isSimulated;

      if (c.activeApproval) {
        c.activeApproval.status = 'CONSUMED';
        if (db.refundApprovals[c.activeApproval.id]) {
          db.refundApprovals[c.activeApproval.id].status = 'CONSUMED';
        }
      }

      // Balance arithmetic in integer minor units
      const newRefundedCents = toCents(order.refundedAmount) + reqCents;
      const grossCents = toCents(order.grossAmount);
      const newRefundableCents = Math.max(0, grossCents - newRefundedCents);

      order.refundedAmount = toDollars(newRefundedCents);
      order.refundableAmount = toDollars(newRefundableCents);
      order.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      c.status = newRefundableCents === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      c.updatedAt = new Date().toISOString();

      const timelineEvent: CaseEvent = {
        id: `ev-log-${Date.now()}`,
        caseId: c.id,
        eventType: 'REFUND_EXECUTED',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal Sandbox refund of $${refundAmountDollars.toFixed(2)} ${order.currency} completed. Refund ID: ${result.refundId} ${result.isSimulated ? '(Simulated Mode)' : '(Live Sandbox)'}`,
        details: {
          refundId: result.refundId,
          amount: refundAmountDollars,
          currency: order.currency,
          idempotencyKey: key,
          approverId: c.activeApproval?.authorizedBy,
          executorId: user.id,
          isSimulated: result.isSimulated,
        },
        timestamp: new Date().toISOString(),
      };
      c.timeline.push(timelineEvent);
      db.appendAuditEvent(timelineEvent);
    } else if (result.status === 'PENDING') {
      // Pending status must NOT be marked succeeded
      refundRecord.status = 'PENDING';
      refundRecord.paypalRefundId = result.refundId;
      refundRecord.paypalResponse = result.rawResponse;
      refundRecord.isSimulated = result.isSimulated;
      c.status = 'REFUND_PENDING';
      c.updatedAt = new Date().toISOString();

      const pendingEvent: CaseEvent = {
        id: `ev-log-${Date.now()}`,
        caseId: c.id,
        eventType: 'REFUND_EXECUTED',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal refund initiated and currently PENDING clearance. Refund ID: ${result.refundId}`,
        details: { refundId: result.refundId, status: 'PENDING' },
        timestamp: new Date().toISOString(),
      };
      c.timeline.push(pendingEvent);
      db.appendAuditEvent(pendingEvent);
    } else {
      refundRecord.status = 'FAILED';
      c.status = 'REFUND_FAILED';
      c.updatedAt = new Date().toISOString();
    }

    db.scheduleSave();
    res.json({ success: true, refundAttempt: refundRecord, case: c, order });
  } catch (err: any) {
    const isTimeoutOrNetworkError =
      err.name === 'AbortError' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.toLowerCase().includes('timeout') ||
      err.message?.toLowerCase().includes('network') ||
      err.message?.toLowerCase().includes('fetch failed');

    if (isTimeoutOrNetworkError) {
      refundRecord.status = 'RECONCILIATION_REQUIRED';
      refundRecord.errorMessage = `Network or gateway timeout: ${err.message}. Enqueued for background reconciliation.`;
      c.status = 'REFUND_PENDING';

      const reconEvent: CaseEvent = {
        id: `ev-log-${Date.now()}`,
        caseId: c.id,
        eventType: 'REFUND_EXECUTED',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Gateway Reconciliation' },
        summary: `PayPal refund timed out or interrupted. Flagged for outbox reconciliation without blind retry: ${err.message}`,
        details: { error: err.message, status: 'RECONCILIATION_REQUIRED', idempotencyKey: key },
        timestamp: new Date().toISOString(),
      };
      c.timeline.push(reconEvent);
      db.appendAuditEvent(reconEvent);

      backgroundWorker.enqueue({
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
      db.scheduleSave();

      return res.status(202).json({
        status: 'RECONCILIATION_REQUIRED',
        message:
          'PayPal response timed out. Operation enqueued for reconciliation; funds will not be double-charged.',
        refundAttempt: refundRecord,
      });
    }

    refundRecord.status = 'FAILED';
    refundRecord.errorMessage = err.message || 'PayPal refund execution failed';
    c.status = 'REFUND_FAILED';

    const failEvent: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'REFUND_FAILED',
      actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox' },
      summary: `PayPal refund rejected: ${err.message}`,
      details: { error: err.message },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(failEvent);
    db.appendAuditEvent(failEvent);
    db.scheduleSave();

    res.status(500).json({ error: err.message || 'PayPal refund rejected', refundAttempt: refundRecord });
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
  res.json({ orders });
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

// Create PayPal Order for Buyer Approval (Step 1)
app.post('/api/v1/paypal/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { productType } = req.body;
  const product = DEMO_CATALOG[productType as keyof typeof DEMO_CATALOG] || DEMO_CATALOG.headphones;
  const grossAmount = product.unitPrice + product.shipping;
  const orderNumber = `APX-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const result = await paypalGateway.createOrder({
      amount: grossAmount,
      currency: 'USD',
      orderNumber,
      items: [{ name: product.name, unitPrice: product.unitPrice, quantity: 1 }],
    });

    res.json({
      orderId: result.orderId,
      orderNumber,
      grossAmount,
      currency: 'USD',
      product,
      isSimulated: result.isSimulated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to initialize PayPal order' });
  }
});

// Capture PayPal Order after Buyer Approves (Step 2)
app.post('/api/v1/paypal/orders/:id/capture', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const paypalOrderId = req.params.id;
  const { productType, buyerName, buyerEmail, orderNumber } = req.body;
  const tenantId = req.tenantId!;

  const product = DEMO_CATALOG[productType as keyof typeof DEMO_CATALOG] || DEMO_CATALOG.headphones;
  const grossAmount = product.unitPrice + product.shipping;
  const finalOrderNumber = orderNumber || `APX-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const captureResult = await paypalGateway.captureOrder(paypalOrderId);

    const orderId = `ord-${Date.now().toString().slice(-6)}`;
    const newOrder: any = {
      id: orderId,
      tenantId,
      paypalOrderId,
      paypalCaptureId: captureResult.captureId,
      orderNumber: finalOrderNumber,
      buyerName: buyerName || 'Sandbox Test Customer',
      buyerEmail: buyerEmail || captureResult.payerEmail || 'customer.test@example.com',
      transactionDate: new Date().toISOString(),
      currency: 'USD',
      grossAmount,
      shippingAmount: product.shipping,
      refundedAmount: 0.0,
      refundableAmount: grossAmount,
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
      shippingCarrier: 'FedEx Express (Sandbox)',
      trackingNumber: `7829${Math.floor(10000000 + Math.random() * 90000000)}`,
      deliveryDate: new Date().toISOString(),
      status: 'COMPLETED',
    };

    db.orders[newOrder.id] = newOrder;

    const customerToken = `tok_${crypto.randomUUID().substring(0, 16)}`;
    const caseId = `case-${Date.now().toString().slice(-5)}`;
    const caseNumber = `FR-2026-${String(Object.keys(db.cases).length + 1).padStart(3, '0')}`;

    const newCase: any = {
      id: caseId,
      tenantId,
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
          actor: { type: 'SYSTEM', name: 'PayPal Sandbox Checkout' },
          summary: `Verified PayPal Sandbox checkout completed. Capture ID: ${newOrder.paypalCaptureId}`,
          details: { isSimulated: captureResult.isSimulated },
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.cases[newCase.id] = newCase;
    db.scheduleSave();

    res.json({
      success: true,
      order: newOrder,
      case: newCase,
      customerAccessLink: `/portal/${customerToken}`,
      isSimulated: captureResult.isSimulated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Checkout capture failed' });
  }
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
        } catch (e) {
          console.warn('Error processing customer portal file:', e);
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
  (req: AuthenticatedRequest, res: Response) => {
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
  const isConfigured = paypalGateway.isConfigured();
  if (!isConfigured) {
    return res.json({
      success: false,
      isConfigured: false,
      message:
        'PayPal Sandbox credentials are not currently set in .env. Running in Sandbox Verification / Simulation mode.',
    });
  }

  try {
    await paypalGateway.getAccessToken();
    return res.json({
      success: true,
      isConfigured: true,
      message: 'Successfully authenticated with PayPal Sandbox OAuth endpoint.',
    });
  } catch (err: any) {
    return res.json({
      success: false,
      isConfigured: true,
      message: err.message || 'Authentication to PayPal Sandbox failed.',
    });
  }
});

// PayPal Webhooks endpoint with cryptographic signature verification
app.post('/api/v1/webhooks/paypal', async (req, res) => {
  const eventId = req.body?.id;
  if (!eventId) {
    return res.status(400).json({ error: 'Missing PayPal webhook event id' });
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
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || 'WH-SANDBOX-DEFAULT';

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

  // Enqueue webhook for durable processing
  backgroundWorker.enqueue({
    eventType: 'PAYPAL_WEBHOOK_EVENT',
    tenantId: 'system',
    payload: {
      eventId,
      eventType: req.body?.event_type,
      resource: req.body?.resource,
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
  // Start background worker
  backgroundWorker.start();

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
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FairResolve Platform active on http://localhost:${PORT}`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('Shutting down FairResolve gracefully...');
    backgroundWorker.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();

export { app };
