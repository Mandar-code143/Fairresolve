/**
 * FairResolve Versioned PostgreSQL Migration Runner
 *
 * Ensures all schema versions are applied sequentially, idempotently,
 * and safely protected against concurrent startup execution.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

export interface MigrationDefinition {
  version: number;
  name: string;
  apply: (client: pg.PoolClient) => Promise<void>;
}

const MIGRATION_LOCK_KEY = 84729103;
const currentModuleDir =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

function resolveSchemaSqlPath(): string {
  const candidates = [
    path.resolve(currentModuleDir, 'schema.sql'),
    path.resolve(currentModuleDir, 'database', 'schema.sql'),
    path.resolve(currentModuleDir, '../src/server/database/schema.sql'),
    path.resolve(currentModuleDir, '../../src/server/database/schema.sql'),
    path.resolve(process.cwd(), 'src/server/database/schema.sql'),
    path.resolve(process.cwd(), 'dist/database/schema.sql'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`schema.sql not found. Checked: ${candidates.join(', ')}`);
  }
  return found;
}

function resolveMigrationFile(filename: string): string {
  const candidates = [
    path.resolve(currentModuleDir, 'migrations', filename),
    path.resolve(currentModuleDir, 'database', 'migrations', filename),
    path.resolve(currentModuleDir, '../src/server/database/migrations', filename),
    path.resolve(currentModuleDir, '../../src/server/database/migrations', filename),
    path.resolve(process.cwd(), 'src/server/database/migrations', filename),
    path.resolve(process.cwd(), 'dist/database/migrations', filename),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Migration SQL file ${filename} not found. Checked: ${candidates.join(', ')}`);
  }
  return fs.readFileSync(found, 'utf-8');
}

export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: 'initial_relational_schema',
    apply: async (client: pg.PoolClient) => {
      const baseExists = await client
        .query("SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants'")
        .then((r) => r.rows.length > 0)
        .catch(() => false);
      if (baseExists) {
        return;
      }
      const schemaPath = resolveSchemaSqlPath();
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await client.query(sql);
    },
  },
  {
    version: 2,
    name: 'refund_status_compatibility_and_columns',
    apply: async (client: pg.PoolClient) => {
      // Dynamically drop any pre-existing auto-named CHECK constraints on status (safe across PostgreSQL versions)
      const hasGetConstraintDef = await client
        .query("SELECT 1 FROM pg_proc WHERE proname = 'pg_get_constraintdef'")
        .then((r) => r.rows.length > 0)
        .catch(() => false);

      if (hasGetConstraintDef) {
        const conRes = await client.query(`
          SELECT t.relname AS table_name, c.conname AS constraint_name
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname IN ('refund_attempts', 'refund_approvals')
            AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) ILIKE '%status%'
        `);
        for (const row of conRes.rows) {
          const tbl = row.table_name;
          const con = row.constraint_name;
          if (/^[a-zA-Z0-9_]+$/.test(tbl) && /^[a-zA-Z0-9_]+$/.test(con)) {
            await client.query(`ALTER TABLE "${tbl}" DROP CONSTRAINT IF EXISTS "${con}"`);
          }
        }
      }

      const sql = resolveMigrationFile('002_refund_status_compatibility.sql');
      await client.query(sql);
    },
  },
  {
    version: 3,
    name: 'pending_checkouts_table',
    apply: async (client: pg.PoolClient) => {
      const tableCheck = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_checkouts'"
      );
      if (tableCheck.rows.length === 0) {
        const sql = resolveMigrationFile('003_pending_checkouts.sql');
        await client.query(sql);
      }
    },
  },
  {
    version: 4,
    name: 'outbox_nullable_tenant',
    apply: async (client: pg.PoolClient) => {
      const colRes = await client
        .query(
          "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'outbox_events' AND column_name = 'tenant_id'"
        )
        .catch(() => ({ rows: [] as any[] }));
      const isNullable = String(colRes.rows[0]?.is_nullable || '').toUpperCase();
      if (isNullable === 'NO') {
        const sql = resolveMigrationFile('004_outbox_nullable_tenant.sql');
        await client.query(sql);
      }
    },
  },
];

export const REQUIRED_TABLES = [
  'tenants',
  'users',
  'sessions',
  'invitations',
  'orders',
  'order_items',
  'policies',
  'cases',
  'customer_access_tokens',
  'evidence_objects',
  'policy_evaluations',
  'ai_runs',
  'refund_approvals',
  'refund_attempts',
  'pending_checkouts',
  'audit_events',
  'outbox_events',
  'paypal_webhook_events',
  'schema_migrations',
];

export async function runMigrations(pool: pg.Pool): Promise<{ appliedVersions: number[] }> {
  const client = await pool.connect();
  let lockAcquired = false;
  const appliedVersions: number[] = [];

  try {
    // Check if PostgreSQL advisory lock is available (true on real Postgres, false on pg-mem)
    const lockSupported = await client
      .query("SELECT 1 FROM pg_proc WHERE proname = 'pg_advisory_lock'")
      .then((r) => r.rows.length > 0)
      .catch(() => false);

    if (lockSupported) {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      lockAcquired = true;
    }

    const migTableExists = await client
      .query("SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'")
      .then((r) => r.rows.length > 0)
      .catch(() => false);

    if (!migTableExists) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    const appliedRes = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
    const appliedSet = new Set<number>(appliedRes.rows.map((r: any) => Number(r.version)));

    const sorted = [...MIGRATIONS].sort((a, b) => a.version - b.version);

    for (const migration of sorted) {
      if (appliedSet.has(migration.version)) {
        continue;
      }

      await client.query('BEGIN');
      try {
        await migration.apply(client);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
        appliedVersions.push(migration.version);
        console.log(`[Migrations] Applied v${migration.version}: ${migration.name}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }

    return { appliedVersions };
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
    client.release();
  }
}

export async function verifyRequiredTables(pool: pg.Pool): Promise<string[]> {
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const existing = new Set(res.rows.map((r: any) => r.table_name));
  return REQUIRED_TABLES.filter((t) => !existing.has(t));
}
