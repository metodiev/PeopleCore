/**
 * Background job abstraction.
 *
 * Feature modules depend on {@link JobQueuePort} (injected through the
 * {@link JOB_QUEUE} token) instead of a concrete queue so the application can
 * run with a real Redis-backed queue in production and with an inline
 * (microtask) adapter in development and tests.
 */

/** Injection token for the active {@link JobQueuePort}. */
export const JOB_QUEUE = Symbol('JOB_QUEUE');

/** JSON-serializable payload carried by a job. */
export type JobPayload = Record<string, unknown>;

export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface EnqueueOptions {
  /** Milliseconds to wait before the job becomes runnable. */
  delayMs?: number;
  /** Deduplication key — a job with an existing id is not enqueued twice. */
  jobId?: string;
}

export type JobQueueKind = 'bullmq' | 'inline';

export interface JobQueuePort {
  /** Backend in use: a real Redis queue or the in-process development adapter. */
  readonly kind: JobQueueKind;
  enqueue(name: string, payload?: JobPayload, options?: EnqueueOptions): Promise<void>;
  register(name: string, handler: JobHandler): void;
  /**
   * Registers a cron-style repeating job. Only a real queue persists the
   * schedule; the inline adapter ignores it (the owning service triggers the
   * work through `@nestjs/schedule` instead).
   */
  schedule?(name: string, pattern: string, payload?: JobPayload): Promise<void>;
  /** Releases queue connections; called on application shutdown. */
  close?(): Promise<void>;
}

/** Alias kept for readability at injection sites. */
export type JobQueue = JobQueuePort;
