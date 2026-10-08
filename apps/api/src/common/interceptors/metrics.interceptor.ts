import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, tap } from 'rxjs';
import { MetricsService } from '../../modules/health/metrics.service.js';

/** Records request counts and latency for the Prometheus endpoint. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; route?: { path?: string }; path: string }>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.record(request, response, startedAt),
        error: () => this.record(request, response, startedAt),
      }),
    );
  }

  private record(
    request: { method: string; route?: { path?: string }; path: string },
    response: Response,
    startedAt: bigint,
  ): void {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = `${request.method} ${request.route?.path ?? request.path}`;
    const labels = { method: request.method, route, status: String(response.statusCode) };
    this.metrics.increment('peoplecore_http_requests_total', labels);
    this.metrics.observe('peoplecore_http_request_duration_seconds', seconds, labels);
    if (response.statusCode >= 400) {
      this.metrics.increment('peoplecore_http_request_errors_total', labels);
    }
  }
}
