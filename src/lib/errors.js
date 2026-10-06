/** Operational error with an HTTP status and a stable, machine-readable code. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const insufficientCredits = (message = 'Not enough credits') => new AppError(402, 'INSUFFICIENT_CREDITS', message);
export const notFound = (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found`);
export const conflict = (message) => new AppError(409, 'CONFLICT', message);
