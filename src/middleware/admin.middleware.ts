import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { signJwt, verifyJwt } from '../utils/jwt.util.js';
import { http } from '../utils/error.util.js';
import { database } from '../database/index.js';

/**
 * Admin Authentication Middleware
 * Handles admin login, JWT token generation, and admin-only route protection
 */

interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'super_admin' | 'admin' | 'support';
  permissions: string[];
  lastLogin?: Date;
  createdAt: Date;
}

interface AdminJWTPayload {
  adminId: string;
  email: string;
  role: string;
  permissions: string[];
}

// Admin configuration (super admin seeded from environment variables)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('CRITICAL SECURITY ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables. Check your .env file.')
}

// Import comprehensive permission system
import { DEFAULT_PERMISSIONS, AVAILABLE_PERMISSIONS } from '../routes/admin/admin.routes.js';

// TODO(rovodev): move JWT secret & expiry to a single shared util; enforce standard claims (iss, aud)
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable must be set. Add it to your .env file.')
}
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

/**
 * Initialize admin user with hashed password
 */
export const initializeAdminUser = async (): Promise<void> => {
  try {
    await database.initialize();

    const existing = await database.getAdminByEmail(ADMIN_EMAIL);
    if (existing) return;

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
await database.createAdmin({
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: 'super_admin',
      permissions: DEFAULT_PERMISSIONS.super_admin,
      status: 'active'
    });

    const logLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (logLevel === 'info' || logLevel === 'debug') {
      console.log(`[ADMIN] Super admin seeded: ${ADMIN_EMAIL}`);
      // Password logging removed for security - check your .env file for ADMIN_PASSWORD
      console.log('[ADMIN] WARNING: CHANGE THIS PASSWORD IMMEDIATELY IN PRODUCTION!');
    }
  } catch (error) {
    console.error('❌ Admin initialization failed:', error);
  }
};

/**
 * Admin login endpoint handler
 */
// TODO(rovodev): add basic login attempt limiter (in-memory acceptable for MVP)
const adminAttempts: Record<string, { count: number; last: number }> = {};
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Simple in-memory login throttle per IP (MVP)
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = adminAttempts[ip] || { count: 0, last: now };
    if (now - entry.last > WINDOW_MS) {
      entry.count = 0; // reset window
    }
    entry.count += 1;
    entry.last = now;
    adminAttempts[ip] = entry;
    if (entry.count > MAX_ATTEMPTS) {
      http.tooMany(res, 'too_many_attempts', 'Too many login attempts. Please try again later.')
      return
    }

    // Validate input
    if (!email || !password) {
      http.badRequest(res, 'MISSING_CREDENTIALS', 'Email and password are required')
      return;
    }

    // Look up admin in database
    const admin = await database.getAdminByEmail(email);
    
    if (!admin) {
      http.unauthorized(res, 'INVALID_CREDENTIALS', 'Invalid email or password', undefined, req);
      return;
    }

    // Check if admin is active
    if (admin.status !== 'active') {
      http.unauthorized(res, 'ADMIN_SUSPENDED', 'Admin account is suspended', undefined, req);
      return;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isPasswordValid) {
      http.unauthorized(res, 'INVALID_CREDENTIALS', 'Invalid email or password', undefined, req);
      return;
    }

    // Update last login
    await database.updateAdmin(admin.id, { lastLogin: new Date() } as any);

    // Generate JWT token
    const tokenPayload: AdminJWTPayload = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions
    };

    const token = signJwt(tokenPayload);

    // Return success response with standardized format
    http.ok(res, {
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        fullName: admin.fullName,
        lastLogin: new Date()
      },
      message: 'Admin login successful'
    }, req);

  } catch (error) {
    console.error('Admin login error:', error);
    http.serverError(res, 'INTERNAL_ERROR', 'Login failed due to server error', undefined, req);
  }
};

/**
 * Admin authentication middleware
 * Protects admin-only routes
 */
export const requireAdminAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      http.unauthorized(res, 'MISSING_ADMIN_TOKEN', 'Admin authentication token required. Format: Authorization: Bearer <token>', undefined, req);
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify JWT token
    const decoded = verifyJwt<AdminJWTPayload>(token);
    
    // Verify admin exists in database
    const admin = await database.getAdmin(decoded.adminId);
    if (!admin) {
      http.unauthorized(res, 'INVALID_ADMIN_TOKEN', 'Admin user not found or token invalid', undefined, req);
      return;
    }

    // Check if admin is still active
    if (admin.status !== 'active') {
      http.unauthorized(res, 'ADMIN_SUSPENDED', 'Admin account has been suspended', undefined, req);
      return;
    }

    // Add admin info to request object
    req.admin = {
      id: decoded.adminId,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions
    };

    next();

  } catch (error) {
    if ((error as any)?.name === 'JsonWebTokenError' || (error as any)?.name === 'TokenExpiredError') {
      http.unauthorized(res, 'INVALID_ADMIN_TOKEN', 'Invalid or expired admin token')
      return;
    }

    console.error('Admin auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADMIN_AUTH_ERROR',
        message: 'Admin authentication failed'
      }
    });
  }
};

/**
 * Check admin permissions middleware
 */
export const requireAdminPermission = (permission: string | string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      http.unauthorized(res, 'ADMIN_NOT_AUTHENTICATED', 'Admin authentication required', undefined, req);
      return;
    }

    const permissions = Array.isArray(permission) ? permission : [permission];
    
    // Super admins have access to everything
    if (req.admin.role === 'super_admin') {
      next();
      return;
    }

    // Check if admin has any of the required permissions
    const hasPermission = permissions.some(p => req.admin!.permissions.includes(p));
    
    if (!hasPermission) {
      http.forbidden(res, 'INSUFFICIENT_ADMIN_PERMISSIONS', `Admin permission required: ${permissions.join(' OR ')}`, undefined, req);
      return;
    }

    next();
  };
};

/**
 * Check if admin has ANY of the specified permissions
 */
export const requireAnyAdminPermission = (permissions: string[]) => {
  return requireAdminPermission(permissions);
};

/**
 * Check if admin has ALL of the specified permissions
 */
export const requireAllAdminPermissions = (permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      http.unauthorized(res, 'ADMIN_NOT_AUTHENTICATED', 'Admin authentication required', undefined, req);
      return;
    }

    // Super admins have access to everything
    if (req.admin.role === 'super_admin') {
      next();
      return;
    }

    // Check if admin has all required permissions
    const hasAllPermissions = permissions.every(p => req.admin!.permissions.includes(p));
    
    if (!hasAllPermissions) {
      const missingPermissions = permissions.filter(p => !req.admin!.permissions.includes(p));
      http.forbidden(res, 'INSUFFICIENT_ADMIN_PERMISSIONS', `Admin permissions required: ${missingPermissions.join(', ')}`, undefined, req);
      return;
    }

    next();
  };
};

/**
 * Get admin profile
 */
export const getAdminProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.admin) {
      res.status(401).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_AUTHENTICATED',
          message: 'Admin authentication required'
        }
      });
      return;
    }

    const admin = await database.getAdmin(req.admin.id);
    res.json({
      success: true,
      data: {
        admin: {
          id: admin?.id || req.admin.id,
          email: admin?.email || req.admin.email,
          role: admin?.role || req.admin.role,
          permissions: admin?.permissions || req.admin.permissions,
          lastLogin: admin?.lastLogin || new Date(),
          createdAt: admin?.createdAt || new Date()
        }
      }
    });

  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get admin profile'
      }
    });
  }
};

/**
 * Update admin profile
 * Currently supports email updates
 */
export const updateAdminProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.admin) {
      res.status(401).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_AUTHENTICATED',
          message: 'Admin authentication required'
        }
      });
      return;
    }

    const { email } = req.body;

    // Validate email format
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EMAIL',
            message: 'Invalid email format'
          }
        });
        return;
      }

      const updated = await database.updateAdmin(req.admin.id, { email } as any);
      console.log(`✅ Admin email updated: ${updated.email}`);
    }

    const admin = await database.getAdmin(req.admin.id);
    res.json({
      success: true,
      data: {
        admin: {
          id: admin?.id || req.admin.id,
          email: admin?.email || req.admin.email,
          role: admin?.role || req.admin.role,
          permissions: admin?.permissions || req.admin.permissions,
          lastLogin: admin?.lastLogin || new Date(),
          createdAt: admin?.createdAt || new Date()
        }
      },
      message: 'Admin profile updated successfully'
    });

  } catch (error) {
    console.error('Update admin profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update admin profile'
      }
    });
  }
};

/**
 * Change admin password
 */
export const changeAdminPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!req.admin) {
      res.status(401).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_AUTHENTICATED',
          message: 'Admin authentication required'
        }
      });
      return;
    }

    // Validate input
    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PASSWORDS',
          message: 'Current password and new password are required'
        }
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: 'New password must be at least 8 characters long'
        }
      });
      return;
    }

    const admin = await database.getAdmin(req.admin.id);
    if (!admin) {
      res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin not found'
        }
      });
      return;
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isCurrentPasswordValid) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect'
        }
      });
      return;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await database.updateAdmin(admin.id, { passwordHash: newPasswordHash, lastLogin: new Date() } as any);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change admin password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to change password'
      }
    });
  }
};

// Type declaration for Express Request
declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        role: string;
        permissions: string[];
      };
    }
  }
}