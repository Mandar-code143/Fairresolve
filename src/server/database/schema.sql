-- =============================================================================
-- FairResolve PostgreSQL Relational Database Schema
-- Multi-Tenant Customer Dispute Investigation & PayPal Refund Management
-- =============================================================================

-- Enable UUID extension if supported
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS CONTROL
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'REVIEWER', 'ANALYST', 'VIEWER')),
    password_hash VARCHAR(255) NOT NULL,
    password_salt VARCHAR(128) NOT NULL,
    avatar_url TEXT,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'REVIEWER', 'ANALYST', 'VIEWER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_membership UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address VARCHAR(64),
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invitations (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'REVIEWER', 'ANALYST', 'VIEWER')),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    invited_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- 2. PAYPAL INTEGRATION & ORDERS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS paypal_connections (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(32) NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox')),
    client_id_masked VARCHAR(64) NOT NULL,
    client_secret_hash VARCHAR(64),
    webhook_id VARCHAR(128),
    last_verified_at TIMESTAMPTZ,
    oauth_status VARCHAR(32) NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (oauth_status IN ('NOT_CONFIGURED', 'VERIFIED', 'FAILED')),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    paypal_order_id VARCHAR(128) NOT NULL,
    paypal_capture_id VARCHAR(128) NOT NULL,
    order_number VARCHAR(128) NOT NULL,
    buyer_name VARCHAR(255) NOT NULL,
    buyer_email VARCHAR(255) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    gross_amount_cents BIGINT NOT NULL CHECK (gross_amount_cents >= 0),
    shipping_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (shipping_amount_cents >= 0),
    refunded_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount_cents >= 0),
    refundable_amount_cents BIGINT NOT NULL CHECK (refundable_amount_cents >= 0),
    shipping_carrier VARCHAR(64),
    tracking_number VARCHAR(128),
    tracking_synthetic BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_date TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_order_number UNIQUE (tenant_id, order_number),
    CONSTRAINT chk_order_refund_balance CHECK (refunded_amount_cents + refundable_amount_cents = gross_amount_cents)
);

CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    total_price_cents BIGINT NOT NULL CHECK (total_price_cents >= 0),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------------
-- 3. DISPUTE CASES & POLICIES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS policies (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL,
    return_window_days INT NOT NULL DEFAULT 30,
    require_packaging_photo_for_damage BOOLEAN NOT NULL DEFAULT TRUE,
    require_label_photo_for_wrong_item BOOLEAN NOT NULL DEFAULT TRUE,
    carrier_delivery_verification_days INT NOT NULL DEFAULT 3,
    max_instant_refund_cents BIGINT NOT NULL DEFAULT 25000,
    mandatory_return_threshold_cents BIGINT NOT NULL DEFAULT 20000,
    allow_partial_refunds_without_return BOOLEAN NOT NULL DEFAULT TRUE,
    max_partial_refund_percentage INT NOT NULL DEFAULT 50 CHECK (max_partial_refund_percentage BETWEEN 0 AND 100),
    flag_duplicate_evidence_hash BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    published_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_policy_version UNIQUE (tenant_id, version)
);

CREATE TABLE IF NOT EXISTS cases (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    case_number VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_number VARCHAR(128) NOT NULL,
    paypal_order_id VARCHAR(128) NOT NULL,
    paypal_capture_id VARCHAR(128) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'NEW' CHECK (
        status IN (
            'NEW', 'AWAITING_EVIDENCE', 'ANALYZING', 'READY_FOR_REVIEW',
            'NEEDS_MORE_INFORMATION', 'ESCALATED', 'APPROVED_PENDING_REFUND',
            'REFUND_SUBMITTED', 'REFUND_PENDING', 'REFUND_UNKNOWN',
            'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED', 'REJECTED', 'CLOSED'
        )
    ),
    issue_type VARCHAR(32) NOT NULL CHECK (issue_type IN ('damaged_item', 'wrong_item', 'item_not_received')),
    requested_resolution VARCHAR(32) NOT NULL DEFAULT 'full_refund' CHECK (
        requested_resolution IN ('full_refund', 'partial_refund', 'replacement', 'store_credit')
    ),
    customer_description TEXT NOT NULL,
    merchant_notes TEXT,
    assigned_to VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_case_number UNIQUE (tenant_id, case_number)
);

CREATE TABLE IF NOT EXISTS customer_access_tokens (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS evidence_objects (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    width INT,
    height INT,
    sha256_hash VARCHAR(64) NOT NULL,
    is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    scan_status VARCHAR(32) NOT NULL DEFAULT 'unscanned' CHECK (scan_status IN ('clean', 'unscanned', 'suspicious', 'quarantined')),
    evidence_type VARCHAR(32) NOT NULL DEFAULT 'item_photo' CHECK (
        evidence_type IN ('item_photo', 'packaging_photo', 'shipping_label', 'other')
    ),
    caption TEXT,
    thumbnail_path TEXT,
    uploaded_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policy_evaluations (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    policy_version VARCHAR(32) NOT NULL,
    result VARCHAR(64) NOT NULL CHECK (
        result IN (
            'ELIGIBLE_FOR_MERCHANT_REVIEW',
            'MORE_INFORMATION_REQUIRED',
            'INELIGIBLE_UNDER_CONFIGURED_POLICY',
            'MANUAL_REVIEW_REQUIRED'
        )
    ),
    eligible_amount_cents BIGINT,
    missing_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    rules_evaluated JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_runs (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    model_used VARCHAR(64) NOT NULL,
    analysis_status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    customer_claim TEXT NOT NULL,
    reported_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_observations JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_information JSONB NOT NULL DEFAULT '[]'::jsonb,
    inconsistencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    policy_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
    recommended_next_step VARCHAR(64) NOT NULL,
    explanation TEXT NOT NULL,
    is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- 4. FINANCIAL APPROVALS & REFUNDS
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS refund_approvals (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    authorized_by VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_amount_cents BIGINT NOT NULL CHECK (approved_amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    capture_id VARCHAR(128) NOT NULL,
    case_version VARCHAR(32) NOT NULL DEFAULT 'v1',
    policy_version VARCHAR(32) NOT NULL,
    notes TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVOKED', 'SUPERSEDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refund_attempts (
    id VARCHAR(64) PRIMARY KEY,
    case_id VARCHAR(64) NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    approval_id VARCHAR(64) REFERENCES refund_approvals(id) ON DELETE SET NULL,
    capture_id VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'RESERVED' CHECK (
        status IN ('CREATED', 'RESERVED', 'SUBMITTED', 'PENDING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'RECONCILIATION_REQUIRED')
    ),
    paypal_refund_id VARCHAR(128),
    paypal_response JSONB,
    error_code VARCHAR(64),
    error_message TEXT,
    authorized_by_user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- 5. AUDIT LEDGER, OUTBOX & WEBHOOKS
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    case_id VARCHAR(64) REFERENCES cases(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('MERCHANT', 'CUSTOMER', 'SYSTEM', 'AI_ENGINE', 'PAYPAL_GATEWAY')),
    actor_id VARCHAR(64),
    actor_name VARCHAR(255) NOT NULL,
    actor_role VARCHAR(32),
    summary TEXT NOT NULL,
    details JSONB,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    idempotency_key VARCHAR(128),
    correlation_id VARCHAR(128),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paypal_webhook_events (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(128) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(128),
    summary TEXT,
    verification_status VARCHAR(32) NOT NULL CHECK (verification_status IN ('VERIFIED', 'FAILED', 'UNVERIFIED')),
    raw_payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- 6. INDEXES FOR HIGH-THROUGHPUT PERFORMANCE
-- -------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_capture ON orders(paypal_capture_id);
CREATE INDEX IF NOT EXISTS idx_cases_tenant_status ON cases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_order ON cases(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_tokens ON customer_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence_objects(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence_objects(tenant_id, sha256_hash);
CREATE INDEX IF NOT EXISTS idx_refund_attempts_case ON refund_attempts(case_id);
CREATE INDEX IF NOT EXISTS idx_refund_attempts_idemp ON refund_attempts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_case ON audit_events(tenant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, next_attempt_at) WHERE status = 'PENDING';
