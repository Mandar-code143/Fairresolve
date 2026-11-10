-- Migration 003: Durable Pending Checkout Lifecycle Table

CREATE TABLE IF NOT EXISTS pending_checkouts (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paypal_order_id VARCHAR(128) UNIQUE,
    order_number VARCHAR(128) NOT NULL,
    product_type VARCHAR(64) NOT NULL,
    product_sku VARCHAR(64) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    shipping_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_amount_cents >= 0),
    gross_amount_cents BIGINT NOT NULL CHECK (gross_amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    buyer_name VARCHAR(255),
    buyer_email VARCHAR(255),
    state_token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CAPTURED', 'CANCELLED', 'EXPIRED', 'FAILED')),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    approve_url TEXT,
    captured_order_id VARCHAR(64) REFERENCES orders(id) ON DELETE SET NULL,
    captured_case_id VARCHAR(64) REFERENCES cases(id) ON DELETE SET NULL,
    failure_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    captured_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_checkouts_paypal_order ON pending_checkouts(paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_pending_checkouts_state_hash ON pending_checkouts(state_token_hash);
CREATE INDEX IF NOT EXISTS idx_pending_checkouts_tenant ON pending_checkouts(tenant_id, status);
