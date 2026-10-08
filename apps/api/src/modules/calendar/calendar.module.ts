import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { CalendarController, CalendarsController } from './calendar.controller.js';
import { CalendarListener } from './calendar.listener.js';
import { CalendarService } from './calendar.service.js';

/**
 * Calendars, events, holidays and leave mirroring. OAuth-based synchronisation
 * with Google/Microsoft lives in the integrations module.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [CalendarsController, CalendarController],
  providers: [CalendarService, CalendarListener],
  exports: [CalendarService],
})
export class CalendarModule {}
