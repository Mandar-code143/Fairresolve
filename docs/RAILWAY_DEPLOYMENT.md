# FairResolve — Railway Single-Instance Deployment Guide

This guide documents how to deploy FairResolve reliably on **Railway** as a single-instance hackathon prototype backed by managed **PostgreSQL 16** and a **Railway Persistent Volume**.

---

## 1. Deployment Topology

Deploy strictly with this topology for single-instance consistency:

1. **One Application Service** built from the repository [`Dockerfile`](../Dockerfile).
   - Runs Express REST API, built Vite React SPA, and in-process background outbox worker (`RUN_IN_PROCESS_WORKER=true`).
   - **Single Replica Only** (`Replicas = 1`) so uploaded private evidence binaries and SQLite/JSON mirrors stay aligned with the single attached volume.
2. **One Managed PostgreSQL Service** (PostgreSQL 16).
   - Authoritative source of truth for tenants, users, sessions, invitations, PayPal pending checkouts, orders, items, cases, customer tokens, evidence metadata, policy versions/evaluations, AI runs, four-eyes approvals, refund attempts, audit chain events, outbox jobs, and processed webhooks.
3. **One Persistent Volume** attached to the application service at **`/app/data`**.
   - Stores stripped private evidence images (`${FAIRRESOLVE_STORAGE_DIR}/private_uploads`) and durable JSON mirror (`fairresolve_db.json`).
   - At container startup, `docker-entrypoint.sh` creates `/app/data/private_uploads`, ensures `node:node` ownership on Railway's root-initialized volume mount, and drops privileges to non-root user `node` via `gosu`.

---

## 2. Step-by-Step Railway Provisioning

1. **Create a New Project** in Railway (`Deploy from GitHub repo` -> `Mandar-code143/Fairresolve`).
2. **Add PostgreSQL**: Click `+ Create` -> `Database` -> `Add PostgreSQL`.
3. **Attach Persistent Volume** to the FairResolve app service:
   - Mount Path: `/app/data`
4. **Configure Environment Variables** on the App service:

| Variable | Recommended Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enforces fail-fast PostgreSQL readiness & hardened cookie flags |
| `PORT` | `3000` | Matches `EXPOSE 3000` (or Railway's injected `$PORT`) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference variable from the Railway PostgreSQL service |
| `FAIRRESOLVE_STORAGE_DIR` | `/app/data` | Must match the Railway Volume mount path |
| `SERVICE_TYPE` | `app` | Runs web API + SPA |
| `RUN_IN_PROCESS_WORKER` | `true` | Runs the outbox worker inside the single app container |
| `DEMO_MODE` | `false` (or `true` for judge demo login) | Enables/disables `/api/v1/auth/demo-login` and demo accounts |
| `SESSION_SECRET` | 64-char random hex string | Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_BASE_URL` | `https://<your-domain>.up.railway.app` | Must match generated Railway public domain (no trailing slash) |
| `ALLOWED_ORIGINS` | `https://<your-domain>.up.railway.app` | Comma-separated origin allowlist for browser CORS |
| `PAYPAL_ENVIRONMENT` | `sandbox` | Architectural guardrail — never enable production PayPal |
| `PAYPAL_LIVE_ENABLED` | `false` | Hardcoded safety lock |
| `PAYPAL_CLIENT_ID` | Sandbox Client ID (optional) | If omitted, runs cleanly in explicit `SIMULATION_MODE` |
| `PAYPAL_CLIENT_SECRET` | Sandbox Client Secret (optional) | Server-side secret only |
| `PAYPAL_WEBHOOK_ID` | Sandbox Webhook ID (optional) | Required if receiving PayPal webhooks |
| `GEMINI_API_KEY` | Gemini API key (optional) | If omitted, uses honest deterministic policy fallback |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Recommended Gemini model |

5. **Configure Railway Healthcheck**:
   - **Healthcheck Path**: `/health/ready`
   - Wait until `/health/ready` returns HTTP `200` with `postgresActive: true`, `postgresPingOk: true`, `storageWritable: true`, `workerActive: true`, and `migrationVersion >= 3`.

---

## 3. PayPal Sandbox Setup

1. Create a Sandbox App in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
2. Copy Sandbox **Client ID** and **Client Secret** into Railway env vars `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. In your Railway domain dashboard, register a Sandbox Webhook pointing to:
   ```
   https://<your-domain>.up.railway.app/api/v1/webhooks/paypal
   ```
   Set the generated Webhook ID into `PAYPAL_WEBHOOK_ID`.
4. After deployment, open FairResolve -> **PayPal Gateway** tab and click **Test Sandbox Connectivity** to confirm `SANDBOX_AUTHENTICATED`.

---

## 4. Database Migrations

FairResolve automatically runs sequential, transactional, advisory-locked SQL migrations from [`src/server/database/migrations.ts`](../src/server/database/migrations.ts) on startup before listening for traffic:

- **v1 (`001_initial_schema`)**: Core relational tables (`tenants`, `users`, `sessions`, `invitations`, `orders`, `order_items`, `policies`, `cases`, `customer_access_tokens`, `evidence_objects`, `policy_evaluations`, `ai_runs`, `refund_approvals`, `refund_attempts`, `audit_events`, `outbox_events`, `paypal_webhook_events`).
- **v2 (`002_refund_status_compatibility`)**: Ensures `refund_attempts` status constraint accepts `'SUCCEEDED'` and legacy `'COMPLETED'`, normalizes legacy `'COMPLETED'` rows cleanly on load, and guarantees `refund_approvals` expiry/policy columns exist.
- **v3 (`003_pending_checkouts`)**: Adds durable `pending_checkouts` table & indexes for verified two-step PayPal checkout and return/cancel state tokens.

---

## 5. Verification Checklist After Railway Deploy

1. `GET https://<your-domain>.up.railway.app/health/ready` returns `200 OK` with `status: "ready"`, `postgresActive: true`, `migrationVersion: 3`, `storageWritable: true`, `workerActive: true`.
2. Sign in or register an OWNER account.
3. Run a two-step checkout (create order -> approve in Sandbox or simulated capture -> capture) and verify redirect lands back on FairResolve with captured Order + Case.
4. Submit customer claim via dispute link (`/portal/<token>`) with a JPEG/PNG image upload, then redeploy/restart container and confirm order, case, and image preview persist across restarts.
5. Approve refund with Reviewer/Owner, attempt self-execution (expect 403 block), execute with second Admin/Owner, and inspect PostgreSQL ledger & audit integrity (`/api/v1/audit/verify`).
