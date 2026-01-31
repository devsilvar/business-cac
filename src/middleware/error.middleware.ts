import type { Request, Response, NextFunction } from 'express';
import { ApiError, sendError } from '../utils/error.util.js';
import { sanitizeError, sanitizeErrorDetails } from '../utils/errorSanitizer.util.js';
import config from '../config/index.js';

/**
 * Global error handling middleware
 * Handles ApiError instances and converts unknown errors to standardized format
 * All errors are sanitized to prevent exposing sensitive information
 */
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // If response already sent, delegate to default error handler
  if (res.headersSent) {
    return next(error);
  }

  // Log the error for debugging (only in development or when logging is enabled)
  if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'error') {
    console.error('[ERROR] Unhandled error:', {
      name: error.name,
      message: error.message,
      stack: config.isDevelopment ? error.stack : undefined,
      statusCode: (error as any).statusCode,
    });
  }

  // Handle our ApiError instances with sanitization
  if (error instanceof ApiError) {
    const sanitized = sanitizeError(error, config.isDevelopment);
    const details = sanitizeErrorDetails(error.details, config.isDevelopment);
    
    sendError(
      res,
      sanitized.code,
      config.isProduction ? sanitized.userMessage : sanitized.message,
      error.statusCode,
      details,
      req
    );
    return;
  }

  // Handle JSON parsing errors
  if (error instanceof SyntaxError && error.message.includes('JSON')) {
    sendError(
      res,
      'INVALID_JSON',
      'Invalid JSON in request body',
      400,
      config.isDevelopment ? { originalError: error.message } : undefined,
      req
    );
    return;
  }

  // Sanitize all other errors
  const sanitized = sanitizeError(error, config.isDevelopment);
  const statusCode = (error as any).statusCode || (sanitized.isOperational ? 400 : 500);

  sendError(
    res,
    sanitized.code,
    config.isProduction ? sanitized.userMessage : sanitized.message,
    statusCode,
    config.isDevelopment ? { originalError: error.message, stack: error.stack } : undefined,
    req
  );
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(
    res,
    'ROUTE_NOT_FOUND',
    `Route ${req.method} ${req.originalUrl} not found`,
    404,
    undefined,
    req
  );
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors automatically
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default {
  errorHandler,
  notFoundHandler,
  asyncHandler,
};