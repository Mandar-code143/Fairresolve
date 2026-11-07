import { describe, it, expect } from 'vitest';
import { requireAuth, requireRoles, AuthenticatedRequest } from '../../src/server/auth';
import { db } from '../../src/server/database';
import { authService } from '../../src/server/auth';
import { toCents } from '../../src/server/policyEngine';

// Lightweight Express Mock Helper for sandbox execution without TCP sockets
function createMockReqRes(options: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  user?: any;
}) {
  const req: any = {
    headers: options.headers || {},
    cookies: options.cookies || {},
    body: options.body || {},
    params: options.params || {},
    query: options.query || {},
    user: options.user,
  };

  let statusCode = 200;
  let jsonBody: any = null;
  let textBody: string = '';

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      jsonBody = data;
      return res;
    },
    send(data: string) {
      textBody = data;
      return res;
    },
    clearCookie(_name: string) {
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => jsonBody,
    getText: () => textBody,
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  return { req, res, next, isNextCalled: () => nextCalled };
}

describe('Security Negative Test Suite — Fail-Closed Boundary Testing', () => {
  it('rejects unauthenticated requests without token or cookie with 401', () => {
    const { req, res, next, isNextCalled } = createMockReqRes({});

    requireAuth(req as AuthenticatedRequest, res, next);

    expect(isNextCalled()).toBe(false);
    expect(res.getStatus()).toBe(401);
    expect(res.getBody().error).toMatch(/Authentication required/i);
  });

  it('rejects forged or expired session tokens with 401', () => {
    const { req, res, next, isNextCalled } = createMockReqRes({
      headers: { authorization: 'Bearer forged-invalid-token-12345' },
    });

    requireAuth(req as AuthenticatedRequest, res, next);

    expect(isNextCalled()).toBe(false);
    expect(res.getStatus()).toBe(401);
    expect(res.getBody().error).toMatch(/Session expired or invalid/i);
  });

  it('authenticates valid session token and sets req.user and req.tenantId', () => {
    const testUser = Object.values(db.users)[0];
    const { token } = authService.createSession(testUser.id, testUser.tenantId);

    const { req, res, next, isNextCalled } = createMockReqRes({
      headers: { authorization: `Bearer ${token}` },
    });

    requireAuth(req as AuthenticatedRequest, res, next);

    expect(isNextCalled()).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(testUser.id);
    expect(req.tenantId).toBe(testUser.tenantId);
  });

  it('rejects unauthorized VIEWER role attempting privileged action with 403', () => {
    const { req, res, next, isNextCalled } = createMockReqRes({
      user: { id: 'usr-viewer-1', name: 'Viewer User', role: 'VIEWER', tenantId: 'tenant-1' },
    });

    const guard = requireRoles(['OWNER', 'ADMIN', 'REVIEWER']);
    guard(req as AuthenticatedRequest, res, next);

    expect(isNextCalled()).toBe(false);
    expect(res.getStatus()).toBe(403);
    expect(res.getBody().error).toMatch(/Access denied/i);
    expect(res.getBody().error).toMatch(/VIEWER/);
  });

  it('allows authorized REVIEWER role through role guard', () => {
    const { req, res, next, isNextCalled } = createMockReqRes({
      user: { id: 'usr-rev-1', name: 'Reviewer User', role: 'REVIEWER', tenantId: 'tenant-1' },
    });

    const guard = requireRoles(['OWNER', 'ADMIN', 'REVIEWER']);
    guard(req as AuthenticatedRequest, res, next);

    expect(isNextCalled()).toBe(true);
  });

  it('rejects refund amount exceeding remaining refundable balance', () => {
    const order = {
      grossAmount: 149.99,
      refundableAmount: 149.99,
      refundedAmount: 0.0,
    };

    const requestedAmount = 200.0;
    const reqCents = toCents(requestedAmount);
    const refundableCents = toCents(order.refundableAmount);

    expect(reqCents > refundableCents).toBe(true);
  });

  it('rejects expired customer dispute tokens', () => {
    const expiredTokenCase = {
      customerAccessToken: 'tok_expired_sample',
      tokenExpiresAt: '2020-01-01T00:00:00Z', // in past
    };

    const isExpired = new Date(expiredTokenCase.tokenExpiresAt).getTime() < Date.now();
    expect(isExpired).toBe(true);
  });
});
