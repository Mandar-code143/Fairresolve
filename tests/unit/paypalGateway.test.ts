import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { paypalGateway } from '../../src/server/paypalGateway';

describe('PayPalGateway — Orders v2 Payloads, Captures & Simulation Integrity', () => {
  const originalClientId = (paypalGateway as any).clientId;
  const originalClientSecret = (paypalGateway as any).clientSecret;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (paypalGateway as any).clientId = originalClientId;
    (paypalGateway as any).clientSecret = originalClientSecret;
    (paypalGateway as any).accessToken = undefined;
  });

  it('builds exact Orders v2 breakdown for headphones ($149.99 + $10.00 = $159.99)', () => {
    const built = paypalGateway.buildCreateOrderPayload({
      amount: 159.99,
      currency: 'USD',
      orderNumber: 'APX-TEST-001',
      items: [{ name: 'AuraSound ANC Wireless Studio Headphones', sku: 'APX-H900-BLK', unitPrice: 149.99, quantity: 1 }],
      shippingAmount: 10.0,
    });

    expect(built.grossCents).toBe(15999);
    expect(built.payload.purchase_units[0].amount.value).toBe('159.99');
    expect(built.payload.purchase_units[0].amount.breakdown.item_total.value).toBe('149.99');
    expect(built.payload.purchase_units[0].amount.breakdown.shipping.value).toBe('10.00');
  });

  it('builds exact Orders v2 breakdown for shoes ($119.50 + $9.50 = $129.00)', () => {
    const built = paypalGateway.buildCreateOrderPayload({
      amount: 129.0,
      currency: 'USD',
      orderNumber: 'APX-TEST-002',
      items: [{ name: 'ProTrail Ultralight Running Shoes', sku: 'APX-TRAIL-10M', unitPrice: 119.5, quantity: 1 }],
      shippingAmount: 9.5,
    });

    expect(built.grossCents).toBe(12900);
    expect(built.payload.purchase_units[0].amount.value).toBe('129.00');
    expect(built.payload.purchase_units[0].amount.breakdown.item_total.value).toBe('119.50');
    expect(built.payload.purchase_units[0].amount.breakdown.shipping.value).toBe('9.50');
  });

  it('omits zero shipping breakdown cleanly for tracker ($69.00 + $0.00 = $69.00)', () => {
    const built = paypalGateway.buildCreateOrderPayload({
      amount: 69.0,
      currency: 'USD',
      orderNumber: 'APX-TEST-003',
      items: [{ name: 'PulseFit Pro Smart Tracker', sku: 'APX-FIT-GRY', unitPrice: 69.0, quantity: 1 }],
      shippingAmount: 0,
    });

    expect(built.grossCents).toBe(6900);
    expect(built.payload.purchase_units[0].amount.value).toBe('69.00');
    expect(built.payload.purchase_units[0].amount.breakdown.item_total.value).toBe('69.00');
    expect(built.payload.purchase_units[0].amount.breakdown.shipping).toBeUndefined();
  });

  it('rejects gross vs item_total + shipping mismatch before calling PayPal API', () => {
    expect(() =>
      paypalGateway.buildCreateOrderPayload({
        amount: 150.0,
        currency: 'USD',
        orderNumber: 'APX-MISMATCH',
        items: [{ name: 'Headphones', unitPrice: 149.99, quantity: 1 }],
        shippingAmount: 10.0,
      })
    ).toThrow(/mismatch/i);
  });

  it('honors expected amount/currency in simulated captureOrder and getRefund (never hardcoded 149.99)', async () => {
    (paypalGateway as any).clientId = '';
    (paypalGateway as any).clientSecret = '';

    await expect(paypalGateway.captureOrder('SIM-SANDBOX-ORD-1')).rejects.toThrow(/expected order amount/i);

    const simCap = await paypalGateway.captureOrder('SIM-SANDBOX-ORD-2', {
      amount: 129.0,
      currency: 'USD',
    });
    expect(simCap.isSimulated).toBe(true);
    expect(simCap.grossAmount).toBe(129.0);
    expect(simCap.currency).toBe('USD');

    const simRef = await paypalGateway.getRefund('SIM-SANDBOX-REF-1', {
      amount: 42.5,
      currency: 'USD',
    });
    expect(simRef.isSimulated).toBe(true);
    expect(simRef.amount?.value).toBe('42.50');
    expect(simRef.amount?.currency_code).toBe('USD');
  });

  it('validates live PayPal capture responses for matching order ID, capture ID, and non-COMPLETED statuses', async () => {
    (paypalGateway as any).clientId = 'sb-id';
    (paypalGateway as any).clientSecret = 'sb-secret';

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Mismatched order id
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 't1', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'OTHER-ORD', purchase_units: [] }), { status: 200 })
      );
    await expect(paypalGateway.captureOrder('ORD-REQ-1', { amount: 69, currency: 'USD' })).rejects.toThrow(/mismatch/i);

    // Missing capture id
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'ORD-REQ-2', purchase_units: [{ payments: { captures: [{}] } }] }), {
        status: 200,
      })
    );
    await expect(paypalGateway.captureOrder('ORD-REQ-2', { amount: 69, currency: 'USD' })).rejects.toThrow(
      /no valid capture ID/i
    );

    // PENDING status returned accurately rather than treated as COMPLETED
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'ORD-REQ-3',
          purchase_units: [
            {
              payments: {
                captures: [{ id: 'CAP-PEND-1', status: 'PENDING', amount: { value: '69.00', currency_code: 'USD' } }],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const pendingRes = await paypalGateway.captureOrder('ORD-REQ-3', { amount: 69, currency: 'USD' });
    expect(pendingRes.status).toBe('PENDING');
    expect(pendingRes.captureId).toBe('CAP-PEND-1');
  });
});
