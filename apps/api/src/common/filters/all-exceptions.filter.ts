import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@peoplecore/shared';
import { mapError } from '../errors/app-error.js';
import { currentContext } from '../../prisma/request-context.js';

/**
 * Single place where errors become HTTP responses. Every failure — domain
 * errors, Prisma errors, validation errors, unexpected exceptions — leaves the
 * API with the same envelope:
 * `{ statusCode, error: { code, message, details? }, path, timestamp, requestId }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let code: string;
    let message: string;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = defaultCodeForStatus(status);
      } else {
        const record = body as { message?: string | string[]; error?: string; code?: string };
        const rawMessage = record.message;
        message = Array.isArray(rawMessage) ? rawMessage.join('; ') : (rawMessage ?? exception.message);
        code = record.code ?? defaultCodeForStatus(status);
        if (Array.isArray(rawMessage)) details = rawMessage;
      }
    } else {
      const mapped = mapError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
      details = mapped.details;
    }

    const context = currentContext();
    const requestId = context?.requestId;

    if (status >= 500) {
      this.logger.error(
        `[${requestId ?? '-'}] ${request.method} ${request.originalUrl} → ${status} ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.debug(`[${requestId ?? '-'}] ${request.method} ${request.originalUrl} → ${status} ${code}`);
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId,
    };

    response.status(status).json(payload);
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
