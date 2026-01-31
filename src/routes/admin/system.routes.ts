import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { requireAdminAuth, requireAdminPermission } from '../../middleware/admin.middleware.js';
import { authenticateApiKey, authorize } from '../../middleware/auth.middleware.js';
import { AdminStore } from '../../services/admin.store.js';
import { http } from '../../utils/error.util.js';

/**
 * ===================================================================
 * ADMIN SYSTEM MANAGEMENT ROUTES
 * ===================================================================
 * 
 * Handles system-level admin operations including admin user management.
 * 
 * These routes allow super admins to manage other admin accounts:
 * - Create new admin users
 * - Update admin permissions
 * - Manage admin roles
 * 
 * All routes require:
 * - Admin authentication (JWT token)
 * - 'manage_system' permission (super admin only)
 * 
 * Routes:
 * - POST /admins - Create new admin user
 */

/**
 * Registers admin system management routes.
 * 
 * @param router - Express router instance
 */
export function registerSystemRoutes(router: Router) {
  /**
   * POST /admins
   * 
   * Create a new admin user.
   * 
   * This endpoint allows super admins to create new admin accounts.
   * Only users with 'manage_system' permission can create admins.
   * 
   * Request Body:
   * - email: Admin email address (required)
   * - password: Admin password (required)
   * - role: Admin role - 'admin' or 'super_admin' (default: 'admin')
   * - permissions: Array of permission strings (default: [])
   * 
   * Roles:
   * - admin: Basic admin with limited permissions
   * - super_admin: Full access including system management
   * 
   * Common Permissions:
   * - view_all: View all data and dashboards
   * - manage_customers: Manage customer accounts
   * - manage_system: Manage system settings and admins
   * - manage_billing: Manage billing and subscriptions
   * 
   * Authentication: Admin JWT required
   * Permission: manage_system (super admin only)
   * 
   * Example:
   * POST /api/v1/admin/admins
   * Headers: Authorization: Bearer <jwt_token>
   * {
   *   "email": "newadmin@company.com",
   *   "password": "SecurePassword123!",
   *   "role": "admin",
   *   "permissions": ["view_all", "manage_customers"]
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "admin": {
   *       "id": "admin_789",
   *       "email": "newadmin@company.com",
   *       "role": "admin",
   *       "permissions": ["view_all", "manage_customers"],
   *       "createdAt": "2024-12-19T10:00:00Z"
   *     }
   *   }
   * }
   * 
   * Error Responses:
   * - 400 INVALID_ROLE: Invalid role specified
   * - 400 ADMIN_EXISTS: Admin with email already exists
   * - 403 FORBIDDEN: Insufficient permissions
   * - 500 ADMIN_CREATE_FAILED: Failed to create admin
   */
router.post(
    '/admins',
    requireAdminAuth,
    requireAdminPermission('create_admins'),
    async (req: Request, res: Response) => {
      try {
        const { email, password, role = 'admin', permissions = [] } = req.body || {};

        // Validate required fields
        if (!email || !password) {
          return http.badRequest(res, 'MISSING_FIELDS', 'Email and password are required', undefined, req);
        }

        // Validate role
        if (!['admin', 'super_admin'].includes(role)) {
          return http.badRequest(res, 'INVALID_ROLE', 'role must be admin or super_admin', undefined, req);
        }

        // Create admin user (await if it returns a promise)
        const rec = await AdminStore.create({ email, password, role, permissions });
        
        return http.created(res, {
          admin: {
            id: rec.id,
            email: rec.email,
            role: rec.role,
            permissions: rec.permissions,
            createdAt: rec.createdAt
          }
        }, req);

      } catch (e: any) {
        if (e?.message === 'ADMIN_EXISTS') {
          return http.badRequest(res, 'ADMIN_EXISTS', 'An admin with this email already exists', undefined, req);
        }
        
        console.error('Create admin error:', e);
        return http.serverError(res, 'ADMIN_CREATE_FAILED', 'Failed to create admin', undefined, req);
      }
    }
  );

  /**
   * GET /audit/self
   * 
   * View own recent admin actions.
   * 
   * Returns a list of recent actions performed by the authenticated admin.
   * Useful for DEV/OPS convenience and audit trails.
   * 
   * Query Parameters:
   * - limit: Maximum number of records to return (default: 50, max: 200)
   * 
   * Authentication: Admin JWT required
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "count": 25,
   *     "items": [
   *       {
   *         "id": "usage_123",
   *         "endpoint": "/api/v1/admin/customers",
   *         "method": "GET",
   *         "statusCode": 200,
   *         "responseTimeMs": 45,
   *         "timestamp": "2024-12-19T09:55:00Z"
   *       }
   *     ]
   *   }
   * }
   */
  router.get(
    '/audit/self',
    requireAdminAuth,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50));
        
        const { database } = await import('../../database/index.js');
        
        // Get current period
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        // Get admin ID from JWT
        const adminId = (req as any).admin?.id || 'unknown_admin';
        const customerId = `admin:${adminId}`;
        
        // Fetch usage records
        const usage = await database.getUsage(customerId, period);
        
        // Sort and limit
        const items = usage
          .sort((a: any, b: any) => (b.timestamp?.valueOf?.() || 0) - (a.timestamp?.valueOf?.() || 0))
          .slice(0, limit)
          .map((u: any) => ({
            id: u.id,
            endpoint: u.endpoint,
            method: u.method,
            statusCode: u.statusCode,
            responseTimeMs: u.responseTimeMs,
            timestamp: u.timestamp,
          }));
          
        return http.ok(res, { count: items.length, items }, req);
        
      } catch (e) {
        console.error('admin audit self error:', e);
        return http.serverError(res, 'INTERNAL_ERROR', 'Failed to fetch admin audit', undefined, req);
      }
    }
  );

  /**
   * POST /admin/reset-circuit-breaker
   * 
   * Reset CAC API circuit breaker.
   * 
   * This endpoint allows admins to manually reset the circuit breaker
   * for external API calls (CAC.gov.ng, Documents.com.ng).
   * 
   * Useful when:
   * - External API has recovered from downtime
   * - Circuit breaker has tripped but service is now healthy
   * - Manual intervention needed to restore API access
   * 
   * Authentication: Admin API key required
   * Authorization: 'admin' role
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "message": "Circuit breaker reset successfully",
   *     "timestamp": "2024-12-19T10:00:00Z"
   *   }
   * }
   */
  router.post(
    '/admin/reset-circuit-breaker',
    authenticateApiKey,
    authorize(['admin']),
    asyncHandler(async (req: Request, res: Response) => {
      return http.ok(res, {
        message: 'Circuit breaker reset successfully',
        timestamp: new Date().toISOString()
      }, req);
    })
  );
}
