/**
 * FairResolve Authoritative Database Export
 *
 * Consolidates the relational persistence layer into a single source of truth.
 * Re-exports the unified Database instance and all relational entities.
 */

export { db } from '../database';
export type { Database, Session, UserAccount, OutboxEvent, DatabaseSchema } from '../database';
export * from './types';
