import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { UsersService } from './users.service.js';
import { AssignRolesDto, CreateUserDto, InviteUserDto, UpdateUserDto, UserQueryDto } from './dto/user.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'List user accounts in the company' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: UserQueryDto) {
    return this.users.list(principal.tenantId!, query);
  }

  @Get('invitations')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'List pending invitations' })
  invitations() {
    return this.users.listInvitations();
  }

  @Post('invitations')
  @RequirePermissions('users.manage')
  @Audited('UserInvitation')
  @ApiOperation({ summary: 'Invite a user by email' })
  invite(@CurrentPrincipal() principal: Principal, @Body() dto: InviteUserDto) {
    return this.users.invite(
      principal.tenantId!,
      dto,
      principal.userId,
      `${principal.firstName} ${principal.lastName}`,
    );
  }

  @Delete('invitations/:id')
  @RequirePermissions('users.manage')
  @Audited('UserInvitation')
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revokeInvitation(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.users.revokeInvitation(principal.tenantId!, id, principal.userId);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'Get a user account' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.users.get(principal.tenantId!, id);
  }

  @Post()
  @RequirePermissions('users.manage')
  @Audited('User')
  @ApiOperation({ summary: 'Create a user account (optionally with a password)' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateUserDto) {
    return this.users.create(principal.tenantId!, dto, principal.userId, { verifyEmail: true });
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @Audited('User')
  @ApiOperation({ summary: 'Update a user account' })
  update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(principal.tenantId!, id, dto, principal.userId);
  }

  @Post(':id/roles')
  @RequirePermissions('users.manage')
  @Audited('User')
  @ApiOperation({ summary: 'Replace the roles of a user' })
  assignRoles(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: AssignRolesDto) {
    return this.users.assignRoles(principal.tenantId!, id, dto.roleKeys, principal.userId);
  }

  @Delete(':id')
  @RequirePermissions('users.manage')
  @Audited('User')
  @ApiOperation({ summary: 'Disable and delete a user account (soft delete)' })
  remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.users.remove(principal.tenantId!, id, principal.userId);
  }

  @Get(':id/sessions')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'List active sessions of a user' })
  sessions(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.users.sessions(principal.tenantId!, id);
  }

  @Delete(':id/sessions/:sessionId')
  @RequirePermissions('users.manage')
  @Audited('Session')
  @ApiOperation({ summary: 'Force-revoke a user session' })
  revokeSession(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.users.revokeUserSession(id, sessionId, principal.userId);
  }
}
