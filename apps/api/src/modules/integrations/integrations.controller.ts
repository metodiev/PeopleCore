import { Controller, Delete, Get, Inject, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal } from '@peoplecore/shared';
import { AppError } from '../../common/errors/app-error.js';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { Audited } from '../audit/audited.decorator.js';
import { IntegrationsService } from './integrations.service.js';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @RequirePermissions('integrations.view')
  @ApiOperation({ summary: 'Integration catalogue with the tenant’s connection status' })
  catalog(@CurrentPrincipal() principal: Principal) {
    return this.integrations.catalog(principal);
  }

  @Get('status')
  @RequirePermissions('integrations.view')
  @ApiOperation({ summary: 'Connection status, last sync and mapped record counts' })
  status(@CurrentPrincipal() principal: Principal) {
    return this.integrations.status(principal);
  }

  @Post(':provider/connect')
  @RequirePermissions('calendar.sync')
  @Audited('IntegrationConnection')
  @ApiOperation({ summary: 'Start the OAuth flow to connect a calendar provider (returns the authorization URL)' })
  connect(@CurrentPrincipal() principal: Principal, @Param('provider') provider: string) {
    return this.integrations.startConnect(principal, provider);
  }

  @Post(':provider/sync')
  @RequirePermissions('calendar.sync')
  @Audited('IntegrationConnection')
  @ApiOperation({ summary: 'Queue a synchronization run for the provider' })
  sync(@CurrentPrincipal() principal: Principal, @Param('provider') provider: string) {
    return this.integrations.requestSync(principal, provider);
  }

  @Delete(':provider')
  @RequirePermissions('calendar.sync')
  @Audited('IntegrationConnection')
  @ApiOperation({ summary: 'Disconnect the provider and revoke its sync mappings' })
  disconnect(@CurrentPrincipal() principal: Principal, @Param('provider') provider: string) {
    return this.integrations.disconnect(principal, provider);
  }

  /**
   * OAuth redirect target. It is reached by the browser (no bearer token), so
   * failures are reported through the front-end URL instead of a JSON error.
   */
  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth callback for a calendar provider' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const result = await this.integrations.completeCallback(provider, code, state);
      response.redirect(302, result.redirectUrl);
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : 'OAUTH_CALLBACK_FAILED';
      this.logger.warn(`OAuth callback failed for ${provider}: ${errorCode}`);
      const base = this.config.webAppUrl.replace(/\/+$/, '');
      response.redirect(302, `${base}/integrations?error=${encodeURIComponent(errorCode)}`);
    }
  }
}
