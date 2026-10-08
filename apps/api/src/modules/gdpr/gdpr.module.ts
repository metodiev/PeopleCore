import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller.js';
import { GdprService } from './gdpr.service.js';

/**
 * GDPR module.
 *
 * Retention is executed by the daily scheduler (`GdprService.applyRetention`);
 * the scheduler job lives with the other background jobs so the module stays
 * importable from tests without starting timers.
 */
@Module({
  controllers: [GdprController],
  providers: [GdprService],
  exports: [GdprService],
})
export class GdprModule {}
