import { Module } from '@nestjs/common';
import { JobsModule } from '../../jobs/jobs.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';
import { RemindersService } from './reminders.service.js';
import { EnvironmentSmsPort, SmsPort } from './sms.port.js';

/**
 * Notifications: in-app/email/push/SMS delivery, the per-user preference
 * matrix, push device registry, event fan-out and the daily reminder sweep.
 */
@Module({
  imports: [JobsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    RemindersService,
    { provide: SmsPort, useClass: EnvironmentSmsPort },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
