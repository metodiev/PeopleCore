import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { Audited } from '../audit/audited.decorator.js';
import {
  BroadcastNotificationDto,
  NotificationQueryDto,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

const SORTABLE = ['createdAt'] as const;

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.self.manage')
  @ApiOperation({ summary: 'My notifications (paginated, optionally unread only)' })
  async list(@CurrentPrincipal() principal: Principal, @Query() query: NotificationQueryDto): Promise<Paginated<unknown>> {
    const options = buildQueryOptions(query, SORTABLE);
    const { rows, total } = await this.notifications.listForUser(
      principal.userId,
      { unreadOnly: query.unreadOnly, type: query.type },
      options,
    );
    return paginate(rows, total, query);
  }

  @Post('read-all')
  @RequirePermissions('notifications.self.manage')
  @ApiOperation({ summary: 'Mark every unread notification as read' })
  readAll(@CurrentPrincipal() principal: Principal) {
    return this.notifications.markAllRead(principal.userId);
  }

  @Post(':id/read')
  @RequirePermissions('notifications.self.manage')
  @ApiOperation({ summary: 'Mark one of my notifications as read' })
  read(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(principal.userId, id);
  }

  @Get('preferences')
  @RequirePermissions('notifications.self.manage')
  @ApiOperation({ summary: 'My notification preference matrix (event type × channel)' })
  preferences(@CurrentPrincipal() principal: Principal) {
    return this.notifications.preferenceMatrix(principal.userId);
  }

  @Put('preferences')
  @RequirePermissions('notifications.self.manage')
  @Audited('NotificationPreference')
  @ApiOperation({ summary: 'Update notification preferences (mandatory events cannot be disabled)' })
  updatePreferences(@CurrentPrincipal() principal: Principal, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(principal.userId, dto.preferences);
  }

  @Post('devices')
  @RequirePermissions('notifications.self.manage')
  @Audited('PushDevice')
  @ApiOperation({ summary: 'Register an Expo push token for the current user' })
  registerDevice(@CurrentPrincipal() principal: Principal, @Body() dto: RegisterPushDeviceDto) {
    return this.notifications.registerDevice({ userId: principal.userId, tenantId: principal.tenantId! }, dto);
  }

  @Delete('devices/:token')
  @RequirePermissions('notifications.self.manage')
  @Audited('PushDevice')
  @ApiOperation({ summary: 'Remove one of the current user’s push tokens' })
  removeDevice(@CurrentPrincipal() principal: Principal, @Param('token') token: string) {
    return this.notifications.removeDevice(principal.userId, token);
  }

  @Post('broadcast')
  @RequirePermissions('notifications.manage')
  @Audited('Notification')
  @ApiOperation({ summary: 'Send a notification to all users, roles or selected employees' })
  broadcast(@CurrentPrincipal() principal: Principal, @Body() dto: BroadcastNotificationDto) {
    return this.notifications.broadcast(principal.tenantId!, {
      type: dto.type ?? 'employee.welcome',
      title: dto.title,
      body: dto.body,
      data: dto.data,
      roleKeys: dto.roleKeys,
      employeeIds: dto.employeeIds,
    });
  }
}
