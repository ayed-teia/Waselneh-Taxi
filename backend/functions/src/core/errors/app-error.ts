import { HttpsError, FunctionsErrorCode } from 'firebase-functions/v2/https';

export class AppError extends Error {
  constructor(
    public readonly code: FunctionsErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }

  toHttpsError(): HttpsError {
    return new HttpsError(this.code, this.message, this.details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('invalid-argument', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super('not-found', id ? `${resource} with id '${id}' not found` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('unauthenticated', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super('permission-denied', message);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('already-exists', message);
    this.name = 'ConflictError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super('internal', message);
    this.name = 'InternalError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, public readonly service: string) {
    super('unavailable', `${service}: ${message}`);
    this.name = 'ExternalServiceError';
  }
}

export function handleError(error: unknown): HttpsError {
  if (error instanceof AppError) {
    return error.toHttpsError();
  }

  if (error instanceof HttpsError) {
    return error;
  }

  console.error('Unhandled error:', error);
  return new HttpsError('internal', 'An unexpected error occurred');
}
