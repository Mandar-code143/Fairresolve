import { describe, it, expect } from 'vitest';
import {
  policyEngine,
  toCents,
  toDollars,
  calculateBusinessDays,
} from '../../src/server/policyEngine';
import { Case, Order, RefundPolicy } from '../../src/types';

describe('PolicyEngine — Deterministic Dispute Evaluation & Minor Unit Arithmetic', () => {
  const defaultPolicy: RefundPolicy = {
    version: 'v2.1',
    publishedAt: '2026-01-01T00:00:00Z',
    returnWindowDays: 30,
    requirePackagingPhotoForDamage: true,
    requireLabelPhotoForWrongItem: true,
    carrierDeliveryVerificationDays: 3,
    maxInstantRefundAmount: 250,
    mandatoryReturnThreshold: 200,
    allowPartialRefundsWithoutReturn: true,
    maxPartialRefundPercentage: 50,
    flagDuplicateEvidenceHash: true,
    description: 'Merchant Standard Policy',
  };

  const sampleOrder: Order = {
    id: 'ord-test-01',
    tenantId: 'tenant-test',
    paypalOrderId: 'PPO-12345',
    paypalCaptureId: 'PPC-12345',
    orderNumber: 'APX-2026-0001',
    buyerName: 'Alice Buyer',
    buyerEmail: 'alice@example.com',
    transactionDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    deliveryDate: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    currency: 'USD',
    grossAmount: 149.99,
    shippingAmount: 10.0,
    refundedAmount: 0.0,
    refundableAmount: 149.99,
    items: [
      {
        id: 'item-1',
        sku: 'APX-H900',
        name: 'AuraSound Headphones',
        quantity: 1,
        unitPrice: 139.99,
        totalPrice: 139.99,
      },
    ],
    status: 'COMPLETED',
  };

  it('performs accurate minor unit (cents) conversions without float drift', () => {
    expect(toCents(149.99)).toBe(14999);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30 cents
    expect(toDollars(14999)).toBe(149.99);
    expect(toDollars(30)).toBe(0.3);
  });

  it('calculates business days accurately excluding weekends', () => {
    // Friday to Monday: exactly 1 business day (Friday -> Monday)
    const friday = new Date('2026-11-06T12:00:00Z');
    const monday = new Date('2026-11-09T12:00:00Z');
    const days = calculateBusinessDays(friday, monday);
    expect(days).toBe(1);

    // Monday to Friday: 4 business days
    const mondayStart = new Date('2026-11-02T12:00:00Z');
    const fridayEnd = new Date('2026-11-06T12:00:00Z');
    expect(calculateBusinessDays(mondayStart, fridayEnd)).toBe(4);
  });

  it('passes eligibility when claim is filed within return window with required evidence', () => {
    const disputeCase: Case = {
      id: 'case-test-01',
      tenantId: 'tenant-test',
      caseNumber: 'FR-2026-901',
      orderId: sampleOrder.id,
      orderNumber: sampleOrder.orderNumber,
      paypalOrderId: sampleOrder.paypalOrderId,
      paypalCaptureId: sampleOrder.paypalCaptureId,
      customerName: sampleOrder.buyerName,
      customerEmail: sampleOrder.buyerEmail,
      status: 'NEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Headphones arrived with broken right swivel hinge.',
      customerAccessToken: 'tok-test-01',
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      evidence: [
        {
          id: 'ev-1',
          caseId: 'case-test-01',
          originalFilename: 'damaged_headband.jpg',
          mimeType: 'image/jpeg',
          byteSize: 102400,
          sha256Hash: 'hash-unique-1234',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'unscanned',
          evidenceType: 'item_photo',
          downloadUrl: '/api/v1/evidence/ev-1/file',
        },
        {
          id: 'ev-2',
          caseId: 'case-test-01',
          originalFilename: 'shipping_carton.jpg',
          mimeType: 'image/jpeg',
          byteSize: 98000,
          sha256Hash: 'hash-unique-5678',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'unscanned',
          evidenceType: 'packaging_photo',
          downloadUrl: '/api/v1/evidence/ev-2/file',
        },
      ],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const evaluation = policyEngine.evaluate(disputeCase, sampleOrder, defaultPolicy);
    expect(evaluation.result).toBe('ELIGIBLE_FOR_MERCHANT_REVIEW');
    expect(evaluation.eligible_amount).toBe(149.99);
    expect(evaluation.missing_requirements.length).toBe(0);
  });

  it('flags duplicate evidence hash as manual review required', () => {
    const duplicateCase: Case = {
      id: 'case-test-02',
      tenantId: 'tenant-test',
      caseNumber: 'FR-2026-902',
      orderId: sampleOrder.id,
      orderNumber: sampleOrder.orderNumber,
      paypalOrderId: sampleOrder.paypalOrderId,
      paypalCaptureId: sampleOrder.paypalCaptureId,
      customerName: 'Fraudster Test',
      customerEmail: 'fraud@example.com',
      status: 'NEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Damaged item claim with re-used photo.',
      customerAccessToken: 'tok-test-02',
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      evidence: [
        {
          id: 'ev-dup',
          caseId: 'case-test-02',
          originalFilename: 'reused_photo.jpg',
          mimeType: 'image/jpeg',
          byteSize: 102400,
          sha256Hash: 'existing-case-hash',
          isDuplicate: true, // Duplicate flagged!
          uploadedAt: new Date().toISOString(),
          scanStatus: 'suspicious',
          evidenceType: 'item_photo',
          downloadUrl: '/api/v1/evidence/ev-dup/file',
        },
      ],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const evaluation = policyEngine.evaluate(duplicateCase, sampleOrder, defaultPolicy);
    expect(evaluation.result).toBe('MANUAL_REVIEW_REQUIRED');
    expect(evaluation.reason_codes).toContain('DUPLICATE_EVIDENCE_HASH_DETECTED');
  });

  it('rejects claims filed outside the return window as ineligible', () => {
    const expiredOrder: Order = {
      ...sampleOrder,
      transactionDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      deliveryDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const lateCase: Case = {
      id: 'case-test-03',
      tenantId: 'tenant-test',
      caseNumber: 'FR-2026-903',
      orderId: expiredOrder.id,
      orderNumber: expiredOrder.orderNumber,
      paypalOrderId: expiredOrder.paypalOrderId,
      paypalCaptureId: expiredOrder.paypalCaptureId,
      customerName: 'Late Customer',
      customerEmail: 'late@example.com',
      status: 'NEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'I noticed this damage 40 days after receiving it.',
      customerAccessToken: 'tok-test-03',
      tokenExpiresAt: new Date().toISOString(),
      evidence: [],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const evaluation = policyEngine.evaluate(lateCase, expiredOrder, defaultPolicy);
    expect(evaluation.result).toBe('INELIGIBLE_UNDER_CONFIGURED_POLICY');
    expect(evaluation.reason_codes).toContain('RETURN_WINDOW_EXCEEDED');
    expect(evaluation.eligible_amount).toBeNull();
  });

  it('computes partial refunds correctly up to maxPartialRefundPercentage in cents', () => {
    const partialCase: Case = {
      id: 'case-test-04',
      tenantId: 'tenant-test',
      caseNumber: 'FR-2026-904',
      orderId: sampleOrder.id,
      orderNumber: sampleOrder.orderNumber,
      paypalOrderId: sampleOrder.paypalOrderId,
      paypalCaptureId: sampleOrder.paypalCaptureId,
      customerName: 'Partial Customer',
      customerEmail: 'partial@example.com',
      status: 'NEW',
      issueType: 'damaged_item',
      requestedResolution: 'partial_refund', // 50% max policy
      customerDescription: 'Scratched enclosure, keeping the unit for 50% discount.',
      customerAccessToken: 'tok-test-04',
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      evidence: [
        {
          id: 'ev-scratch',
          caseId: 'case-test-04',
          originalFilename: 'scratch.jpg',
          mimeType: 'image/jpeg',
          byteSize: 50000,
          sha256Hash: 'scratch-hash',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'unscanned',
          evidenceType: 'item_photo',
          downloadUrl: '/api/v1/evidence/ev-scratch/file',
        },
        {
          id: 'ev-carton',
          caseId: 'case-test-04',
          originalFilename: 'box.jpg',
          mimeType: 'image/jpeg',
          byteSize: 50000,
          sha256Hash: 'box-hash',
          isDuplicate: false,
          uploadedAt: new Date().toISOString(),
          scanStatus: 'unscanned',
          evidenceType: 'packaging_photo',
          downloadUrl: '/api/v1/evidence/ev-carton/file',
        },
      ],
      refundAttempts: [],
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const evaluation = policyEngine.evaluate(partialCase, sampleOrder, defaultPolicy);
    expect(evaluation.result).toBe('ELIGIBLE_FOR_MERCHANT_REVIEW');
    // Gross $149.99 * 50% = $74.995 -> 7499 cents = $74.99
    expect(evaluation.eligible_amount).toBe(74.99);
  });
});
