# FairResolve Deployment & Operations Manual

## 1. Environment Configuration Catalog

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | Optional | `3000` | Port for Express API server & Vite development middleware |
| `NODE_ENV` | Optional | `development` | Runtime mode (`development` or `production`) |
| `PAYPAL_CLIENT_ID` | Optional | Unset | PayPal Developer Sandbox App Client ID |
| `PAYPAL_CLIENT_SECRET` | Optional | Unset | PayPal Developer Sandbox App Secret |
| `PAYPAL_WEBHOOK_ID` | Optional | Unset | Webhook ID for signature verification |
| `PAYPAL_LIVE_ENABLED` | Mandatory | `false` | Hardcoded security guard. Must remain `false`. |
| `GEMINI_API_KEY` | Optional | User Secret | Google Gemini API Key for multimodal investigation (`gemini-3.8-flash`) |
| `APP_URL` | Optional | Auto-injected | Public Cloud Run host URL |
| `DATABASE_URL` | Optional | File-backed | Connection string for production PostgreSQL instance |

---

## 2. Docker Compose Deployment

A turnkey `docker-compose.yml` is provided at the root of the repository:

```bash
# Start FairResolve with persistent volumes
docker-compose up -d --build

# View application logs
docker-compose logs -f app
```

---

## 3. Production Health Probes

FairResolve exposes two standard health endpoints for container orchestrators (Kubernetes / Cloud Run):

### Liveness Probe (`GET /health/live`)
Returns HTTP 200 with process uptime:
```json
{
  "status": "ok",
  "uptime": 142.3
}
```

### Readiness Probe (`GET /health/ready`)
Verifies that database state is loaded and services are ready to accept traffic:
```json
{
  "status": "ready",
  "timestamp": "2026-11-07T05:00:00.000Z",
  "durableDatabaseLoaded": true,
  "paypalConfigured": true,
  "aiAvailable": true
}
```

---

## 4. Production PostgreSQL Schema Migration

To deploy with an enterprise PostgreSQL instance, execute the following DDL:

```sql
-- Tenants & RBAC Users
CREATE TABLE tenants (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE users (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(32) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
```
