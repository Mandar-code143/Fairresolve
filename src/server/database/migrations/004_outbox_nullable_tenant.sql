-- Migration 004: Allow nullable tenant_id on outbox_events for system-level webhook tasks

ALTER TABLE outbox_events ALTER COLUMN tenant_id DROP NOT NULL;
