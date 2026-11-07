import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { db } from '../../src/server/database';
import { paypalGateway } from '../../src/server/paypalGateway';

describe('PayPal Webhook Signature Verification & Deduplication Tests', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.post('/api/v1/test/webhooks/paypal', async (req, res) => {
      const eventId = req.body?.id;
      if (!eventId) {
        return res.status(400).json({ error: 'Missing PayPal webhook event id' });
      }

      // Deduplication check
      if (db.isWebhookProcessed(eventId)) {
        return res.status(200).json({ received: true, status: 'already_processed' });
      }

      const authAlgo = req.headers['paypal-auth-algo'] as string;
      const certUrl = req.headers['paypal-cert-url'] as string;
      const transmissionId = req.headers['paypal-transmission-id'] as string;
      const transmissionSig = req.headers['paypal-transmission-sig'] as string;
      const transmissionTime = req.headers['paypal-transmission-time'] as string;

      const isValid = await paypalGateway.verifyWebhookSignature({
        authAlgo,
        certUrl,
        transmissionId,
        transmissionSig,
        transmissionTime,
        webhookId: 'WH-TEST-100',
        webhookEvent: req.body,
      });

      if (!isValid) {
        return res.status(400).json({ error: 'Invalid PayPal webhook signature' });
      }

      db.markWebhookProcessed(eventId);
      res.status(200).json({ received: true, status: 'processed' });
    });
  });

  it('rejects webhooks with missing signature headers', async () => {
    const res = await supertest(app)
      .post('/api/v1/test/webhooks/paypal')
      .send({ id: 'WH-EVENT-001', event_type: 'PAYMENT.CAPTURE.REFUNDED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid PayPal webhook signature');
  });

  it('rejects webhooks with explicit invalid transmission signatures', async () => {
    const res = await supertest(app)
      .post('/api/v1/test/webhooks/paypal')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-cert-url', 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123')
      .set('paypal-transmission-id', 'trans-01')
      .set('paypal-transmission-sig', 'INVALID_SIGNATURE')
      .set('paypal-transmission-time', new Date().toISOString())
      .send({ id: 'WH-EVENT-002', event_type: 'PAYMENT.CAPTURE.REFUNDED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid PayPal webhook signature');
  });

  it('rejects cert_url pointing to untrusted external domains (SSRF prevention)', async () => {
    const res = await supertest(app)
      .post('/api/v1/test/webhooks/paypal')
      .set('paypal-auth-algo', 'SHA256withRSA')
      .set('paypal-cert-url', 'https://attacker.evil.com/certs/fake.crt')
      .set('paypal-transmission-id', 'trans-02')
      .set('paypal-transmission-sig', 'valid-mock-sig')
      .set('paypal-transmission-time', new Date().toISOString())
      .send({ id: 'WH-EVENT-003', event_type: 'PAYMENT.CAPTURE.REFUNDED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid PayPal webhook signature');
  });

  it('processes valid webhook and deduplicates repeated event IDs', async () => {
    const eventId = `WH-EVENT-DEDUP-${Date.now()}`;
    const validHeaders = {
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-456',
      'paypal-transmission-id': 'trans-valid-01',
      'paypal-transmission-sig': 'valid-transmission-signature-hash',
      'paypal-transmission-time': new Date().toISOString(),
    };

    // 1. First delivery: successfully processed
    const res1 = await supertest(app)
      .post('/api/v1/test/webhooks/paypal')
      .set(validHeaders)
      .send({ id: eventId, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'ref-1' } });

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('processed');

    // 2. Second delivery with identical eventId: must be deduplicated
    const res2 = await supertest(app)
      .post('/api/v1/test/webhooks/paypal')
      .set(validHeaders)
      .send({ id: eventId, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'ref-1' } });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('already_processed');
  });
});
