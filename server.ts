/**
 * FairResolve Full-Stack Server
 * Express 4 API server with Vite dev middleware mounting.
 * Provides complete fintech dispute investigation, deterministic policy engine,
 * multimodal AI service, PayPal Sandbox integration, and compliance audit trail.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { store } from './src/server/store';
import { paypalGateway } from './src/server/paypalGateway';
import { geminiService } from './src/server/geminiService';
import { policyEngine } from './src/server/policyEngine';
import { evidenceProcessor } from './src/server/evidenceProcessor';
import { CaseEvent, RefundAttempt, UserRole } from './src/types';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parsing with generous limit for image uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Simulated session user (defaults to Sarah Lin - OWNER)
let currentUserId = 'usr-01';

const getSessionUser = () => {
  return store.users.get(currentUserId) || Array.from(store.users.values())[0];
};

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
    storeLoaded: store.cases.size > 0,
    paypalConfigured: paypalGateway.isConfigured(),
  });
});

// -------------------------------------------------------------
// AUTH & TENANT API
// -------------------------------------------------------------
app.get('/api/v1/auth/me', (_req, res) => {
  const user = getSessionUser();
  const tenant = store.tenants.get(user.tenantId);
  res.json({ user, tenant });
});

app.post('/api/v1/auth/switch-role', (req, res) => {
  const { role } = req.body;
  const validRoles: UserRole[] = ['OWNER', 'ADMIN', 'REVIEWER', 'ANALYST', 'VIEWER'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid user role specified' });
  }

  const targetUser = Array.from(store.users.values()).find((u) => u.role === role);
  if (targetUser) {
    currentUserId = targetUser.id;
    return res.json({ success: true, user: targetUser });
  }

  // Update existing user role if not found
  const user = getSessionUser();
  user.role = role;
  res.json({ success: true, user });
});

// -------------------------------------------------------------
// DISPUTE CASES API
// -------------------------------------------------------------
app.get('/api/v1/cases', (req, res) => {
  const { status, issueType, search } = req.query;
  let cases = Array.from(store.cases.values());

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

  // Sort by updatedAt descending
  cases.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json({ cases, total: cases.length });
});

app.get('/api/v1/cases/:id', (req, res) => {
  const c = store.cases.get(req.params.id);
  if (!c) {
    return res.status(404).json({ error: 'Case not found' });
  }

  const order = store.orders.get(c.orderId);
  const tenantPolicies = store.policies.get(c.tenantId) || [];
  const activePolicy = tenantPolicies[tenantPolicies.length - 1];

  res.json({ case: c, order, policy: activePolicy });
});

// Re-run AI investigation & policy evaluation
app.post('/api/v1/cases/:id/re-analyze', async (req, res) => {
  const c = store.cases.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const order = store.orders.get(c.orderId);
  if (!order) return res.status(404).json({ error: 'Associated order not found' });

  const tenantPolicies = store.policies.get(c.tenantId) || [];
  const policy = tenantPolicies[tenantPolicies.length - 1];

  c.status = 'ANALYZING';

  try {
    // Collect base64 images if available in evidence
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

    // Run deterministic policy evaluation
    const policyResult = policyEngine.evaluate(c, order, policy);
    c.policyEvaluation = policyResult;

    // Update status based on policy
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

    // Timeline event
    const event: CaseEvent = {
      id: `ev-log-${Date.now()}`,
      caseId: c.id,
      eventType: 'AI_INVESTIGATION_COMPLETED',
      actor: { type: 'AI_ENGINE', name: aiResult.model_used },
      summary: `AI analysis refreshed. Policy outcome: ${policyResult.result}`,
      details: { aiResult, policyResult },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(event);

    res.json({ success: true, case: c });
  } catch (err: any) {
    c.status = 'READY_FOR_REVIEW';
    res.status(500).json({ error: err.message || 'AI analysis failed' });
  }
});

// Merchant decision action (Approve, Reject, Request Info, Escalate)
app.post('/api/v1/cases/:id/review', (req, res) => {
  const { decision, reason, notes } = req.body;
  const c = store.cases.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const user = getSessionUser();

  // Role check: VIEWER cannot approve/reject
  if (user.role === 'VIEWER') {
    return res.status(403).json({ error: 'Access Denied: Viewers do not have permission to take case decisions.' });
  }

  if (decision === 'APPROVE') {
    c.status = 'APPROVED_PENDING_REFUND';
  } else if (decision === 'REJECT') {
    c.status = 'REJECTED';
  } else if (decision === 'REQUEST_INFO') {
    c.status = 'NEEDS_MORE_INFORMATION';
  } else if (decision === 'ESCALATE') {
    c.status = 'ESCALATED';
  } else {
    return res.status(400).json({ error: 'Invalid decision' });
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

  res.json({ success: true, case: c });
});

// Sensitive Refund Execution Endpoint (Part 8)
app.post('/api/v1/cases/:id/refund', async (req, res) => {
  const { amount, reason, idempotencyKey } = req.body;
  const c = store.cases.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const order = store.orders.get(c.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const user = getSessionUser();

  // RBAC Permission Check: Only OWNER, ADMIN, REVIEWER can execute refunds
  const allowedRoles: UserRole[] = ['OWNER', 'ADMIN', 'REVIEWER'];
  if (!allowedRoles.includes(user.role)) {
    return res.status(403).json({
      error: `Permission Denied: Role ${user.role} is not authorized to execute refunds. Requires OWNER, ADMIN, or REVIEWER.`,
    });
  }

  const refundAmount = parseFloat(amount);
  if (isNaN(refundAmount) || refundAmount <= 0) {
    return res.status(400).json({ error: 'Invalid refund amount requested' });
  }

  // Idempotency: Return existing refund attempt if already succeeded for this key
  const key = idempotencyKey || `PPR-REQ-${c.id}-${Date.now()}`;
  const existingAttempt = c.refundAttempts.find((a) => a.idempotencyKey === key && a.status === 'SUCCEEDED');
  if (existingAttempt) {
    return res.json({
      success: true,
      refundAttempt: existingAttempt,
      case: c,
      isDuplicateSubmission: true,
    });
  }

  // Balance Check: Refund cannot exceed remaining refundable balance
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

  try {
    // Call PayPal Gateway with idempotency header
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

    // Update financial balances
    order.refundedAmount += refundAmount;
    order.refundableAmount = Math.max(0, order.grossAmount - order.refundedAmount);
    if (order.refundableAmount === 0) {
      order.status = 'REFUNDED';
    } else {
      order.status = 'PARTIALLY_REFUNDED';
    }

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

    res.status(500).json({ error: err.message || 'PayPal refund rejected', refundAttempt: refundRecord });
  }
});

// -------------------------------------------------------------
// EVIDENCE PIPELINE API
// -------------------------------------------------------------
app.post('/api/v1/evidence/upload', async (req, res) => {
  const { caseId, filename, fileBase64, evidenceType, caption } = req.body;
  if (!caseId || !filename || !fileBase64) {
    return res.status(400).json({ error: 'Missing required upload parameters' });
  }

  const c = store.cases.get(caseId);
  if (!c) return res.status(404).json({ error: 'Case not found' });

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
      actor: { type: 'CUSTOMER', name: c.customerName },
      summary: `Uploaded evidence file: ${result.evidence.originalFilename} (${(result.evidence.byteSize / 1024).toFixed(1)} KB)${result.isDuplicate ? ' [DUPLICATE HASH ALERT]' : ''}`,
      details: {
        fileId: result.evidence.id,
        sha256Hash: result.evidence.sha256Hash,
        isDuplicate: result.isDuplicate,
      },
      timestamp: new Date().toISOString(),
    };
    c.timeline.push(timelineEvent);

    // Re-evaluate deterministic policy with the newly added evidence
    const order = store.orders.get(c.orderId);
    const tenantPolicies = store.policies.get(c.tenantId) || [];
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

    res.json({ success: true, evidence: result.evidence, isDuplicate: result.isDuplicate });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Evidence processing failed' });
  }
});

app.get('/api/v1/evidence/:id/file', (req, res) => {
  const filePath = evidenceProcessor.getFilePath(req.params.id);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  // Security headers for uploaded binary files (OWASP compliant)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');

  res.sendFile(filePath);
});

// -------------------------------------------------------------
// CHECKOUT DEMO & ORDERS (Stage B)
// -------------------------------------------------------------
app.get('/api/v1/orders', (_req, res) => {
  const orders = Array.from(store.orders.values());
  orders.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
  res.json({ orders });
});

app.post('/api/v1/orders/checkout-demo', async (req, res) => {
  const { productType, buyerName, buyerEmail } = req.body;

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
    // 1. Create PayPal Sandbox Order
    const { orderId: paypalOrderId, isSimulated } = await paypalGateway.createOrder({
      amount: grossAmount,
      currency: 'USD',
      orderNumber,
      items: [{ name: product.name, unitPrice: product.unitPrice, quantity: 1 }],
    });

    // 2. Capture PayPal Sandbox Order
    const captureResult = await paypalGateway.captureOrder(paypalOrderId);

    // 3. Store Order in FairResolve database
    const orderId = `ord-${Date.now().toString().slice(-6)}`;
    const newOrder: any = {
      id: orderId,
      tenantId: 'tenant-apex-101',
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

    store.orders.set(newOrder.id, newOrder);

    // 4. Generate customer complaint access token
    const customerToken = `tok_${crypto.randomUUID().substring(0, 16)}`;

    // Create a new case pre-populated from this checkout
    const caseId = `case-${Date.now().toString().slice(-5)}`;
    const caseNumber = `FR-2026-${String(store.cases.size + 1).padStart(3, '0')}`;
    const newCase: any = {
      id: caseId,
      tenantId: 'tenant-apex-101',
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

    store.cases.set(newCase.id, newCase);

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
// CUSTOMER COMPLAINT PORTAL (Stage C)
// -------------------------------------------------------------
app.get('/api/v1/customer/case/:token', (req, res) => {
  const token = req.params.token;
  const c = Array.from(store.cases.values()).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid or expired dispute link' });
  }

  const order = store.orders.get(c.orderId);
  const tenant = store.tenants.get(c.tenantId);

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

  const c = Array.from(store.cases.values()).find((item) => item.customerAccessToken === token);
  if (!c) {
    return res.status(404).json({ error: 'Invalid or expired dispute link' });
  }

  const order = store.orders.get(c.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  c.issueType = issueType || c.issueType;
  c.customerDescription = description || c.customerDescription;
  c.requestedResolution = requestedResolution || c.requestedResolution;
  c.status = 'ANALYZING';
  c.updatedAt = new Date().toISOString();

  // Process any uploaded files
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

  // Auto trigger AI investigation
  const tenantPolicies = store.policies.get(c.tenantId) || [];
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

  c.timeline.push({
    id: `ev-log-${Date.now()}`,
    caseId: c.id,
    eventType: 'CUSTOMER_CONTACTED',
    actor: { type: 'CUSTOMER', name: c.customerName },
    summary: `Customer submitted dispute form: ${c.issueType}. Request: ${c.requestedResolution}`,
    timestamp: new Date().toISOString(),
  });

  res.json({ success: true, caseId: c.id, status: c.status });
});

// -------------------------------------------------------------
// POLICY MANAGEMENT API (Screen 6)
// -------------------------------------------------------------
app.get('/api/v1/policies', (_req, res) => {
  const user = getSessionUser();
  const policies = store.policies.get(user.tenantId) || [];
  res.json({ policies, activePolicy: policies[policies.length - 1] });
});

app.post('/api/v1/policies/publish', (req, res) => {
  const user = getSessionUser();
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only OWNER and ADMIN can publish new policy versions.' });
  }

  const {
    returnWindowDays,
    requirePackagingPhotoForDamage,
    requireLabelPhotoForWrongItem,
    mandatoryReturnThreshold,
    allowPartialRefundsWithoutReturn,
    maxPartialRefundPercentage,
    description,
  } = req.body;

  const currentList = store.policies.get(user.tenantId) || [];
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
    description: description || `Policy ${nextVer} published by ${user.name}`,
  };

  currentList.push(newPolicy);
  store.policies.set(user.tenantId, currentList);

  res.json({ success: true, policy: newPolicy });
});

// -------------------------------------------------------------
// PAYPAL INTEGRATION STATUS (Screen 7)
// -------------------------------------------------------------
app.get('/api/v1/paypal/status', (_req, res) => {
  const status = store.getGatewayStatus();
  res.json(status);
});

app.post('/api/v1/paypal/verify', async (_req, res) => {
  const isConfigured = paypalGateway.isConfigured();
  if (!isConfigured) {
    return res.json({
      success: false,
      isConfigured: false,
      message:
        'PayPal Sandbox credentials are not currently configured in .env. Operating in Sandbox Verification / Simulation mode.',
    });
  }

  const token = await paypalGateway.getAccessToken();
  if (token) {
    return res.json({
      success: true,
      isConfigured: true,
      message: 'Successfully authenticated with PayPal Sandbox OAuth endpoint.',
    });
  } else {
    return res.json({
      success: false,
      isConfigured: true,
      message: 'Authentication to PayPal Sandbox failed. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
    });
  }
});

// -------------------------------------------------------------
// AUDIT LOGS (Screen 8)
// -------------------------------------------------------------
app.get('/api/v1/audit/events', (_req, res) => {
  const allEvents: CaseEvent[] = [];
  for (const c of store.cases.values()) {
    allEvents.push(...c.timeline);
  }

  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json({ events: allEvents.slice(0, 100), total: allEvents.length });
});

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
