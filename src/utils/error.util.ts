import type { Response, Request } from 'express';

/**
 * Standardized API Response Formats
 * 
 * All responses follow a consistent structure:
 * - Success: { success: true, data: {...}, requestId, timestamp }
 * - Error: { success: false, error: { code, message, details }, requestId, timestamp }
 */

/**
 * Standard success response
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  requestId?: string;
  timestamp?: string;
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  requestId?: string;
  timestamp?: string;
}

/**
 * Helper to get requestId from request
 */
function getRequestId(req?: Request | { requestId?: string }): string {
  return req?.requestId || 'unknown';
}

/**
 * Send success response with consistent format
 */
export function sendOk<T = any>(
  res: Response,
  data: T,
  status = 200,
  req?: Request | { requestId?: string }
): Response {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    requestId: getRequestId(req),
    timestamp: new Date().toISOString(),
  };
  return res.status(status).json(response);
}

/**
 * Send error response with consistent format
 */
export function sendError(
  res: Response,
  code: string,
  message: string,
  status = 400,
  details?: any,
  req?: Request | { requestId?: string }
): Response {
  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    requestId: getRequestId(req),
    timestamp: new Date().toISOString(),
  };
  return res.status(status).json(response);
}

/**
 * ApiError class for throwing typed errors
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: any,
    public userMessage?: string
  ) {
    super(message);
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Send this error as a response
   * Note: Error sanitization is handled by the error middleware
   */
  send(res: Response, req?: Request | { requestId?: string }): Response {
    return sendError(res, this.code, this.message, this.statusCode, this.details, req);
  }

  /**
   * Factory methods for common errors
   */
  static badRequest(message: string, details?: any): ApiError {
    return new ApiError('BAD_REQUEST', message, 400, details);
  }

  static unauthorized(message: string, details?: any): ApiError {
    return new ApiError('UNAUTHORIZED', message, 401, details);
  }

  static forbidden(message: string, details?: any): ApiError {
    return new ApiError('FORBIDDEN', message, 403, details);
  }

  static notFound(message: string, details?: any): ApiError {
    return new ApiError('NOT_FOUND', message, 404, details);
  }

  static conflict(message: string, details?: any): ApiError {
    return new ApiError('CONFLICT', message, 409, details);
  }

  static tooManyRequests(message: string, details?: any): ApiError {
    return new ApiError('TOO_MANY_REQUESTS', message, 429, details);
  }

  static internal(message: string, details?: any): ApiError {
    return new ApiError('INTERNAL_ERROR', message, 500, details);
  }

  static badGateway(message: string, details?: any): ApiError {
    return new ApiError('BAD_GATEWAY', message, 502, details);
  }

  static validation(message: string, details?: any): ApiError {
    return new ApiError('VALIDATION_ERROR', message, 400, details);
  }
}

/**
 * Convenience HTTP response helpers
 * 
 * Usage:
 *   http.ok(res, { user }, req)
 *   http.badRequest(res, 'INVALID_INPUT', 'Email is required', null, req)
 *   throw ApiError.notFound('User not found')
 */
export const http = {
  /**
   * 200 OK - Success
   */
  ok: <T = any>(res: Response, data: T, req?: Request | { requestId?: string }) =>
    sendOk(res, data, 200, req),

  /**
   * 201 Created - Resource created successfully
   */
  created: <T = any>(res: Response, data: T, req?: Request | { requestId?: string }) =>
    sendOk(res, data, 201, req),

  /**
   * 202 Accepted - Request accepted for processing
   */
  accepted: <T = any>(res: Response, data: T, req?: Request | { requestId?: string }) =>
    sendOk(res, data, 202, req),

  /**
   * 204 No Content - Success with no response body
   */
  noContent: (res: Response) =>
    res.status(204).send(),

  /**
   * 400 Bad Request - Client error
   */
  badRequest: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 400, details, req),

  /**
   * 401 Unauthorized - Authentication required
   */
  unauthorized: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 401, details, req),

  /**
   * 403 Forbidden - Insufficient permissions
   */
  forbidden: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 403, details, req),

  /**
   * 404 Not Found - Resource doesn't exist
   */
  notFound: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 404, details, req),

  /**
   * 409 Conflict - Resource conflict
   */
  conflict: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 409, details, req),

  /**
   * 422 Unprocessable Entity - Validation error
   */
  unprocessable: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 422, details, req),

  /**
   * 429 Too Many Requests - Rate limit exceeded
   */
  tooMany: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 429, details, req),

  /**
   * 500 Internal Server Error - Server error
   */
  serverError: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 500, details, req),

  /**
   * 502 Bad Gateway - External service error
   */
  badGateway: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 502, details, req),

  /**
   * 503 Service Unavailable - Service temporarily unavailable
   */
  serviceUnavailable: (
    res: Response,
    code: string,
    message: string,
    details?: any,
    req?: Request | { requestId?: string }
  ) => sendError(res, code, message, 503, details, req),
};

/**
 * Common error codes for consistency
 */
export const ErrorCodes = {
  // Client Errors (4xx)
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  
  // Authentication Errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',
  MISSING_TOKEN: 'MISSING_TOKEN',
  INVALID_API_KEY: 'INVALID_API_KEY',
  
  // Server Errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_GATEWAY: 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
