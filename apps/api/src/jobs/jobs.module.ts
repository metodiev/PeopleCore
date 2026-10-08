import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/configuration.js';
import { BullMqJobQueue } from './bullmq-job-queue.js';
import { InlineJobQueue } from './inline-job-queue.js';
import { JOB_QUEUE, type JobQueuePort } from './jobs.port.js';

/**
 * Provides the {@link JobQueuePort} used by every feature module.
 *
 * With `REDIS_URL` set the application runs a real BullMQ queue (with a worker
 * in-process); otherwise it falls back to the inline adapter, which executes
 * handlers immediately and is documented as development/testing only.
 */
@Global()
@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): JobQueuePort =>
        config.redisUrl ? new BullMqJobQueue(config.redisUrl) : new InlineJobQueue(),
    },
  ],
  exports: [JOB_QUEUE],
})
export class JobsModule implements OnModuleDestroy {
  private readonly logger = new Logger(JobsModule.name);

  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueuePort) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close?.().catch((error: unknown) => {
      this.logger.error('Failed to close the job queue cleanly', error as Error);
    });
  }
}

export { JOB_QUEUE } from './jobs.port.js';
export type { JobHandler, JobPayload, JobQueue, JobQueuePort } from './jobs.port.js';
