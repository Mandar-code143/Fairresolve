import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { authService } from '../../src/server/auth';
import { db } from '../../src/server/database';

describe('AuthService — Hardened Password & Session Security', () => {
  it('hashes passwords using scrypt with random salt', () => {
    const salt1 = crypto.randomBytes(32).toString('hex');
    const salt2 = crypto.randomBytes(32).toString('hex');
    const password = 'CorrectHorseBatteryStaple123!';

    const hash1 = authService.hashPassword(password, salt1);
    const hash2 = authService.hashPassword(password, salt2);

    expect(hash1).toBeDefined();
    expect(hash1.length).toBe(128); // 64 bytes in hex
    expect(hash2.length).toBe(128);
    expect(hash1).not.toBe(hash2); // Different salts must yield different hashes
  });

  it('verifies passwords with timing-safe comparison', () => {
    const salt = crypto.randomBytes(32).toString('hex');
    const password = 'SuperSecureFintechPassword456!';
    const hash = authService.hashPassword(password, salt);

    const isCorrect = authService.verifyPassword(password, salt, hash);
    expect(isCorrect).toBe(true);

    const isWrong = authService.verifyPassword('WrongPassword123!', salt, hash);
    expect(isWrong).toBe(false);
  });

  it('validates password strength rules', () => {
    // Too short
    expect(authService.validatePasswordStrength('Short1!').isValid).toBe(false);

    // Missing uppercase
    expect(authService.validatePasswordStrength('lowercaseonly123!').isValid).toBe(false);

    // Missing lowercase
    expect(authService.validatePasswordStrength('UPPERCASEONLY123!').isValid).toBe(false);

    // Missing numbers
    expect(authService.validatePasswordStrength('NoNumbersHereAtAll!').isValid).toBe(false);

    // Valid strong password
    expect(authService.validatePasswordStrength('P@ssword123Secure!').isValid).toBe(true);
  });

  it('creates sessions with high-entropy token and SHA-256 hash storage', () => {
    const userId = 'usr-test-01';
    const tenantId = 'tenant-test-01';

    const { session, token } = authService.createSession(userId, tenantId);

    expect(token).toBeDefined();
    expect(token.length).toBe(64); // 32 bytes in hex
    expect(session.tokenHash).toBeDefined();

    // Verify tokenHash matches SHA-256 of raw token
    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
    expect(session.tokenHash).toBe(expectedHash);

    // Expiration must be approximately 7 days in the future
    const expires = new Date(session.expiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expires - Date.now()).toBeGreaterThan(sevenDaysMs - 10000);
  });

  it('revokes session token cleanly', () => {
    const userId = 'usr-test-02';
    const tenantId = 'tenant-test-02';

    const { session, token } = authService.createSession(userId, tenantId);
    expect(db.sessions[session.id]).toBeDefined();

    const revoked = authService.revokeSession(token);
    expect(revoked).toBe(true);
    expect(db.sessions[session.id]).toBeUndefined();
  });

  it('enforces RBAC permissions hierarchy', () => {
    // OWNER has full permissions
    expect(authService.hasPermission('OWNER', 'EXECUTE_REFUND')).toBe(true);
    expect(authService.hasPermission('OWNER', 'PUBLISH_POLICY')).toBe(true);
    expect(authService.hasPermission('OWNER', 'MANAGE_TEAM')).toBe(true);

    // REVIEWER can review & authorize refunds but cannot edit policies or manage team
    expect(authService.hasPermission('REVIEWER', 'REVIEW_CASE')).toBe(true);
    expect(authService.hasPermission('REVIEWER', 'AUTHORIZE_REFUND')).toBe(true);
    expect(authService.hasPermission('REVIEWER', 'PUBLISH_POLICY')).toBe(false);
    expect(authService.hasPermission('REVIEWER', 'MANAGE_TEAM')).toBe(false);

    // ANALYST can run AI investigations but cannot authorize refunds
    expect(authService.hasPermission('ANALYST', 'RUN_AI_INVESTIGATION')).toBe(true);
    expect(authService.hasPermission('ANALYST', 'AUTHORIZE_REFUND')).toBe(false);

    // VIEWER can only view
    expect(authService.hasPermission('VIEWER', 'VIEW_CASES')).toBe(true);
    expect(authService.hasPermission('VIEWER', 'EXECUTE_REFUND')).toBe(false);
    expect(authService.hasPermission('VIEWER', 'RUN_AI_INVESTIGATION')).toBe(false);
  });
});
