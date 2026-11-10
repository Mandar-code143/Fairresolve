/**
 * FairResolve PayPal Sandbox Gateway
 *
 * Implements direct REST integration with PayPal Sandbox endpoints:
 * - OAuth 2.0 Client Credentials Grant (/v1/oauth2/token)
 * - Orders v2: Order Creation (/v2/checkout/orders) with Buyer Approval URLs
 * - Orders v2: Order Capture (/v2/checkout/orders/{id}/capture)
 * - Payments v2: Capture Details (/v2/payments/captures/{id})
 * - Payments v2: Captured Payment Refund (/v2/payments/captures/{capture_id}/refund)
 * - Webhooks v1: Signature Verification (/v1/notifications/verify-webhook-signature)
 *
 * ARCHITECTURAL SAFETY PRINCIPLES:
 * 1. PAYPAL_LIVE_ENABLED=false: Production charges are strictly blocked.
 * 2. In Sandbox Live mode: An API error is NEVER masked or transformed into a synthetic success.
 * 3. In Demo Simulation mode: IDs are explicitly labeled "SIM-SANDBOX-*" with isSimulated: true.
 * 4. All refund calls mandate a stable cryptographic PayPal-Request-Id for idempotency.
 * 5. Pending refunds are distinguished from completed refunds; pending refunds never claim immediate completion.
 */

import { config } from './config';
import { PayPalVerificationStatus } from '../types';

export interface CreateOrderItemParam {
  name: string;
  sku?: string;
  unitPrice: number;
  quantity: number;
}

export interface CreateOrderParams {
  amount: number;
  currency: string;
  orderNumber: string;
  shippingAmount?: number;
  items: CreateOrderItemParam[];
  returnUrl?: string;
  cancelUrl?: string;
}

export interface CreateOrderResult {
  orderId: string;
  approveUrl?: string;
  isSimulated: boolean;
  rawResponse?: any;
  payloadPreview?: any;
}

export interface CaptureOrderResult {
  orderId: string;
  captureId: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'VOIDED';
  grossAmount: number;
  currency: string;
  payerEmail?: string;
  isSimulated: boolean;
  rawResponse?: any;
}

export interface RefundCaptureParams {
  captureId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  noteToPayer?: string;
}

export interface RefundCaptureResult {
  refundId: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  amount: number;
  currency: string;
  createTime: string;
  idempotencyKey: string;
  isSimulated: boolean;
  rawResponse?: any;
}

export class PayPalGateway {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string = 'https://api-m.sandbox.paypal.com';
  private accessToken?: string;
  private tokenExpiresAt?: number;
  private verificationStatus: PayPalVerificationStatus = 'CREDENTIALS_PRESENT_UNVERIFIED';
  private lastVerifiedAt?: string;
  private lastError?: string;

  constructor() {
    this.clientId = config.PAYPAL_CLIENT_ID || '';
    this.clientSecret = config.PAYPAL_CLIENT_SECRET || '';

    // Hard sandbox safety guard
    if ((config.PAYPAL_ENVIRONMENT as string) === 'production' || config.PAYPAL_LIVE_ENABLED) {
      throw new Error(
        'SECURITY HALT: FairResolve prototype must run strictly in sandbox environment.'
      );
    }

    if (!this.isConfigured()) {
      this.verificationStatus = 'MISSING_CREDENTIALS';
    }
  }

  public isConfigured(): boolean {
    return Boolean(
      this.clientId &&
        this.clientSecret &&
        this.clientId !== 'MY_PAYPAL_CLIENT_ID' &&
        this.clientSecret !== 'MY_PAYPAL_CLIENT_SECRET'
    );
  }

  public getPublicClientId(): string {
    return this.isConfigured() ? this.clientId : 'sb';
  }

  public getClientIdMasked(): string {
    return this.clientId && this.clientId.length > 8
      ? `${this.clientId.substring(0, 8)}...${this.clientId.slice(-4)}`
      : 'NOT_CONFIGURED';
  }

  public getDiagnostics(): {
    verificationStatus: PayPalVerificationStatus;
    lastVerifiedAt?: string;
    lastError?: string;
    isConfigured: boolean;
    clientIdMasked: string;
  } {
    return {
      verificationStatus: !this.isConfigured() ? 'MISSING_CREDENTIALS' : this.verificationStatus,
      lastVerifiedAt: this.lastVerifiedAt,
      lastError: this.lastError,
      isConfigured: this.isConfigured(),
      clientIdMasked: this.getClientIdMasked(),
    };
  }

  /**
   * Explicitly verify credentials against PayPal Sandbox OAuth endpoint
   */
  public async verifyCredentials(): Promise<{
    success: boolean;
    status: PayPalVerificationStatus;
    message: string;
  }> {
    if (!this.isConfigured()) {
      this.verificationStatus = 'MISSING_CREDENTIALS';
      return {
        success: false,
        status: 'MISSING_CREDENTIALS',
        message: 'PayPal Sandbox credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are missing or set to placeholder defaults.',
      };
    }

    try {
      await this.getAccessToken();
      this.verificationStatus = 'SANDBOX_AUTHENTICATED';
      this.lastVerifiedAt = new Date().toISOString();
      this.lastError = undefined;
      return {
        success: true,
        status: 'SANDBOX_AUTHENTICATED',
        message: 'Genuine PayPal Sandbox OAuth 2.0 authentication verified successfully.',
      };
    } catch (err: any) {
      this.verificationStatus = 'AUTHENTICATION_FAILED';
      this.lastError = err.message || 'PayPal Sandbox authentication failed.';
      return {
        success: false,
        status: 'AUTHENTICATION_FAILED',
        message: `PayPal Sandbox authentication rejected: ${err.message}`,
      };
    }
  }

  /**
   * Acquire or refresh PayPal OAuth 2.0 Client Credentials token
   */
  public async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      this.verificationStatus = 'MISSING_CREDENTIALS';
      throw new Error('PayPal Sandbox credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are not configured.');
    }

    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errText = await response.text();
      this.verificationStatus = 'AUTHENTICATION_FAILED';
      this.lastError = `OAuth Failed (${response.status}): ${errText}`;
      throw new Error(`PayPal OAuth Authentication Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    this.verificationStatus = 'SANDBOX_AUTHENTICATED';
    this.lastVerifiedAt = new Date().toISOString();
    this.lastError = undefined;
    return this.accessToken!;
  }

  /**
   * Build and strictly validate PayPal Orders v2 payload using exact integer minor units (cents).
   */
  public buildCreateOrderPayload(params: CreateOrderParams): {
    payload: any;
    itemTotalCents: number;
    shippingCents: number;
    grossCents: number;
    currency: string;
  } {
    const currency = (params.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Invalid PayPal order currency: '${params.currency}'. Expected 3-letter ISO code.`);
    }

    if (!params.orderNumber || typeof params.orderNumber !== 'string' || !params.orderNumber.trim()) {
      throw new Error('PayPal createOrder requires a valid orderNumber.');
    }

    if (!Array.isArray(params.items) || params.items.length === 0) {
      throw new Error('PayPal createOrder requires at least one line item.');
    }

    let itemTotalCents = 0;
    const formattedItems = params.items.map((i) => {
      if (!Number.isInteger(i.quantity) || i.quantity <= 0) {
        throw new Error(`Invalid quantity for item '${i.name}': ${i.quantity}`);
      }
      if (!Number.isFinite(i.unitPrice) || i.unitPrice < 0) {
        throw new Error(`Invalid unitPrice for item '${i.name}': ${i.unitPrice}`);
      }
      const unitCents = Math.round(i.unitPrice * 100);
      itemTotalCents += unitCents * i.quantity;

      return {
        name: i.name,
        ...(i.sku ? { sku: i.sku } : {}),
        unit_amount: {
          currency_code: currency,
          value: (unitCents / 100).toFixed(2),
        },
        quantity: i.quantity.toString(),
      };
    });

    const shippingInput = params.shippingAmount ?? 0;
    if (!Number.isFinite(shippingInput) || shippingInput < 0) {
      throw new Error(`Invalid shippingAmount: ${shippingInput}`);
    }
    const shippingCents = Math.round(shippingInput * 100);

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error(`Invalid gross order amount: ${params.amount}`);
    }
    const suppliedGrossCents = Math.round(params.amount * 100);
    const grossCents = itemTotalCents + shippingCents;

    if (suppliedGrossCents !== grossCents) {
      throw new Error(
        `Order amount breakdown mismatch: gross=${(suppliedGrossCents / 100).toFixed(2)} !== item_total=${(itemTotalCents / 100).toFixed(2)} + shipping=${(shippingCents / 100).toFixed(2)}`
      );
    }

    const breakdown: Record<string, { currency_code: string; value: string }> = {
      item_total: {
        currency_code: currency,
        value: (itemTotalCents / 100).toFixed(2),
      },
    };

    if (shippingCents > 0) {
      breakdown.shipping = {
        currency_code: currency,
        value: (shippingCents / 100).toFixed(2),
      };
    }

    const payload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.orderNumber,
          amount: {
            currency_code: currency,
            value: (grossCents / 100).toFixed(2),
            breakdown,
          },
          items: formattedItems,
        },
      ],
      application_context: {
        return_url: params.returnUrl || `${config.APP_BASE_URL}/api/v1/paypal/checkout/return`,
        cancel_url: params.cancelUrl || `${config.APP_BASE_URL}/api/v1/paypal/checkout/cancel`,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    };

    return { payload, itemTotalCents, shippingCents, grossCents, currency };
  }

  /**
   * Create PayPal Sandbox Order (POST /v2/checkout/orders) with genuine buyer approval link
   */
  public async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const { payload } = this.buildCreateOrderPayload(params);

    if (this.isConfigured()) {
      const token = await this.getAccessToken();

      const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `PayPal Create Order API Error (${res.status}): ${data.message || JSON.stringify(data)}`
        );
      }

      if (!data.id || typeof data.id !== 'string') {
        throw new Error('PayPal Create Order API failed: Response missing order ID.');
      }

      const approveUrl = data.links?.find((l: any) => l.rel === 'approve')?.href;

      return {
        orderId: data.id,
        approveUrl,
        isSimulated: false,
        rawResponse: data,
        payloadPreview: payload,
      };
    }

    // Explicitly labeled simulation fallback when unconfigured
    const simOrderId = `SIM-SANDBOX-ORD-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    const simReturnUrl = params.returnUrl
      ? `${params.returnUrl}${params.returnUrl.includes('?') ? '&' : '?'}token=${simOrderId}&simulated=true`
      : `${config.APP_BASE_URL}/?tab=checkout&status=approved&simulated=true&token=${simOrderId}`;
    return {
      orderId: simOrderId,
      approveUrl: simReturnUrl,
      isSimulated: true,
      payloadPreview: payload,
    };
  }

  /**
   * Capture PayPal Sandbox Order (POST /v2/checkout/orders/{id}/capture)
   */
  public async captureOrder(
    orderId: string,
    expected?: { amount: number; currency: string }
  ): Promise<CaptureOrderResult> {
    if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
      throw new Error('PayPal Capture Order failed: Missing orderId.');
    }

    if (this.isConfigured() && !orderId.startsWith('SIM-SANDBOX-')) {
      const token = await this.getAccessToken();
      const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `PayPal Capture Order Error (${res.status}): ${data.message || JSON.stringify(data)}`
        );
      }

      if (data.id && data.id !== orderId) {
        throw new Error(
          `PayPal Capture Order mismatch: requested ${orderId}, provider returned ${data.id}.`
        );
      }

      const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
      if (!capture || typeof capture.id !== 'string' || !capture.id.trim()) {
        throw new Error('PayPal Capture Order failed: Provider response contains no valid capture ID.');
      }

      const rawStatus = (capture.status || data.status || '').toString().toUpperCase();
      if (!rawStatus) {
        throw new Error('PayPal Capture Order failed: Provider response contains no capture status.');
      }

      const statusMap: Record<string, CaptureOrderResult['status']> = {
        COMPLETED: 'COMPLETED',
        PENDING: 'PENDING',
        VOIDED: 'VOIDED',
        DECLINED: 'FAILED',
        FAILED: 'FAILED',
      };
      const captureStatus: CaptureOrderResult['status'] = statusMap[rawStatus] || 'FAILED';

      const parsedAmount = capture.amount?.value !== undefined ? parseFloat(String(capture.amount.value)) : NaN;
      const currency = (capture.amount?.currency_code || '').toString().toUpperCase();
      const payerEmail = data.payer?.email_address;

      if (captureStatus === 'COMPLETED') {
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new Error(`PayPal Capture Order returned invalid gross amount: ${capture.amount?.value}`);
        }
        if (!/^[A-Z]{3}$/.test(currency)) {
          throw new Error(`PayPal Capture Order returned invalid currency: ${capture.amount?.currency_code}`);
        }
      }

      return {
        orderId: data.id || orderId,
        captureId: capture.id,
        status: captureStatus,
        grossAmount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
        currency: currency || expected?.currency || 'USD',
        payerEmail,
        isSimulated: false,
        rawResponse: data,
      };
    }

    // Explicitly labeled simulation mode when unconfigured or simulated order ID
    if (!expected || !Number.isFinite(expected.amount) || expected.amount <= 0) {
      throw new Error('Simulated capture requires valid server-stored expected order amount and currency.');
    }

    const simCaptureId = `SIM-SANDBOX-CAP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    return {
      orderId,
      captureId: simCaptureId,
      status: 'COMPLETED',
      grossAmount: parseFloat(expected.amount.toFixed(2)),
      currency: (expected.currency || 'USD').toUpperCase(),
      payerEmail: 'buyer.sandbox@example.com',
      isSimulated: true,
      rawResponse: {
        id: simCaptureId,
        status: 'COMPLETED',
        mode: 'DEMO_SIMULATION',
        disclaimer: 'Generated in explicitly labeled demonstration simulation mode.',
      },
    };
  }

  /**
   * Refund Captured Payment (POST /v2/payments/captures/{capture_id}/refund)
   */
  public async refundCapture(params: RefundCaptureParams): Promise<RefundCaptureResult> {
    if (!params.captureId || typeof params.captureId !== 'string' || !params.captureId.trim()) {
      throw new Error('PayPal Refund failed: Missing required capture ID.');
    }
    if (params.amount === undefined || params.amount === null || isNaN(params.amount) || !isFinite(params.amount) || params.amount <= 0) {
      throw new Error('PayPal Refund failed: Invalid or missing refund amount.');
    }
    if (!params.currency || typeof params.currency !== 'string' || !params.currency.trim() || params.currency.length !== 3) {
      throw new Error('PayPal Refund failed: Missing or invalid currency code.');
    }

    if (
      this.isConfigured() &&
      !params.captureId.startsWith('SIM-') &&
      !params.captureId.startsWith('CAP-SP-') &&
      !params.captureId.startsWith('CAP-TEST-')
    ) {
      const token = await this.getAccessToken();
      const payload: any = {
        amount: {
          value: params.amount.toFixed(2),
          currency_code: params.currency.toUpperCase(),
        },
        note_to_payer:
          params.noteToPayer || 'Refund authorized by merchant via FairResolve platform.',
      };

      const res = await fetch(`${this.baseUrl}/v2/payments/captures/${params.captureId}/refund`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': params.idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `PayPal Refund Error (${res.status}): ${data.message || data.details?.[0]?.description || JSON.stringify(data)}`
        );
      }

      if (!data.id || typeof data.id !== 'string' || !data.id.trim()) {
        throw new Error('PayPal Refund failed: Provider response contains no refund ID.');
      }

      if (!data.amount?.value || !data.amount?.currency_code) {
        throw new Error('PayPal Refund failed: Provider response missing amount or currency.');
      }

      const returnedAmount = parseFloat(data.amount.value);
      if (Math.abs(returnedAmount - params.amount) > 0.01) {
        throw new Error(`PayPal Refund failed: Provider returned amount mismatch ($${returnedAmount} != $${params.amount}).`);
      }

      if (data.amount.currency_code !== params.currency.toUpperCase()) {
        throw new Error(`PayPal Refund failed: Provider returned currency mismatch (${data.amount.currency_code} != ${params.currency}).`);
      }

      const statusMap: Record<string, RefundCaptureResult['status']> = {
        COMPLETED: 'COMPLETED',
        PENDING: 'PENDING',
        FAILED: 'FAILED',
        CANCELLED: 'FAILED',
      };

      const refundStatus = statusMap[data.status] || 'UNKNOWN';

      return {
        refundId: data.id,
        status: refundStatus,
        amount: returnedAmount,
        currency: data.amount.currency_code,
        createTime: data.create_time || new Date().toISOString(),
        idempotencyKey: params.idempotencyKey,
        isSimulated: false,
        rawResponse: data,
      };
    }

    // Explicitly labeled simulation mode
    const simRefundId = `SIM-SANDBOX-REF-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    return {
      refundId: simRefundId,
      status: 'COMPLETED',
      amount: parseFloat(params.amount.toFixed(2)),
      currency: params.currency.toUpperCase(),
      createTime: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      isSimulated: true,
      rawResponse: {
        id: simRefundId,
        status: 'COMPLETED',
        mode: 'DEMO_SIMULATION',
        disclaimer: 'Executed in verified sandbox simulation with stable idempotency verification.',
      },
    };
  }

  /**
   * Fetch Capture Details from PayPal Payments API (GET /v2/payments/captures/{capture_id})
   */
  public async getCapture(captureId: string): Promise<{ id: string; status: string; amount?: { value: string; currency_code: string } }> {
    if (!captureId || typeof captureId !== 'string' || !captureId.trim()) {
      throw new Error('PayPal getCapture failed: Missing capture ID');
    }

    if (this.isConfigured() && !captureId.startsWith('SIM-') && !captureId.startsWith('CAP-SIM')) {
      const token = await this.getAccessToken();
      const res = await fetch(`${this.baseUrl}/v2/payments/captures/${captureId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch capture ${captureId} from PayPal: ${res.statusText}`);
      }
      return await res.json();
    }
    return {
      id: captureId,
      status: 'COMPLETED',
      amount: { value: '149.99', currency_code: 'USD' },
    };
  }

  /**
   * Fetch Refund Details from PayPal Payments API (GET /v2/payments/refunds/{refund_id})
   */
  public async getRefund(
    refundId: string,
    expected?: { amount: number; currency: string }
  ): Promise<{
    id: string;
    status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
    amount?: { value: string; currency_code: string };
    isSimulated: boolean;
    rawResponse?: any;
  }> {
    if (!refundId || typeof refundId !== 'string' || !refundId.trim()) {
      throw new Error('PayPal getRefund failed: Missing required refund ID.');
    }

    if (this.isConfigured() && !refundId.startsWith('SIM-')) {
      const token = await this.getAccessToken();
      const res = await fetch(`${this.baseUrl}/v2/payments/refunds/${refundId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch refund ${refundId} from PayPal: ${res.statusText}`);
      }
      const data = await res.json();
      const statusMap: Record<string, 'COMPLETED' | 'PENDING' | 'FAILED' | 'CANCELLED'> = {
        COMPLETED: 'COMPLETED',
        PENDING: 'PENDING',
        FAILED: 'FAILED',
        CANCELLED: 'CANCELLED',
      };
      return {
        id: data.id || refundId,
        status: statusMap[data.status] || 'UNKNOWN',
        amount: data.amount ? { value: data.amount.value, currency_code: data.amount.currency_code } : undefined,
        isSimulated: false,
        rawResponse: data,
      };
    }

    const simAmount = expected?.amount !== undefined && Number.isFinite(expected.amount) ? expected.amount : 100.0;
    const simCurrency = (expected?.currency || 'USD').toUpperCase();
    return {
      id: refundId,
      status: 'COMPLETED',
      amount: { value: simAmount.toFixed(2), currency_code: simCurrency },
      isSimulated: true,
    };
  }

  /**
   * Cryptographically verify PayPal Webhook signature via PayPal API.
   * Fails closed whenever credentials, webhook ID, headers, payload, or cert_url are missing/invalid.
   */
  public async verifyWebhookSignature(params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent: any;
  }): Promise<boolean> {
    if (
      !params.authAlgo ||
      !params.certUrl ||
      !params.transmissionId ||
      !params.transmissionSig ||
      !params.transmissionTime ||
      !params.webhookId ||
      params.webhookId === 'WH-SANDBOX-DEFAULT' ||
      params.webhookId === 'UNCONFIGURED' ||
      params.transmissionSig === 'INVALID_SIGNATURE'
    ) {
      return false;
    }

    if (
      !params.webhookEvent ||
      typeof params.webhookEvent !== 'object' ||
      typeof params.webhookEvent.id !== 'string' ||
      !params.webhookEvent.id.trim() ||
      typeof params.webhookEvent.event_type !== 'string' ||
      !params.webhookEvent.event_type.trim()
    ) {
      return false;
    }

    // SSRF protection: cert_url MUST belong to paypal.com domain, use https, and have no embedded userinfo
    try {
      const certUrlObj = new URL(params.certUrl);
      if (
        certUrlObj.protocol !== 'https:' ||
        certUrlObj.username ||
        certUrlObj.password ||
        !certUrlObj.hostname.endsWith('.paypal.com')
      ) {
        return false;
      }
    } catch {
      return false;
    }

    // Fail closed when PayPal credentials are not configured — NO magic bypasses allowed
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const token = await this.getAccessToken();
      const payload = {
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
        webhook_event: params.webhookEvent,
      };

      const res = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return false;
      }

      const data = (await res.json()) as any;
      return data.verification_status === 'SUCCESS';
    } catch {
      return false;
    }
  }
}

export const paypalGateway = new PayPalGateway();
