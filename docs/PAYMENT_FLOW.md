# FairResolve PayPal Payment & Refund Resolution Flow

## 1. End-to-End Operational Lifecycle

The FairResolve payment architecture links five discrete stages into a verifiable audit loop:
1. **Verified Checkout**: Orders v2 creates and captures payment with PayPal Sandbox.
2. **Dispute Ingestion**: Customer portal records structured claims and collects evidence.
3. **AI Multimodal Observation**: Gemini 3.8 Flash extracts optical evidence facts without authorizing money.
4. **Deterministic Policy Check**: Math and boolean rule engine independently checks eligibility.
5. **Merchant Authorization & Execution**: Operator authorizes captured refund with `PayPal-Request-Id` idempotency.

```
+----------+      +-------------+      +--------------+      +----------------+      +----------------+
| Customer |      | FairResolve |      | Gemini Flash |      | Policy Engine  |      | PayPal Sandbox |
+----+-----+      +------+------+      +-------+------+      +--------+-------+      +--------+-------+
     |                   |                     |                      |                       |
     | 1. Submit Dispute |                     |                      |                       |
     |------------------>|                     |                      |                       |
     |                   | 2. Run Multimodal   |                      |                       |
     |                   |-------------------->|                      |                       |
     |                   |    Observations     |                      |                       |
     |                   |<--------------------|                      |                       |
     |                   | 3. Evaluate Policy  |                      |                       |
     |                   |------------------------------------------->|                       |
     |                   |    Against Deterministic Rules             |                       |
     |                   |<-------------------------------------------|                       |
     |                   |                                                                    |
     |                   |--[ Merchant Reviews in Cockpit: Decides APPROVE ]                  |
     |                   |                                                                    |
     |                   | 4. Authorize Refund with PayPal-Request-Id                         |
     |                   |------------------------------------------------------------------->|
     |                   | 5. Return PayPal Refund ID (Irrevocable)                           |
     |                   |<-------------------------------------------------------------------|
     |                   |                                                                    |
     | 6. Notify Resolved| 6. Append Hash-Chained Audit Ledger Event                          |
     |<------------------|                                                                    |
```

---

## 2. Strict Idempotency Protocol (`PayPal-Request-Id`)

Network timeouts, browser double-clicks, and automated retries pose severe double-refund risks in financial systems. FairResolve addresses this at both the application layer and gateway layer:

### Client & Application Layer:
- An idempotency key with format `FR-PPR-<caseId>-<timestamp/hash>` is generated when the refund modal opens.
- The backend evaluates the idempotency key **prior** to any balance checks:
  ```typescript
  const existingAttempt = c.refundAttempts.find(
    (a) => a.idempotencyKey === key && a.status === 'SUCCEEDED'
  );
  if (existingAttempt) {
    return res.json({
      success: true,
      refundAttempt: existingAttempt,
      case: c,
      isDuplicateSubmission: true,
    });
  }
  ```

### Gateway Layer:
- Transmitted as the `PayPal-Request-Id` HTTP header to `https://api-m.sandbox.paypal.com/v2/payments/captures/{captureId}/refund`:
  ```typescript
  headers['PayPal-Request-Id'] = params.idempotencyKey;
  ```
- If PayPal has already executed this capture refund, it returns the existing resource without double debiting merchant funds.

---

## 3. Strict Live Guard (`PAYPAL_LIVE_ENABLED=false`)

FairResolve contains a hardcoded safety assertion in `src/server/paypalGateway.ts`:
```typescript
if (process.env.PAYPAL_LIVE_ENABLED === 'true') {
  throw new Error('SECURITY HALT: Live PayPal transactions are strictly prohibited in this environment.');
}
```
All API transactions are routed strictly to PayPal Sandbox:
- Endpoint: `https://api-m.sandbox.paypal.com`
- When unconfigured or running without network access: Uses high-fidelity simulation engine with prefix `SIM-SANDBOX-*` and `isSimulated: true`.
- Never displays fabricated live credentials.
