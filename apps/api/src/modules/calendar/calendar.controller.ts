import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { CalendarService } from './calendar.service.js';
import {
  CalendarEventQueryDto,
  CreateCalendarDto,
  CreateCalendarEventDto,
  HolidayQueryDto,
  RespondToEventDto,
  UpdateCalendarDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto.js';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendars')
export class CalendarsController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'Calendars visible to the caller (with their event counts)' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.calendar.listCalendars(principal);
  }

  @Post()
  @RequirePermissions('calendar.manage')
  @Audited('Calendar')
  @ApiOperation({ summary: 'Create a personal, company, department or team calendar' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCalendarDto) {
    return this.calendar.createCalendar(principal, dto);
  }

  @Patch(':id')
  @RequirePermissions('calendar.manage')
  @Audited('Calendar')
  @ApiOperation({ summary: 'Update a calendar' })
  update(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCalendarDto) {
    return this.calendar.updateCalendar(principal, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('calendar.manage')
  @Audited('Calendar')
  @ApiOperation({ summary: 'Delete a calendar and its events (the default calendar is protected)' })
  remove(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.deleteCalendar(principal, id);
  }
}

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('events')
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'Events in a date range, with holidays as read-only entries' })
  events(@CurrentPrincipal() principal: Principal, @Query() query: CalendarEventQueryDto) {
    return this.calendar.listEvents(principal, query);
  }

  @Post('events')
  @RequirePermissions('calendar.manage')
  @Audited('CalendarEvent')
  @ApiOperation({ summary: 'Create an event with attendees and an optional recurrence rule' })
  createEvent(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCalendarEventDto) {
    return this.calendar.createEvent(principal, dto);
  }

  @Patch('events/:id')
  @RequirePermissions('calendar.manage')
  @Audited('CalendarEvent')
  @ApiOperation({ summary: 'Update an event' })
  updateEvent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendar.updateEvent(principal, id, dto);
  }

  @Delete('events/:id')
  @RequirePermissions('calendar.manage')
  @Audited('CalendarEvent')
  @ApiOperation({ summary: 'Cancel an event (soft delete)' })
  cancelEvent(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.cancelEvent(principal, id);
  }

  @Post('events/:id/respond')
  @RequirePermissions('calendar.view')
  @Audited('EventAttendee')
  @ApiOperation({ summary: 'Accept, decline or tentatively accept an invitation' })
  respond(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondToEventDto,
  ) {
    return this.calendar.respondToEvent(principal, id, dto);
  }

  @Get('holidays')
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'Company holidays for a year (recurring holidays included)' })
  holidays(@Query() query: HolidayQueryDto) {
    return this.calendar.listHolidays(query);
  }
}
