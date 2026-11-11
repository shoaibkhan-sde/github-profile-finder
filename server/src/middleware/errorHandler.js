import { logger } from '../utils/logger.js';

/**
 * Central Error Handler Middleware.
 * Never leaks stack traces, internal paths, or credentials to client responses.
 */
export function errorHandler(err, req, res, _next) {
  logger.error(`Error processing request: ${err.message}`, err.status || 500);

  const statusCode = err.statusCode || err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    error: err.name || 'InternalServerError',
    message: statusCode === 500 && isProduction
      ? 'An unexpected error occurred while processing your request.'
      : err.message,
    ...(err.retryAfter && { retryAfter: err.retryAfter }),
    ...(err.rateLimitReset && { rateLimitReset: err.rateLimitReset })
  });
}

