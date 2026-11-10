/**
 * Standalone Worker Runner
 *
 * Runs the durable outbox worker loop in a dedicated process container.
 */

import dotenv from 'dotenv';
import { db } from './database';
import { backgroundWorker } from './worker';

dotenv.config();

async function main() {
  console.log('[WorkerRunner] Initializing database connection and running migrations...');
  await db.waitForReady();
  console.log('[WorkerRunner] Database schema and outbox ready. Starting background outbox worker...');

  backgroundWorker.start();

  const handleShutdown = async (signal: string) => {
    console.log(`[WorkerRunner] Received ${signal}. Shutting down worker...`);
    await backgroundWorker.stopAndWait();
    await db.flush();
    await db.closePool();
    console.log('[WorkerRunner] Worker gracefully exited.');
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[WorkerRunner] Fatal unhandled error:', err);
  process.exit(1);
});
