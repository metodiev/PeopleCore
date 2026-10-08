import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { SearchService } from './search.service.js';
import { SearchQueryDto } from './dto/search.dto.js';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions('search.global')
  @ApiOperation({
    summary: 'Global search across people, org structure and records',
    description:
      'Returns results grouped per entity type. Groups the caller cannot access are skipped; people-related results follow the caller’s data scope.',
  })
  run(@CurrentPrincipal() principal: Principal, @Query() query: SearchQueryDto) {
    return this.search.search(principal, query);
  }
}
