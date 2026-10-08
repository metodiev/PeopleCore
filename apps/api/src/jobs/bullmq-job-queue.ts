import { Logger } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { EnqueueOptions, JobHandler, JobPayload, JobQueuePort } from './jobs.port.js';

/** Single queue shared by every feature module; jobs are multiplexed by name. */
export const JOBS_QUEUE_NAME = 'peoplecore';

/**
 * Redis-backed job queue (BullMQ + ioredis).
 *
 * A worker is started inside the API process and dispatches every job to the
 * handler registered under its name. Recurring jobs are registered through
 * `upsertJobScheduler`, so the schedule survives restarts and is shared by all
 * replicas (BullMQ guarantees a single execution per interval).
 */
export class BullMqJobQueue implements JobQueuePort {
  readonly kind = 'bullmq' as const;
  private readonly logger = new Logger(BullMqJobQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly handlers = new Map<string, JobHandler>();

  constructor(redisUrl: string) {
    // Workers must keep retrying on connection loss; the default (20) aborts
    // blocking commands after a few seconds and breaks long-running workers.
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.connection.on('error', (error: Error) => this.logger.error(`Redis connection error: ${error.message}`));

    this.queue = new Queue(JOBS_QUEUE_NAME, { connection: this.connection });
    this.queue.on('error', (error: Error) => this.logger.error(`Job queue error: ${error.message}`));

    this.worker = new Worker(JOBS_QUEUE_NAME, (job: Job) => this.dispatch(job), { connection: this.connection });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Job "${job?.name ?? 'unknown'}" failed (attempt ${job?.attemptsMade ?? 0})`, error);
    });
  }

  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`Overriding the handler registered for job "${name}"`);
    }
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, payload: JobPayload = {}, options: EnqueueOptions = {}): Promise<void> {
    await this.queue.add(name, payload, {
      jobId: options.jobId,
      delay: options.delayMs && options.delayMs > 0 ? options.delayMs : undefined,
      // Failed jobs are retried with exponential backoff; the owning handler
      // is expected to be idempotent (all of ours are).
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 86_400, count: 5_000 },
    });
  }

  async schedule(name: string, pattern: string, payload: JobPayload = {}): Promise<void> {
    await this.queue.upsertJobScheduler(
      `schedule:${name}`,
      { pattern },
      { name, data: payload, opts: { removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } } },
    );
  }

  async close(): Promise<void> {
    await this.worker.close().catch(() => undefined);
    await this.queue.close().catch(() => undefined);
    await this.connection.quit().catch(() => undefined);
    this.handlers.clear();
  }

  private async dispatch(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      this.logger.warn(`No handler registered for job "${job.name}" — skipping`);
      return;
    }
    await handler((job.data ?? {}) as JobPayload);
  }
}
