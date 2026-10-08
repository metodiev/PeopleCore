import { Logger } from '@nestjs/common';
import type { EnqueueOptions, JobHandler, JobPayload, JobQueuePort } from './jobs.port.js';

/**
 * In-process job queue for development and tests.
 *
 * Handlers run on the microtask queue (or a timer when a delay is requested),
 * which means jobs are executed inside the API process, are lost on restart
 * and do not survive horizontal scaling. Never use this adapter as a
 * production queue — set `REDIS_URL` to switch to the BullMQ adapter. Recurring
 * schedules are ignored; the owning service must trigger them through
 * `@nestjs/schedule`.
 */
export class InlineJobQueue implements JobQueuePort {
  readonly kind = 'inline' as const;
  private readonly logger = new Logger(InlineJobQueue.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`Overriding the handler registered for job "${name}"`);
    }
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, payload: JobPayload = {}, options: EnqueueOptions = {}): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.warn(`No handler registered for job "${name}" — job ignored`);
      return;
    }

    const run = (): void => {
      void handler(payload).catch((error: unknown) => {
        this.logger.error(`Inline job "${name}" failed`, error as Error);
      });
    };

    if (options.delayMs && options.delayMs > 0) {
      setTimeout(run, options.delayMs).unref();
      return;
    }
    queueMicrotask(run);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
