import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module.js';
import { IntegrationSyncService } from './integration-sync.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { GoogleCalendarAdapter } from './providers/google-calendar.adapter.js';
import { MicrosoftGraphAdapter } from './providers/microsoft-graph.adapter.js';

/**
 * Integration Centre: provider catalogue, OAuth connection handling and the
 * Google/Microsoft calendar synchronisation engine.
 */
@Module({
  imports: [JobsModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationSyncService,
    GoogleCalendarAdapter,
    MicrosoftGraphAdapter,
  ],
  exports: [IntegrationsService, IntegrationSyncService],
})
export class IntegrationsModule {}
