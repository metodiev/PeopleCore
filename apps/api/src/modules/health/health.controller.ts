import { Controller, Get, Header, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { HealthStatus } from '@peoplecore/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MetricsService } from './metrics.service.js';

const VERSION = process.env['npm_package_version'] ?? '1.0.0';

@ApiTags('health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe — verifies the database connection' })
  async ready(): Promise<HealthStatus> {
    const started = Date.now();
    const databaseUp = await this.prisma.ping();
    return {
      status: databaseUp ? 'ok' : 'down',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database: {
          status: databaseUp ? 'up' : 'down',
          latencyMs: Date.now() - started,
        },
        queues: {
          status: this.config.redisUrl ? 'up' : 'down',
          message: this.config.redisUrl ? 'Redis configured' : 'REDIS_URL not set — jobs run in-process',
        },
      },
    };
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics' })
  async metricsEndpoint(@Res() response: Response): Promise<void> {
    const databaseUp = await this.prisma.ping();
    const gauges = [
      MetricsService.gauge('peoplecore_database_up', 'Database reachability (1 = up)', {}, databaseUp ? 1 : 0),
    ];
    response.send(this.metrics.render(gauges));
  }
}
