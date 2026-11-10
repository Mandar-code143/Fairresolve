import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { app } from '../../server';
import { db } from '../../src/server/database';
import { paypalGateway } from '../../src/server/paypalGateway';
import config from '../../src/server/config';

describe('PayPal Webhook Signature Verification & Deduplication Tests', () => {
  const originalClientId = (paypalGateway as any).clientId;
  const originalClientSecret = (paypalGateway as any).clientSecret;
  const originalWebhookId = config.PAYPAL_WEBHOOK_ID;

  beforeEach(() => {
    vi.restoreAllMocks();
    db.outbox.length = 0;
  });

  afterEach(() => {
    (paypalGateway as any).clientId = originalClientId;
    (paypalGateway as any).clientSecret = originalClientSecret;
    (paypalGateway as any).accessToken = undefined;
    config.PAYPAL_WEBHOOK_ID = originalWebhookId;
  });

  it('fails closed with 503 on /api/v1/webhooks/paypal when PayPal credentials or webhook ID are unconfigured', async () => {
    (paypalGateway as any).clientId = '';
    (paypalGateway as any).clientSecret = '';
    config.PAYPAL_WEBHOOK_ID = '';

    const res = await supertest(app)
      .post('/api/v1/webhooks/paypal')
      .send({ id: `WH-UNCONF-${Date.now()}`, event_type: 'PAYMENT.CAPTURE.REFUNDED' });

    expect(res.status).toBe(503);
    expect(res.body.configured).toBe(false);
  });

  it('rejects magic valid-transmission-signature-hash bypass when unconfigured or PayPal rejects signature', async () => {
    // 1. Unconfigured gateway must NEVER honor any hardcoded signature string
    (paypalGateway as any).clientId = '';
    (paypalGateway as any).clientSecret = '';
    const unconfResult = await paypalGateway.verifyWebhookSignature({
      authAlgo: 'SHA256withRSA',
      certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-456',
      transmissionId: 'trans-bypass-01',
      transmissionSig: 'valid-transmission-signature-hash',
      transmissionTime: new Date().toISOString(),
      webhookId: 'WH-REAL-12345',
      webhookEvent: { id: 'WH-EV-BYPASS-1', event_type: 'PAYMENT.CAPTURE.REFUNDED' },
    });
    expect(unconfResult).toBe(false);

    // 2. Configured gateway with PayPal returning FAILURE must reject even the legacy magic string
    (paypalGateway as any).clientId = 'sb-client-real-id';
    (paypalGateway as any).clientSecret = 'sb-client-real-secret';
    config.PAYPAL_WEBHOOK_ID = 'WH-REAL-12345';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-test', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verification_status: 'FAILURE' }), { status: 200 })
      );

    const res = await supertest(app)
      .post('/api/v1/webhooks/paypal')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-cert-url', 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-456')
      .set('paypal-transmission-id', 'trans-bypass-02')
      .set('paypal-transmission-sig', 'valid-transmission-signature-hash')
      .set('paypal-transmission-time', new Date().toISOString())
      .send({ id: `WH-BYPASS-2-${Date.now()}`, event_type: 'PAYMENT.CAPTURE.REFUNDED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid PayPal webhook signature');
  });

  it('rejects webhooks with missing signature headers, bad cert URLs, or embedded userinfo (SSRF guard)', async () => {
    (paypalGateway as any).clientId = 'sb-client-real-id';
    (paypalGateway as any).clientSecret = 'sb-client-real-secret';
    config.PAYPAL_WEBHOOK_ID = 'WH-REAL-12345';

    // Missing signature headers -> 400
    const resMissing = await supertest(app)
      .post('/api/v1/webhooks/paypal')
      .send({ id: `WH-MISS-${Date.now()}`, event_type: 'PAYMENT.CAPTURE.REFUNDED' });
    expect(resMissing.status).toBe(400);

    // Untrusted domain -> rejected before any outbound call
    const ssrfEvil = await paypalGateway.verifyWebhookSignature({
      authAlgo: 'SHA256withRSA',
      certUrl: 'https://attacker.evil.com/certs/fake.crt',
      transmissionId: 'trans-02',
      transmissionSig: 'real-sig',
      transmissionTime: new Date().toISOString(),
      webhookId: 'WH-REAL-12345',
      webhookEvent: { id: 'WH-EV-SSRF-1', event_type: 'PAYMENT.CAPTURE.REFUNDED' },
    });
    expect(ssrfEvil).toBe(false);

    // Embedded userinfo @ -> rejected
    const ssrfUserinfo = await paypalGateway.verifyWebhookSignature({
      authAlgo: 'SHA256withRSA',
      certUrl: 'https://evil.com@api.sandbox.paypal.com/cert.pem',
      transmissionId: 'trans-03',
      transmissionSig: 'real-sig',
      transmissionTime: new Date().toISOString(),
      webhookId: 'WH-REAL-12345',
      webhookEvent: { id: 'WH-EV-SSRF-2', event_type: 'PAYMENT.CAPTURE.REFUNDED' },
    });
    expect(ssrfUserinfo).toBe(false);

    // Non-HTTPS -> rejected
    const ssrfHttp = await paypalGateway.verifyWebhookSignature({
      authAlgo: 'SHA256withRSA',
      certUrl: 'http://api.sandbox.paypal.com/cert.pem',
      transmissionId: 'trans-04',
      transmissionSig: 'real-sig',
      transmissionTime: new Date().toISOString(),
      webhookId: 'WH-REAL-12345',
      webhookEvent: { id: 'WH-EV-SSRF-3', event_type: 'PAYMENT.CAPTURE.REFUNDED' },
    });
    expect(ssrfHttp).toBe(false);
  });

  it('verifies valid webhook against PayPal API, deduplicates repeated event IDs, and enqueues event', async () => {
    (paypalGateway as any).clientId = 'sb-client-real-id';
    (paypalGateway as any).clientSecret = 'sb-client-real-secret';
    config.PAYPAL_WEBHOOK_ID = 'WH-REAL-12345';

    const eventId = `WH-EVENT-DEDUP-${Date.now()}`;
    const validHeaders = {
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-456',
      'paypal-transmission-id': 'trans-valid-01',
      'paypal-transmission-sig': 'real-rsa-sig-base64',
      'paypal-transmission-time': new Date().toISOString(),
    };

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-valid', expires_in: 3600 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verification_status: 'SUCCESS' }), { status: 200 })
      );

    // 1. First delivery -> verified & enqueued
    const res1 = await supertest(app)
      .post('/api/v1/webhooks/paypal')
      .set(validHeaders)
      .send({ id: eventId, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'ref-1', status: 'COMPLETED' } });

    expect(res1.status).toBe(200);
    expect(res1.body.received).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(db.outbox.some((o) => o.eventType === 'PAYPAL_WEBHOOK_EVENT' && o.payload.webhookEventId === eventId)).toBe(true);

    // 2. Replay with identical eventId -> deduplicated without calling PayPal again
    const res2 = await supertest(app)
      .post('/api/v1/webhooks/paypal')
      .set(validHeaders)
      .send({ id: eventId, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'ref-1', status: 'COMPLETED' } });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('already_processed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
