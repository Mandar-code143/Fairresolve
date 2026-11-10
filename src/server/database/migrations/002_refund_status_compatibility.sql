-- Migration 002: Refund Attempt Status Compatibility ('SUCCEEDED' + 'COMPLETED'),
-- Refund Approval EXPIRED status, and Audit/Approval Relational Columns

ALTER TABLE refund_attempts DROP CONSTRAINT IF EXISTS refund_attempts_status_check;
ALTER TABLE refund_attempts DROP CONSTRAINT IF EXISTS chk_refund_attempts_status;
ALTER TABLE refund_attempts ADD CONSTRAINT chk_refund_attempts_status CHECK (
    status IN ('CREATED', 'RESERVED', 'SUBMITTED', 'PENDING', 'SUCCEEDED', 'COMPLETED', 'FAILED', 'UNKNOWN', 'RECONCILIATION_REQUIRED')
);

ALTER TABLE refund_attempts ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(128);
ALTER TABLE refund_attempts ADD COLUMN IF NOT EXISTS approver_id VARCHAR(64);
ALTER TABLE refund_attempts ADD COLUMN IF NOT EXISTS executor_id VARCHAR(64);

ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS refund_approvals_status_check;
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS chk_refund_approvals_status;
ALTER TABLE refund_approvals ADD CONSTRAINT chk_refund_approvals_status CHECK (
    status IN ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED', 'SUPERSEDED')
);

ALTER TABLE refund_approvals ADD COLUMN IF NOT EXISTS order_id VARCHAR(64);
ALTER TABLE refund_approvals ADD COLUMN IF NOT EXISTS policy_evaluation_id VARCHAR(64);
ALTER TABLE refund_approvals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE refund_approvals ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE invitations ALTER COLUMN name SET DEFAULT '';
