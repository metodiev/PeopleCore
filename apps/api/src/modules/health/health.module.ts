import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { MetricsService } from './metrics.service.js';

@Global()
@Module({
  controllers: [HealthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class HealthModule {}
