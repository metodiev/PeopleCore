import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { AuditService } from './audit.service.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Query the immutable audit trail' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: AuditQueryDto) {
    return this.audit.list(principal.tenantId!, query);
  }
}
