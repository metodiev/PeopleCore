/** Business error carrying a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(code, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super(code, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', code = 'NOT_FOUND') {
    super(code, `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(code, message, 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super('RATE_LIMITED', message, 429);
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, code = 'INTEGRATION_ERROR', details?: unknown) {
    super(code, message, 502, details);
  }
}

export class StorageError extends AppError {
  constructor(message: string, code = 'STORAGE_ERROR') {
    super(code, message, 500);
  }
}

/** Maps unknown thrown values to a consistent API error payload. */
export interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function messageFromPrismaMeta(meta: unknown, fallback: string): string {
  if (meta && typeof meta === 'object' && 'target' in meta) {
    const target = (meta as { target?: unknown }).target;
    const fields = Array.isArray(target) ? target.join(', ') : String(target ?? '');
    if (fields) return `Unique constraint violated for: ${fields}`;
  }
  return fallback;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }

  const candidate = error as { name?: string; code?: string; meta?: unknown };
  if (candidate?.name === 'PrismaClientKnownRequestError' && typeof candidate.code === 'string') {
    const prismaMeta = candidate.meta;
    switch (candidate.code) {
      case 'P2002':
        return {
          status: 409,
          code: 'DUPLICATE_RECORD',
          message: messageFromPrismaMeta(prismaMeta, 'A record with these values already exists'),
        };
      case 'P2003':
        return { status: 400, code: 'INVALID_REFERENCE', message: 'Related record does not exist' };
      case 'P2025':
        return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
      case 'P2000':
        return { status: 400, code: 'VALUE_TOO_LONG', message: 'A provided value is too long' };
      default:
        return { status: 500, code: `DATABASE_${candidate.code}`, message: 'Database operation failed' };
    }
  }

  if (candidate?.name === 'PrismaClientValidationError') {
    return { status: 400, code: 'INVALID_QUERY', message: 'Invalid query parameters' };
  }

  if (candidate?.name === 'PrismaClientInitializationError') {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
}
