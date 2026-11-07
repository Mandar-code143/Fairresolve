import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../src/server/database';
import { CaseEvent } from '../../src/types';

describe('AuditLedger — Cryptographic SHA-256 Hash Chaining', () => {
  it('creates sequentially chained SHA-256 block hashes', () => {
    const event1: CaseEvent = {
      id: `ev-test-${Date.now()}-1`,
      caseId: 'case-chain-01',
      eventType: 'CASE_CREATED',
      actor: { type: 'CUSTOMER', name: 'Chain Tester' },
      summary: 'Initial case creation block',
      details: { amount: 100 },
      timestamp: new Date().toISOString(),
    };

    const event2: CaseEvent = {
      id: `ev-test-${Date.now()}-2`,
      caseId: 'case-chain-01',
      eventType: 'AI_INVESTIGATION_COMPLETED',
      actor: { type: 'AI_ENGINE', name: 'gemini-3.8-flash' },
      summary: 'AI observation completed',
      details: { recommendation: 'eligible' },
      timestamp: new Date().toISOString(),
    };

    db.appendAuditEvent(event1);
    db.appendAuditEvent(event2);

    expect(event1.currentHash).toBeDefined();
    expect(event1.currentHash!.length).toBe(64); // SHA-256 hex string

    expect(event2.previousHash).toBe(event1.currentHash);
    expect(event2.currentHash).toBeDefined();
    expect(event2.currentHash).not.toBe(event1.currentHash);

    // Verify chain integrity passes
    const verification = db.verifyAuditChainIntegrity();
    expect(verification.isValid).toBe(true);
    expect(verification.checkedCount).toBeGreaterThanOrEqual(2);
  });

  it('detects tampering when an event payload is modified post-hoc', () => {
    // Append an event
    const event: CaseEvent = {
      id: `ev-tamper-${Date.now()}`,
      caseId: 'case-tamper-01',
      eventType: 'REFUND_EXECUTED',
      actor: { type: 'PAYPAL_GATEWAY', name: 'PayPal Sandbox' },
      summary: 'Legitimate refund of $50.00',
      details: { refundAmount: 50.0 },
      timestamp: new Date().toISOString(),
    };

    db.appendAuditEvent(event);
    const initialCheck = db.verifyAuditChainIntegrity();
    expect(initialCheck.isValid).toBe(true);

    // Attacker modifies the event details in memory without updating the hash
    const target = db.auditEvents[db.auditEvents.length - 1];
    target.details = { refundAmount: 5000000.0 }; // Malicious alteration!

    // Integrity verification must fail!
    const tamperedCheck = db.verifyAuditChainIntegrity();
    expect(tamperedCheck.isValid).toBe(false);
    expect(tamperedCheck.brokenAtIndex).toBe(db.auditEvents.length - 1);

    // Revert change to keep state clean
    target.details = { refundAmount: 50.0 };
    const restoredCheck = db.verifyAuditChainIntegrity();
    expect(restoredCheck.isValid).toBe(true);
  });
});
