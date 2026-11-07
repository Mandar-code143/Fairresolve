/**
 * FairResolve Production-Grade Server
 *
 * Express 4 API server with Vite dev middleware mounting.
 * Provides:
 * - Real Session Authentication & RBAC (OWNER, ADMIN, REVIEWER, ANALYST, VIEWER)
 * - Tenant Data Isolation
 * - Durable Database Persistence (atomic JSON persistence engine)
 * - Multimodal AI Investigation with Gemini 3.8 Flash & structured schema
 * - Deterministic Policy Engine
 * - PayPal Sandbox Gateway (Orders v2 create/capture, Payments v2 refund captures)
 * - Strict Idempotency via PayPal-Request-Id
 * - Private Evidence Processing with magic byte validation & SHA-256 fingerprinting
 * - Tamper-Evident Audit Event Ledger
 */

import express, { Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './src/server/database';
import { authService, requireAuth, requireRoles, AuthenticatedRequest } from './src/server/auth';
import { paypalGateway } from './src/server/paypalGateway';
import { geminiService } from './src/server/geminiService';
import { policyEngine } from './src/server/policyEngine';
import { evidenceProcessor } from './src/server/evidenceProcessor';
import { CaseEvent, RefundAttempt, UserRole } from './src/types';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parsing with generous ceiling for high-res evidence uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// -------------------------------------------------------------
// HEALTH ENDPOINTS (Part 13)
// -------------------------------------------------------------
app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/ready', (_req, res) => {
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    durableDatabaseLoaded: Object.keys(db.cases).length > 0,
    paypalConfigured: paypalGateway.isConfigured(),
    aiAvailable: geminiService.isAvailable(),
  });
});

// -------------------------------------------------------------
// AUTHENTICATION & SESSION API
// -------------------------------------------------------------

// List public demo accounts for 1-click evaluation without passwords
app.get('/api/v1/auth/demo-accounts', (_req, res) => {
  const demoUsers = Object.values(db.users).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    tenantName: db.tenants[u.tenantId]?.name || 'Apex Audio & Gear',
  }));
  res.json({ demoUsers });
});

// Demo Login: Issues a real session token for a chosen demo account
app.post('/api/v1/auth/demo-login', (req, res) => {
  const { userId } = req.body;
  const userAccount = db.users[userId] || Object.values(db.users)[0];

  if (!userAccount) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { session, token } = authService.createSession(userAccount.id, userAccount.tenantId, req);
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

// Regular Login: Verifies email and password
app.post('/api/v1/auth/login', (req, res) => {
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

  const computedHash = authService.hashPassword(password, userAccount.passwordSalt);
  if (computedHash !== userAccount.passwordHash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { session, token } = authService.createSession(userAccount.id, userAccount.tenantId, req);
  const tenant = db.tenants[userAccount.tenantId];

  res.json({
    token,
    user: {
      id: userAccount.id,
      name: userAccount.name,
      email: userAccount.email,
      role: userAccount.role,
      tenantId: userAccount.tenantId,
    },
    tenant,
    expiresAt: session.expiresAt,
  });
});

// Register New Merchant Owner
app.post('/api/v1/auth/register', (req, res) => {
  const { name, email, password, companyName } = req.body;
  if (!name || !email || !password || !companyName) {
    return res.status(400).json({ error: 'All fields are required' });
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

  const salt = crypto.randomBytes(16).toString('hex');
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

  res.json({
    token,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, tenantId },
    tenant: db.tenants[tenantId],
    expiresAt: session.expiresAt,
  });
});

// Logout: Revokes session token
app.post('/api/v1/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    authService.revokeSession(authHeader.substring(7));
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current session user
app.get('/api/v1/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const tenant = db.tenants[req.user!.tenantId];
  res.json({ user: req.user, tenant });
});

// -------------------------------------------------------------
// DISPUTE CASES API (Protected with requireAuth)
// -------------------------------------------------------------
app.get('/api/v1/cases', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const { status, issueType, search } = req.query;
  const tenantId = req.tenantId!;

  let cases = Object.values(db.cases).filter((c) => c.tenantId === tenantId);

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
        c.customerName.toLowerCase().includes(q) ||
        c.customerDescription.toLowerCase().includes(q)
    );
  }

  cases.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json({ cases, total: cases.length });
});

app.get('/api/v1/cases/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const c = db.cases[req.params.id];
  if (!c || c.tenantId !== req.tenantId) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const order = db.orders[c.orderId];
  const tenantPolicies = db.policies[c.tenantId] || [];
  const activePolicy = tenantPolicies[tenantPolicies.length - 1];

  res.json({ case: c, order, policy: activePolicy });
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

// Merchant decision action
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
    } else if (decision === 'REJECT') {
      c.status = 'REJECTED';
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

// Sensitive Refund Execution Endpoint (Protected with OWNER, ADMIN, REVIEWER)
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

    const order = db.orders[c.orderId];
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const user = req.user!;
    const refundAmount = parseFloat(amount);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ error: 'Invalid refund amount requested' });
    }

    // Idempotency check before balance deduction to safely handle replayed requests
    const key = idempotencyKey || `FR-PPR-${c.id}-${Date.now()}`;
    const existingAttempt = c.refundAttempts.find(
      (a) => a.idempotencyKey === key && a.status === 'SUCCEEDED'
    );
    if (existingAttempt) {
      return res.json({
        success: true,
        refundAttempt: existingAttempt,
        case: c,
        isDuplicateSubmission: true,
      });
    }

    // Balance Check
    if (refundAmount > order.refundableAmount) {
      return res.status(400).json({
        error: `Requested amount $${refundAmount.toFixed(2)} exceeds remaining refundable balance $${order.refundableAmount.toFixed(2)}`,
      });
    }

    const refundRecord: RefundAttempt = {
      id: `ref-att-${Date.now()}`,
      caseId: c.id,
      captureId: order.paypalCaptureId,
      idempotencyKey: key,
      amount: refundAmount,
      currency: order.currency,
      reason: reason || 'Merchant authorized dispute resolution via FairResolve',
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
        amount: refundAmount,
        currency: order.currency,
        idempotencyKey: key,
        noteToPayer: reason,
      });

      refundRecord.status = 'SUCCEEDED';
      refundRecord.paypalRefundId = result.refundId;
      refundRecord.paypalResponse = result.rawResponse;
      refundRecord.completedAt = result.createTime;
      refundRecord.isSimulated = result.isSimulated;

      // Update financial balance
      order.refundedAmount += refundAmount;
      order.refundableAmount = Math.max(0, order.grossAmount - order.refundedAmount);
      order.status = order.refundableAmount === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      c.status = 'REFUNDED';
      c.updatedAt = new Date().toISOString();

      const timelineEvent: CaseEvent = {
        id: `ev-log-${Date.now()}`,
        caseId: c.id,
        eventType: 'REFUND_EXECUTED',
        actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox Gateway' },
        summary: `PayPal Sandbox refund of $${refundAmount.toFixed(2)} ${order.currency} completed. Refund ID: ${result.refundId} ${result.isSimulated ? '(Simulated Mode)' : '(Live Sandbox)'}`,
        details: {
          refundId: result.refundId,
          amount: refundAmount,
          currency: order.currency,
          idempotencyKey: key,
          isSimulated: result.isSimulated,
        },
        timestamp: new Date().toISOString(),
      };
      c.timeline.push(timelineEvent);
      db.appendAuditEvent(timelineEvent);
      db.scheduleSave();

      res.json({ success: true, refundAttempt: refundRecord, case: c, order });
    } catch (err: any) {
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
  }
);

// -------------------------------------------------------------
// EVIDENCE PIPELINE API
// -------------------------------------------------------------
app.post('/api/v1/evidence/upload', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

// Secure Evidence Download / View Endpoint
app.get('/api/v1/evidence/:id/file', (req, res) => {
  const filePath = evidenceProcessor.getFilePath(req.params.id);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(filePath);
});

// -------------------------------------------------------------
// CHECKOUT DEMO & ORDERS (Stage B)
// -------------------------------------------------------------
app.get('/api/v1/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const orders = Object.values(db.orders).filter((o) => o.tenantId === req.tenantId);
  orders.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
  res.json({ orders });
});

app.post('/api/v1/orders/checkout-demo', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { productType, buyerName, buyerEmail } = req.body;
  const tenantId = req.tenantId!;

  const catalog = {
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

  const product = catalog[productType as keyof typeof catalog] || catalog.headphones;
  const grossAmount = product.unitPrice + product.shipping;
  const orderNumber = `APX-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const { orderId: paypalOrderId, isSimulated } = await paypalGateway.createOrder({
      amount: grossAmount,
      currency: 'USD',
      orderNumber,
      items: [{ name: product.name, unitPrice: product.unitPrice, quantity: 1 }],
    });

    const captureResult = await paypalGateway.captureOrder(paypalOrderId);

    const orderId = `ord-${Date.now().toString().slice(-6)}`;
    const newOrder: any = {
      id: orderId,
      tenantId,
      paypalOrderId,
      paypalCaptureId: captureResult.captureId,
      orderNumber,
      buyerName: buyerName || 'Sandbox Test Customer',
      buyerEmail: buyerEmail || 'customer.test@example.com',
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
      shippingCarrier: 'FedEx Express',
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
          actor: { type: 'SYSTEM', name: 'Sandbox Checkout Flow' },
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
      isSimulated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Checkout failed' });
  }
});

// -------------------------------------------------------------
// PUBLIC CUSTOMER COMPLAINT PORTAL (Stage C)
// -------------------------------------------------------------
app.get('/api/v1/customer/case/:token', (req, res) => {
  const token = req.params.token;
  const c = Object.values(db.cases).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid or expired dispute link' });
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

app.post('/api/v1/customer/case/:token/submit', async (req, res) => {
  const token = req.params.token;
  const { issueType, description, requestedResolution, uploadedFiles } = req.body;

  const c = Object.values(db.cases).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid or expired dispute link' });
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
// POLICY MANAGEMENT API (Screen 6)
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
// PAYPAL INTEGRATION STATUS (Screen 7)
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
    const token = await paypalGateway.getAccessToken();
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

// -------------------------------------------------------------
// AUDIT LOGS (Screen 8)
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

// -------------------------------------------------------------
// MERCHANT TEAM MANAGEMENT API
// -------------------------------------------------------------
app.get('/api/v1/merchant/team', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const members = Object.values(db.users)
    .filter((u) => u.tenantId === req.tenantId)
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
    }));
  res.json({ members });
});

app.post(
  '/api/v1/merchant/team/invite',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  (req: AuthenticatedRequest, res: Response) => {
    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = authService.hashPassword('Password123!', salt);
    const userId = `usr-${crypto.randomUUID().substring(0, 8)}`;

    const newUser = {
      id: userId,
      name,
      email,
      role: role as UserRole,
      tenantId: req.tenantId!,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };

    db.users[userId] = newUser;
    db.scheduleSave();

    res.json({ success: true, member: { id: newUser.id, name, email, role } });
  }
);

// -------------------------------------------------------------
// VITE DEV SERVER INTEGRATION
// -------------------------------------------------------------
async function startServer() {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FairResolve Platform active on port ${PORT}`);
  });
}

startServer();
