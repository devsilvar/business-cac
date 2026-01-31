import type { Request, Response, NextFunction } from 'express';
import { signJwt, verifyJwt } from '../utils/jwt.util.js';
import { AuthenticationError, AuthorizationError } from '../types/errors.js';
import type { AuthenticatedUser } from '../types/index.js';
import { HttpStatus } from '../types/index.js';

// Note: Request interface extensions are consolidated in types/index.ts

// Configuration for JWT (optional)
// TODO(rovodev): consolidate JWT config into a shared util; standardize exp=15-60m and claims
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable must be set. Add it to your .env file.')
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const API_KEY_HEADER = process.env.API_KEY_HEADER || 'x-api-key';

// Enable/disable authentication
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

// In-memory store for API keys (optional - only if auth is enabled)
const API_KEYS = new Map<string, {
  clientId: string;
  bankId?: string;
  permissions: string[];
  isActive: boolean;
}>();

// Initialize demo API keys (only if auth is enabled)
if (AUTH_ENABLED) {
  API_KEYS.set('demo-client-api-key-123', {
    clientId: 'client-001',
    permissions: ['name-similarity-search'],
    isActive: true,
  });
  API_KEYS.set('demo-admin-api-key-456', {
    clientId: 'admin-001',
    permissions: [ 'admin'],
    isActive: true,
  });
}

/**
 * Optional API Key Authentication Middleware
 * Only activates if AUTH_ENABLED=true in environment
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Skip authentication if disabled
  if (!AUTH_ENABLED) {
    // Set default user for tracking
    req.clientId = 'anonymous';
    req.user = {
      id: 'anonymous',
      email: 'anonymous@api.client',
      role: 'user',
      permissions: ['name-search'],
    };
    return next();
  }

  try {
    const apiKey = req.header(API_KEY_HEADER);
    
    if (!apiKey) {
      throw new AuthenticationError('API key is required');
    }

    const clientInfo = API_KEYS.get(apiKey);
    
    if (!clientInfo || !clientInfo.isActive) {
      throw new AuthenticationError('Invalid or inactive API key');
    }

    // Set client information in request
    req.clientId = clientInfo.clientId;
    req.user = {
      id: clientInfo.clientId,
      email: `${clientInfo.clientId}@api.client`,
      role: clientInfo.bankId ? 'bank' : 'user',
      permissions: clientInfo.permissions,
      bankId: clientInfo.bankId || undefined,
    };

    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: req.headers['x-request-id'] as string || 'unknown',
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string || 'unknown',
      });
      return;
    }
    
    next(error);
  }
};

/**
 * JWT Authentication Middleware (optional)
 * Only activates if AUTH_ENABLED=true in environment
 */
export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Skip authentication if disabled
  if (!AUTH_ENABLED) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('JWT token is required');
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = verifyJwt<any>(token);
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions || [],
        bankId: decoded.bankId,
      };
      next();
    } catch (jwtError) {
      throw new AuthenticationError('Invalid or expired JWT token');
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: req.headers['x-request-id'] as string || 'unknown',
        },
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string || 'unknown',
      });
      return;
    }
    
    next(error);
  }
};

/**
 * Authorization Middleware (optional)
 * Only activates if AUTH_ENABLED=true in environment
 */
export const authorize = (requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip authorization if disabled
    if (!AUTH_ENABLED) {
      return next();
    }

    if (!req.user) {
      throw new AuthenticationError('User not authenticated');
    }

    const hasPermission = requiredPermissions.every(permission =>
      req.user!.permissions.includes(permission)
    );

    if (!hasPermission) {
      throw new AuthorizationError('Insufficient permissions');
    }

    next();
  };
};

/**
 * Optional Bank-specific Authorization (only if auth enabled)
 */
export const requireBankClient = (req: Request, res: Response, next: NextFunction): void => {
  // Skip if auth is disabled
  if (!AUTH_ENABLED) {
    return next();
  }

  if (!req.user) {
    throw new AuthenticationError('User not authenticated');
  }

  if (req.user.role !== 'bank') {
    throw new AuthorizationError('Bank client access required');
  }

  next();
};

/**
 * Generate JWT Token (for internal use)
 */
export const generateToken = (user: AuthenticatedUser): string => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    bankId: user.bankId,
  } as any;
  
  return signJwt(payload);
};

/**
 * Health check for authentication system
 */
export const authHealthCheck = (req: Request, res: Response): void => {
  const response = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'authentication',
    enabled: AUTH_ENABLED,
    checks: {
      authEnabled: AUTH_ENABLED,
      apiKeysCount: API_KEYS.size,
      activeKeysCount: AUTH_ENABLED ? Array.from(API_KEYS.values()).filter(key => key.isActive).length : 0,
      jwtConfigured: !!JWT_SECRET,
    },
  };

  if (AUTH_ENABLED) {
    response.checks.apiKeysCount = API_KEYS.size;
    response.checks.activeKeysCount = Array.from(API_KEYS.values()).filter(key => key.isActive).length;
  } else {
    response.checks.apiKeysCount = 0;
    response.checks.activeKeysCount = 0;
  }

  res.status(HttpStatus.OK).json(response);
};

/**
 * Demo API Keys Info (for development)
 */
export const getDemoApiKeys = (req: Request, res: Response): void => {
  if (AUTH_ENABLED) {
    res.status(200).json({
      success: true,
      data: {
        message: 'Demo API Keys (Only when AUTH_ENABLED=true)',
        keys: [
          {
            key: 'demo-client-api-key-123',
            description: 'Client access for name similarity search',
            permissions: ['name-similarity-search'],
          },
          {
            key: 'demo-admin-api-key-456',
            description: 'Admin access with additional privileges',
            permissions: ['name-similarity-search', 'admin'],
          },
        ],
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } else {
    res.status(200).json({
      success: true,
      data: {
        message: 'Authentication is disabled',
        enabled: false,
        instructions: 'Set AUTH_ENABLED=true in environment to enable API key authentication',
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
};

export default {
  authenticateApiKey,
  authenticateJWT,
  authorize,
  requireBankClient,
  generateToken,
  authHealthCheck,
  getDemoApiKeys,
};