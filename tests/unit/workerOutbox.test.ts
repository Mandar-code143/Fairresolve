import { describe, it, expect } from 'vitest';
import { BackgroundWorker } from '../../src/server/worker';
import { db } from '../../src/server/database';

describe('Transactional Outbox Worker & Dead-Letter Handling', () => {
  it('enqueues events with PENDING status and scheduled nextAttemptAt', () => {
    const worker = new BackgroundWorker();
    const event = worker.enqueue({
      eventType: 'AI_INVESTIGATION',
      tenantId: 'tenant-apex-101',
      payload: { caseId: 'case-test-123' },
      runAfterSeconds: 10,
    });

    expect(event.id).toMatch(/^obx-/);
    expect(event.status).toBe('PENDING');
    expect(event.attempts).toBe(0);
    expect(event.retryCount).toBe(0);
    expect(event.nextAttemptAt).toBeDefined();
    expect(new Date(event.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('rejects unhandled or unknown event types without silent failure', async () => {
    const worker = new BackgroundWorker();
    const unknownEvent = worker.enqueue({
      eventType: 'UNSUPPORTED_MALFORMED_EVENT',
      tenantId: 'tenant-apex-101',
      payload: { test: true },
      runAfterSeconds: 0,
    });

    // Directly invoke processEvent (internal task handler)
    await expect((worker as any).processEvent(unknownEvent)).rejects.toThrow(
      'Unsupported or unknown outbox event type: UNSUPPORTED_MALFORMED_EVENT'
    );
  });
});
