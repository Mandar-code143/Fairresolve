import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { app } from '../../server';
import { db, Database } from '../../src/server/database';
import { evidenceProcessor } from '../../src/server/evidenceProcessor';
import { geminiService } from '../../src/server/geminiService';
import { paypalGateway } from '../../src/server/paypalGateway';
import { toCents } from '../../src/server/policyEngine';
import config from '../../src/server/config';

describe('FAIRRESOLVE — FULL APPLICATION SMOKE TEST (EXPORTED PRODUCTION EXPRESS APP)', () => {
  let tempStorageDir: string;
  const origStorageDir = config.FAIRRESOLVE_STORAGE_DIR;
  const origClientId = (paypalGateway as any).clientId;
  const origClientSecret = (paypalGateway as any).clientSecret;
  const origGeminiAi = (geminiService as any).ai;

  beforeAll(() => {
    tempStorageDir = path.resolve(process.cwd(), `temp_app_smoke_${Date.now()}`);
    fs.mkdirSync(tempStorageDir, { recursive: true });
    config.FAIRRESOLVE_STORAGE_DIR = tempStorageDir;
    // Isolate smoke suite from developer .env external API credentials
    (paypalGateway as any).clientId = '';
    (paypalGateway as any).clientSecret = '';
    (geminiService as any).ai = undefined;
  });

  afterAll(() => {
    (paypalGateway as any).clientId = origClientId;
    (paypalGateway as any).clientSecret = origClientSecret;
    (geminiService as any).ai = origGeminiAi;
    config.FAIRRESOLVE_STORAGE_DIR = origStorageDir;
    if (tempStorageDir && fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it('1. Health endpoints and unknown /api/* JSON 404 behave accurately', async () => {
    const live = await supertest(app).get('/health/live');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');

    const ready = await supertest(app).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ready');
    expect(ready.body.storageWritable).toBe(true);

    const api404 = await supertest(app).get('/api/v1/does-not-exist');
    expect(api404.status).toBe(404);
    expect(api404.body.error).toBe('API route not found');

    const legacyCheckout = await supertest(app)
      .post('/api/v1/orders/checkout-demo')
      .set('Authorization', 'Bearer dummy')
      .send({});
    // Either 401 (unauth) or 410 if authenticated — verify authenticated call gets 410 below
    expect([401, 410]).toContain(legacyCheckout.status);
  });

  it('2. Auth register -> login -> session cookie -> /me -> logout invalidation & invalid demo-login rejection', async () => {
    const badDemo = await supertest(app).post('/api/v1/auth/demo-login').send({});
    expect(badDemo.status).toBe(400);

    const missingDemo = await supertest(app).post('/api/v1/auth/demo-login').send({ userId: 'does-not-exist' });
    expect(missingDemo.status).toBe(404);

    const email = `smoke.owner.${Date.now()}@fairresolve.test`;
    const reg = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Smoke Owner', email, password: 'SmokePassword123!', companyName: 'Smoke Audio' });
    expect(reg.status).toBe(200);
    expect(reg.body.token).toBeDefined();

    const setCookies = reg.headers['set-cookie'];
    expect(setCookies).toBeDefined();

    const meRes = await supertest(app).get('/api/v1/auth/me').set('Cookie', setCookies);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);

    // CSRF block when using session cookie on mutating request without X-Requested-With
    const csrfBlocked = await supertest(app)
      .post('/api/v1/policies/publish')
      .set('Cookie', setCookies)
      .send({ returnWindowDays: 14 });
    expect(csrfBlocked.status).toBe(403);

    // CORS blocks unknown origin
    const corsBlocked = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Origin', 'https://attacker.example.com')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(corsBlocked.status).toBe(500);

    // Deprecated checkout route returns 410 when authenticated
    const deprecated = await supertest(app)
      .post('/api/v1/orders/checkout-demo')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({});
    expect(deprecated.status).toBe(410);

    // Logout revokes session
    const out = await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({});
    expect(out.status).toBe(200);

    const afterLogout = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(afterLogout.status).toBe(401);
  });

  it('3. All 3 checkout products, return/cancel callback replay guards, and failed capture protections', async () => {
    vi.restoreAllMocks();
    const reg = await supertest(app).post('/api/v1/auth/register').send({
      name: 'Checkout Owner',
      email: `chk.owner.${Date.now()}@test.com`,
      password: 'SmokePassword123!',
      companyName: 'Checkout Store',
    });
    const token = reg.body.token;

    // Invalid productType rejected
    const badProd = await supertest(app)
      .post('/api/v1/paypal/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ productType: 'nonexistent_item' });
    expect(badProd.status).toBe(400);

    // Unknown checkoutId capture rejected (never bypasses order creation)
    const noPendingCap = await supertest(app)
      .post('/api/v1/paypal/orders/PPO-UNCREATED-999/capture')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(noPendingCap.status).toBe(404);

    // Exercise all 3 catalogue products
    const expectedTotals: Record<'headphones' | 'shoes' | 'tracker', number> = {
      headphones: 159.99,
      shoes: 129.0,
      tracker: 69.0,
    };

    for (const productType of ['headphones', 'shoes', 'tracker'] as const) {
      const ordRes = await supertest(app)
        .post('/api/v1/paypal/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ productType });
      expect(ordRes.status).toBe(200);
      expect(ordRes.body.grossAmount).toBe(expectedTotals[productType]);
      expect(ordRes.body.checkoutState).toBeDefined();

      // Return callback triggers single-use capture + 302 redirect
      const orderCountBefore = Object.keys(db.orders).length;
      const ret1 = await supertest(app).get(
        `/api/v1/paypal/checkout/return?checkoutState=${encodeURIComponent(ordRes.body.checkoutState)}&token=${encodeURIComponent(ordRes.body.orderId)}`
      );
      expect(ret1.status).toBe(302);
      expect(ret1.headers.location).toContain('checkoutStatus=captured');
      expect(Object.keys(db.orders).length).toBe(orderCountBefore + 1);

      // Replaying same return callback MUST NOT create a second order or case
      const retReplay = await supertest(app).get(
        `/api/v1/paypal/checkout/return?checkoutState=${encodeURIComponent(ordRes.body.checkoutState)}&token=${encodeURIComponent(ordRes.body.orderId)}`
      );
      expect(retReplay.status).toBe(302);
      expect(retReplay.headers.location).toContain('replayed=true');
      expect(Object.keys(db.orders).length).toBe(orderCountBefore + 1);

      // Frontend verification lookup endpoint returns persisted checkout/order/case without exposing stateTokenHash
      const lookup = await supertest(app)
        .get(`/api/v1/paypal/checkouts/${ordRes.body.checkoutId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(lookup.status).toBe(200);
      expect(lookup.body.checkout.stateTokenHash).toBeUndefined();
      expect(lookup.body.order.grossAmount).toBe(expectedTotals[productType]);
      expect(lookup.body.order.trackingSynthetic).toBe(true);
    }

    // Cancel callback marks CANCELLED and prevents subsequent capture
    const cancelOrd = await supertest(app)
      .post('/api/v1/paypal/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ productType: 'tracker' });
    const cancelRedirect = await supertest(app).get(
      `/api/v1/paypal/checkout/cancel?checkoutState=${encodeURIComponent(cancelOrd.body.checkoutState)}`
    );
    expect(cancelRedirect.status).toBe(302);
    expect(cancelRedirect.headers.location).toContain('checkoutStatus=cancelled');

    const capAfterCancel = await supertest(app)
      .post(`/api/v1/paypal/orders/${cancelOrd.body.orderId}/capture`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(capAfterCancel.status).toBe(409);

    // Non-COMPLETED PayPal capture (PENDING) must NOT create an Order or Case
    const pendOrd = await supertest(app)
      .post('/api/v1/paypal/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ productType: 'headphones' });
    vi.spyOn(paypalGateway, 'captureOrder').mockResolvedValueOnce({
      orderId: pendOrd.body.orderId,
      captureId: 'CAP-PEND-NO-ORDER',
      status: 'PENDING',
      grossAmount: 159.99,
      currency: 'USD',
      isSimulated: false,
    });
    const orderCountPreFail = Object.keys(db.orders).length;
    const pendCapRes = await supertest(app)
      .post(`/api/v1/paypal/orders/${pendOrd.body.orderId}/capture`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(pendCapRes.status).toBe(409);
    expect(Object.keys(db.orders).length).toBe(orderCountPreFail);
  });

  it('4. Evidence uploads (JPEG/PNG/WEBP), invalid binary rejection, role access control, and four-eyes refunds work end-to-end', async () => {
    vi.restoreAllMocks();
    const reg = await supertest(app).post('/api/v1/auth/register').send({
      name: 'Smoke Case Owner',
      email: `case.owner.${Date.now()}@test.com`,
      password: 'SmokePassword123!',
      companyName: 'Evidence Corp',
    });
    const ownerTok = reg.body.token;

    // Invite ADMIN + VIEWER
    const invAdmin = await supertest(app)
      .post('/api/v1/merchant/team/invite')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ name: 'Smoke Admin', email: `smoke.admin.${Date.now()}@test.com`, role: 'ADMIN' });
    const accAdmin = await supertest(app)
      .post('/api/v1/merchant/invitations/accept')
      .send({ token: invAdmin.body.rawInviteToken, name: 'Smoke Admin', password: 'SmokePassword123!' });
    const adminTok = accAdmin.body.token;

    const invViewer = await supertest(app)
      .post('/api/v1/merchant/team/invite')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ name: 'Smoke Viewer', email: `smoke.viewer.${Date.now()}@test.com`, role: 'VIEWER' });
    const accViewer = await supertest(app)
      .post('/api/v1/merchant/invitations/accept')
      .send({ token: invViewer.body.rawInviteToken, name: 'Smoke Viewer', password: 'SmokePassword123!' });
    const viewerTok = accViewer.body.token;

    // Create captured checkout -> order & case
    const ord = await supertest(app)
      .post('/api/v1/paypal/orders')
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ productType: 'headphones', buyerName: 'Alice EvidenceBuyer', buyerEmail: 'alice@buyer.test' });
    const cap = await supertest(app)
      .post(`/api/v1/paypal/orders/${ord.body.orderId}/capture`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({});
    const caseId = cap.body.case.id;
    const customerToken = cap.body.case.customerAccessToken;

    // Invalid magic-byte image rejected on customer portal submit (400)
    const badSubmit = await supertest(app)
      .post(`/api/v1/customer/case/${customerToken}/submit`)
      .send({
        issueType: 'damaged_item',
        description: 'Uploading forged text file as jpeg',
        requestedResolution: 'full_refund',
        uploadedFiles: [
          {
            filename: 'malicious.jpg',
            fileBase64: Buffer.from('NOT_A_REAL_IMAGE').toString('base64'),
            evidenceType: 'item_photo',
          },
        ],
      });
    expect(badSubmit.status).toBe(400);

    // Valid JPEG, PNG, WEBP uploads succeed via Sharp pipeline & store inside configured storage dir
    const [jpgBuf, pngBuf, webpBuf] = await Promise.all([
      sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 20, b: 20 } } }).jpeg().toBuffer(),
      sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 200, b: 20 } } }).png().toBuffer(),
      sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 20, b: 200 } } }).webp().toBuffer(),
    ]);

    const okSubmit = await supertest(app)
      .post(`/api/v1/customer/case/${customerToken}/submit`)
      .send({
        issueType: 'damaged_item',
        description: 'Genuine item + packaging photos uploaded',
        requestedResolution: 'partial_refund',
        uploadedFiles: [
          { filename: 'item.jpg', fileBase64: jpgBuf.toString('base64'), evidenceType: 'item_photo' },
          { filename: 'box.png', fileBase64: pngBuf.toString('base64'), evidenceType: 'packaging_photo' },
          { filename: 'detail.webp', fileBase64: webpBuf.toString('base64'), evidenceType: 'item_photo' },
        ],
      });
    expect(okSubmit.status).toBe(200);
    expect(db.cases[caseId].evidence.length).toBe(3);

    const sampleEvId = db.cases[caseId].evidence[0].id;
    const savedDiskPath = evidenceProcessor.getFilePath(sampleEvId);
    expect(savedDiskPath).toBeTruthy();
    expect(savedDiskPath!.startsWith(path.join(tempStorageDir, 'private_uploads'))).toBe(true);
    expect(fs.existsSync(savedDiskPath!)).toBe(true);

    // Evidence access control: unauth 403, VIEWER 403, OWNER 200, customer token 200
    expect((await supertest(app).get(`/api/v1/evidence/${sampleEvId}/file`)).status).toBe(403);
    expect(
      (await supertest(app).get(`/api/v1/evidence/${sampleEvId}/file`).set('Authorization', `Bearer ${viewerTok}`)).status
    ).toBe(403);
    expect(
      (await supertest(app).get(`/api/v1/evidence/${sampleEvId}/file`).set('Authorization', `Bearer ${ownerTok}`)).status
    ).toBe(200);
    expect(
      (await supertest(app).get(`/api/v1/evidence/${sampleEvId}/file?token=${encodeURIComponent(customerToken)}`)).status
    ).toBe(200);

    // VIEWER sees redacted PII
    const viewerCases = await supertest(app).get('/api/v1/cases').set('Authorization', `Bearer ${viewerTok}`);
    expect(viewerCases.status).toBe(200);
    const vCase = viewerCases.body.cases.find((c: any) => c.id === caseId);
    expect(vCase.customerEmail).not.toBe('alice@buyer.test');

    // Refund without approval blocked -> approve -> self-execution blocked -> four-eyes execution succeeds -> duplicate safe
    const unapproved = await supertest(app)
      .post(`/api/v1/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ idempotencyKey: 'SMOKE-UNAPPROVED' });
    expect(unapproved.status).toBe(400);

    const approved = await supertest(app)
      .post(`/api/v1/cases/${caseId}/approve-refund`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ amount: 45.0, reason: 'Smoke partial refund' });
    expect(approved.status).toBe(200);

    const selfExec = await supertest(app)
      .post(`/api/v1/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ amount: 45.0, idempotencyKey: 'SMOKE-SELF' });
    expect(selfExec.status).toBe(403);

    const validExec = await supertest(app)
      .post(`/api/v1/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ amount: 45.0, idempotencyKey: 'SMOKE-VALID-1' });
    expect(validExec.status).toBe(200);
    expect(validExec.body.success).toBe(true);
    expect(toCents(validExec.body.order.refundableAmount)).toBe(15999 - 4500);

    // Duplicate key idempotent replay does not double refund
    const dupExec = await supertest(app)
      .post(`/api/v1/cases/${caseId}/execute-refund`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ amount: 45.0, idempotencyKey: 'SMOKE-VALID-1' });
    expect(dupExec.status).toBe(200);
    expect(dupExec.body.isDuplicateSubmission).toBe(true);
    expect(toCents(dupExec.body.order.refundableAmount)).toBe(15999 - 4500);

    // Flush hybrid JSON to isolated volume dir and verify serialized persistence
    await db.flush();
    expect(fs.existsSync(path.join(tempStorageDir, 'fairresolve_db.json'))).toBe(true);
    const reloadedJsonDb = new Database();
    expect(reloadedJsonDb.cases[caseId]?.evidence.length).toBe(3);
  });
});
