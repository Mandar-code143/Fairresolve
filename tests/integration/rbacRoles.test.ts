import { describe, it, expect, beforeEach } from 'vitest';
import express, { Response } from 'express';
import supertest from 'supertest';
import cookieParser from 'cookie-parser';
import {
  authService,
  requireAuth,
  requireRoles,
  requirePermission,
  AuthenticatedRequest,
} from '../../src/server/auth';
import { db } from '../../src/server/database';
import { permissionService } from '../../src/server/permissions';
import { UserRole, RefundApproval } from '../../src/types';

describe('RBAC & Multi-Tenant Security Integration Tests', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());

    if (!db.cases['case-101']) {
      db.reseed();
    }

    // 1. Protected Team Management (OWNER, ADMIN only)
    app.post(
      '/api/v1/test/team/invite',
      requireAuth,
      requireRoles(['OWNER', 'ADMIN']),
      (req: AuthenticatedRequest, res: Response) => {
        res.json({ success: true, message: 'Invite sent', role: req.user!.role });
      }
    );

    // 2. Protected Policy Publishing (OWNER, ADMIN only)
    app.post(
      '/api/v1/test/policies/publish',
      requireAuth,
      requirePermission('PUBLISH_POLICY'),
      (req: AuthenticatedRequest, res: Response) => {
        res.json({ success: true, message: 'Policy published' });
      }
    );

    // 3. Protected Refund Execution (OWNER, ADMIN, REVIEWER only)
    app.post(
      '/api/v1/test/cases/:id/refund',
      requireAuth,
      requirePermission('AUTHORIZE_REFUND'),
      (req: AuthenticatedRequest, res: Response) => {
        // Enforce multi-tenant boundary check
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) {
          return res.status(404).json({ error: 'Case not found' });
        }
        res.json({ success: true, message: 'Refund authorized', caseId: c.id });
      }
    );

    // 4. Protected AI Run (OWNER, ADMIN, REVIEWER, ANALYST)
    app.post(
      '/api/v1/test/cases/:id/re-analyze',
      requireAuth,
      requirePermission('RUN_AI_INVESTIGATION'),
      (req: AuthenticatedRequest, res: Response) => {
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) {
          return res.status(404).json({ error: 'Case not found' });
        }
        res.json({ success: true, message: 'Analysis triggered' });
      }
    );

    // 5. Read-only Cases (All 5 roles permitted within tenant)
    app.get(
      '/api/v1/test/cases',
      requireAuth,
      requirePermission('VIEW_CASES'),
      (req: AuthenticatedRequest, res: Response) => {
        const cases = Object.values(db.cases).filter((c) => c.tenantId === req.tenantId);
        res.json({ cases });
      }
    );

    // 6. Protected Four-Eyes Execution
    app.post(
      '/api/v1/test/cases/:id/execute-refund',
      requireAuth,
      requireRoles(['OWNER', 'ADMIN']),
      (req: AuthenticatedRequest, res: Response) => {
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) {
          return res.status(404).json({ error: 'Case not found' });
        }
        if (c.activeApproval && c.activeApproval.authorizedBy === req.user!.id) {
          return res.status(403).json({
            error: 'Separation of duties violation: Approver and executor must be different users.',
          });
        }
        res.json({ success: true, message: 'Settlement executed' });
      }
    );

    // 7. Case Retrieval with Permissions and Field-Level Redaction
    app.get(
      '/api/v1/test/cases/:id',
      requireAuth,
      (req: AuthenticatedRequest, res: Response) => {
        const c = db.cases[req.params.id];
        if (!c || c.tenantId !== req.tenantId) {
          return res.status(404).json({ error: 'Case not found' });
        }
        if (!permissionService.canAccessCase(req.user!, c)) {
          return res.status(403).json({ error: 'Access denied: Analyst is not assigned to this case' });
        }
        const serialized = permissionService.serializeCase(c, req.user!);
        res.json({ case: serialized });
      }
    );
  });

  const createSessionForRole = (role: UserRole, tenantId: string = 'tenant-apex-101') => {
    const userId = `usr-test-${role.toLowerCase()}`;
    db.users[userId] = {
      id: userId,
      name: `Test ${role}`,
      email: `${role.toLowerCase()}@test.com`,
      role,
      tenantId,
      passwordHash: 'dummy-hash',
      passwordSalt: 'dummy-salt',
      createdAt: new Date().toISOString(),
    };
    const { token } = authService.createSession(userId, tenantId);
    return token;
  };

  it('allows OWNER and ADMIN to invite team members, but rejects REVIEWER, ANALYST, and VIEWER', async () => {
    const ownerToken = createSessionForRole('OWNER');
    const adminToken = createSessionForRole('ADMIN');
    const reviewerToken = createSessionForRole('REVIEWER');
    const analystToken = createSessionForRole('ANALYST');
    const viewerToken = createSessionForRole('VIEWER');

    // OWNER: 200
    const resOwner = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'new@test.com', role: 'REVIEWER' });
    expect(resOwner.status).toBe(200);

    // ADMIN: 200
    const resAdmin = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'new2@test.com', role: 'REVIEWER' });
    expect(resAdmin.status).toBe(200);

    // REVIEWER: 403 Forbidden
    const resRev = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ email: 'new3@test.com', role: 'ANALYST' });
    expect(resRev.status).toBe(403);
    expect(resRev.body.error).toContain('Access denied');

    // ANALYST: 403 Forbidden
    const resAnalyst = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ email: 'new4@test.com', role: 'VIEWER' });
    expect(resAnalyst.status).toBe(403);

    // VIEWER: 403 Forbidden
    const resViewer = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ email: 'new5@test.com', role: 'VIEWER' });
    expect(resViewer.status).toBe(403);
  });

  it('allows REVIEWER to authorize refunds, but rejects ANALYST and VIEWER', async () => {
    const reviewerToken = createSessionForRole('REVIEWER');
    const analystToken = createSessionForRole('ANALYST');
    const viewerToken = createSessionForRole('VIEWER');

    const sampleCaseId = 'case-101';

    // REVIEWER: 200
    const resRev = await supertest(app)
      .post(`/api/v1/test/cases/${sampleCaseId}/refund`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ amount: 50.0 });
    expect(resRev.status).toBe(200);

    // ANALYST: 403 Forbidden
    const resAnalyst = await supertest(app)
      .post(`/api/v1/test/cases/${sampleCaseId}/refund`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 50.0 });
    expect(resAnalyst.status).toBe(403);

    // VIEWER: 403 Forbidden
    const resViewer = await supertest(app)
      .post(`/api/v1/test/cases/${sampleCaseId}/refund`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 50.0 });
    expect(resViewer.status).toBe(403);
  });

  it('allows ANALYST to run AI investigation, but rejects VIEWER', async () => {
    const analystToken = createSessionForRole('ANALYST');
    const viewerToken = createSessionForRole('VIEWER');
    const sampleCaseId = 'case-101';

    // ANALYST: 200
    const resAnalyst = await supertest(app)
      .post(`/api/v1/test/cases/${sampleCaseId}/re-analyze`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({});
    expect(resAnalyst.status).toBe(200);

    // VIEWER: 403 Forbidden
    const resViewer = await supertest(app)
      .post(`/api/v1/test/cases/${sampleCaseId}/re-analyze`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({});
    expect(resViewer.status).toBe(403);
  });

  it('strictly isolates tenant data: Tenant A user cannot access Tenant B cases', async () => {
    // Create an isolated Tenant B and a case belonging to Tenant B
    const tenantBId = 'tenant-beta-202';
    db.tenants[tenantBId] = {
      id: tenantBId,
      name: 'Beta Electronics',
      slug: 'beta-electronics',
      currency: 'USD',
      createdAt: new Date().toISOString(),
    };

    const caseBetaId = 'case-beta-999';
    db.cases[caseBetaId] = {
      id: caseBetaId,
      tenantId: tenantBId,
      caseNumber: 'FR-BETA-001',
      orderId: 'ord-beta-01',
      orderNumber: 'APX-BETA-01',
      paypalOrderId: 'PPO-BETA',
      paypalCaptureId: 'CAP-BETA',
      customerName: 'Secret Customer',
      customerEmail: 'secret@beta.com',
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Secret data belonging to Tenant B',
      customerAccessToken: 'tok-beta',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // User belonging to Tenant A (Apex Audio)
    const tenantAUserToken = createSessionForRole('OWNER', 'tenant-apex-101');

    // Tenant A attempts to refund Tenant B's case: Must return 404 Not Found (no cross-tenant leakage)
    const resCrossTenant = await supertest(app)
      .post(`/api/v1/test/cases/${caseBetaId}/refund`)
      .set('Authorization', `Bearer ${tenantAUserToken}`)
      .send({ amount: 100.0 });

    expect(resCrossTenant.status).toBe(404);
    expect(resCrossTenant.body.error).toBe('Case not found');
  });

  it('enforces CSRF protection on mutating requests when authenticated via cookie', async () => {
    const ownerToken = createSessionForRole('OWNER');

    // Mutating POST request with cookie but WITHOUT anti-CSRF header: 403 Forbidden
    const resCsrfBlocked = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Cookie', `fairresolve_session=${ownerToken}`)
      .send({ email: 'attacker@evil.com', role: 'OWNER' });

    expect(resCsrfBlocked.status).toBe(403);
    expect(resCsrfBlocked.body.error).toContain('CSRF verification failed');

    // Mutating POST request with cookie AND anti-CSRF header: 200 OK
    const resCsrfPassed = await supertest(app)
      .post('/api/v1/test/team/invite')
      .set('Cookie', `fairresolve_session=${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'legitimate@apexaudio.com', role: 'ADMIN' });

    expect(resCsrfPassed.status).toBe(200);
  });

  it('enforces four-eyes financial control: approver cannot execute their own approved refund', async () => {
    const ownerToken = createSessionForRole('OWNER');
    const adminToken = createSessionForRole('ADMIN');

    // Retrieve or setup test case
    const caseId = 'case-four-eyes-01';
    db.cases[caseId] = {
      id: caseId,
      tenantId: 'tenant-apex-101',
      caseNumber: 'FR-4EYES-01',
      orderId: 'ord-01',
      orderNumber: 'APX-01',
      paypalOrderId: 'PPO-01',
      paypalCaptureId: 'CAP-01',
      customerName: 'Alice Test',
      customerEmail: 'alice@test.com',
      status: 'APPROVED_PENDING_REFUND',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Broken on arrival',
      customerAccessToken: 'tok-01',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Owner approves the refund (sets active approval with owner's ID)
    const ownerUserId = 'usr-test-owner';
    const approval: RefundApproval = {
      id: 'appr-01',
      caseId,
      tenantId: 'tenant-apex-101',
      orderId: 'ord-01',
      captureId: 'CAP-01',
      authorizedBy: ownerUserId,
      authorizedByName: 'Test Owner',
      authorizedByRole: 'OWNER',
      approvedAmount: 50.0,
      approvedAmountCents: 5000,
      currency: 'USD',
      policyVersion: '1.0',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    db.cases[caseId].activeApproval = approval;

    // 1. Same user (Owner who approved) attempts execution: 403 Forbidden (separation of duties violation)
    const resSameUser = await supertest(app)
      .post(`/api/v1/test/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-4EYES-01' });

    expect(resSameUser.status).toBe(403);
    expect(resSameUser.body.error).toContain('Separation of duties violation');

    // 2. Different user (Admin who did NOT approve) attempts execution: 200 OK
    const resDifferentUser = await supertest(app)
      .post(`/api/v1/test/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.0, idempotencyKey: 'IDEMP-4EYES-02' });

    expect(resDifferentUser.status).toBe(200);
    expect(resDifferentUser.body.message).toBe('Settlement executed');
  });

  it('enforces field-level redaction for VIEWER role (masks customer PII, strips access tokens)', async () => {
    const viewerToken = createSessionForRole('VIEWER');
    const ownerToken = createSessionForRole('OWNER');

    const caseId = 'case-redact-01';
    db.cases[caseId] = {
      id: caseId,
      tenantId: 'tenant-apex-101',
      caseNumber: 'FR-REDACT-01',
      orderId: 'ord-01',
      orderNumber: 'APX-01',
      paypalOrderId: 'PPO-01',
      paypalCaptureId: 'CAP-01',
      customerName: 'Jonathan Mercer',
      customerEmail: 'j.mercer@sandbox.test',
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Secret customer notes',
      customerAccessToken: 'sensitive-raw-portal-token-12345',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // VIEWER request: Customer PII masked, customer access token completely stripped
    const resViewer = await supertest(app)
      .get(`/api/v1/test/cases/${caseId}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(resViewer.status).toBe(200);
    expect(resViewer.body.case.customerName).toBe('J*** M***');
    expect(resViewer.body.case.customerEmail).toContain('***');
    expect(resViewer.body.case.customerAccessToken).toBe('');

    // OWNER request: Unmasked raw PII and token intact
    const resOwner = await supertest(app)
      .get(`/api/v1/test/cases/${caseId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(resOwner.status).toBe(200);
    expect(resOwner.body.case.customerName).toBe('Jonathan Mercer');
    expect(resOwner.body.case.customerEmail).toBe('j.mercer@sandbox.test');
    expect(resOwner.body.case.customerAccessToken).toBe('sensitive-raw-portal-token-12345');
  });

  it('enforces analyst assignment scope: analysts cannot view cases assigned to another analyst', async () => {
    const analystToken = createSessionForRole('ANALYST');
    const analystUserId = 'usr-test-analyst';

    const otherAnalystCaseId = 'case-analyst-other-01';
    db.cases[otherAnalystCaseId] = {
      id: otherAnalystCaseId,
      tenantId: 'tenant-apex-101',
      caseNumber: 'FR-ANALYST-01',
      orderId: 'ord-01',
      orderNumber: 'APX-01',
      paypalOrderId: 'PPO-01',
      paypalCaptureId: 'CAP-01',
      customerName: 'Customer X',
      customerEmail: 'x@test.com',
      status: 'READY_FOR_REVIEW',
      issueType: 'damaged_item',
      requestedResolution: 'full_refund',
      customerDescription: 'Issue description',
      customerAccessToken: 'tok-x',
      tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      assignedTo: 'usr-other-analyst-999',
      assignedToName: 'Other Analyst',
      evidence: [],
      timeline: [],
      refundAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Attempting to access a case assigned to another analyst -> 403 Forbidden
    const resDenied = await supertest(app)
      .get(`/api/v1/test/cases/${otherAnalystCaseId}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(resDenied.status).toBe(403);
    expect(resDenied.body.error).toContain('Access denied');

    // Assigning the case to this analyst -> 200 OK
    db.cases[otherAnalystCaseId].assignedTo = analystUserId;
    const resAllowed = await supertest(app)
      .get(`/api/v1/test/cases/${otherAnalystCaseId}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(resAllowed.status).toBe(200);
    expect(resAllowed.body.case.id).toBe(otherAnalystCaseId);
  });
});
