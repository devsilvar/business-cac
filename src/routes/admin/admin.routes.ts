/**
 * Admin Management Routes
 * Super Admin can create, manage other admins and their permissions
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { 
  requireAdminAuth, 
  requireAdminPermission 
} from '../../middleware/admin.middleware.js';
import { http } from '../../utils/error.util.js';
import { validateContentType, sanitizeInput } from '../../middleware/validation.middleware.js';
import { database } from '../../database/index.js';
import { Admin, AdminData, AdminRole } from '../../database/index.js';

const router = Router();

/**
 * Available permissions in the system
 * Super Admin has all permissions by default
 */
export const AVAILABLE_PERMISSIONS = {
  // Customer Management
  'view_customers': 'View customer list and details',
  'create_customers': 'Create new customer accounts',
  'edit_customers': 'Edit customer information',
  'delete_customers': 'Delete customer accounts',
  'manage_customer_wallet': 'Manage customer wallet balances',
  
  // Admin Management (Super Admin only)
  'view_admins': 'View admin list and details',
  'create_admins': 'Create new admin accounts',
  'edit_admins': 'Edit admin information and permissions',
  'delete_admins': 'Delete admin accounts',
  'manage_admin_permissions': 'Grant/revoke admin permissions',
  
  // Business Operations
  'view_verification_requests': 'View business verification requests',
  'approve_verifications': 'Approve business verifications',
  'reject_verifications': 'Reject business verifications',
  
  // Pricing Management
  'view_pricing': 'View service pricing',
  'edit_pricing': 'Edit service pricing',
  
  // Billing & Wallet
  'view_wallet_transactions': 'View all wallet transactions',
  'process_refunds': 'Process customer refunds',
  
  // System Management
  'view_dashboard': 'View admin dashboard',
  'view_system_metrics': 'View system performance metrics',
  'manage_system': 'System administration tasks',
  
  // API Keys
  'view_api_keys': 'View customer API keys',
  'manage_api_keys': 'Create/revoke customer API keys',
  
  // Usage Analytics
  'view_usage_analytics': 'View API usage analytics',
  'export_reports': 'Export system reports'
};

/**
 * Default permissions by role
 */
export const DEFAULT_PERMISSIONS = {
  super_admin: Object.keys(AVAILABLE_PERMISSIONS), // All permissions
  admin: [
    'view_customers',
    'create_customers',
    'edit_customers',
    'view_verification_requests', 
    'approve_verifications',
    'reject_verifications',
    'view_pricing',
    'view_wallet_transactions',
    'view_dashboard',
    'view_api_keys',
    'view_usage_analytics'
  ],
  support: [
    'view_customers',
    'view_verification_requests',
    'view_pricing',
    'view_wallet_transactions',
    'view_dashboard'
  ]
};

/**
 * @route GET /admin
 * @desc List all admins (Super Admin only)
 * @access Super Admin only
 */
router.get(
  '/',
  requireAdminAuth,
  requireAdminPermission('view_admins'),
  async (req: Request, res: Response) => {
    try {
      const admins = await database.listAdmins();
      
      // Remove sensitive password hashes from response
      const adminList = admins.map(admin => ({
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        permissions: admin.permissions,
        status: admin.status,
        lastLogin: admin.lastLogin,
        createdAt: admin.createdAt,
        createdBy: admin.createdBy
      }));

      http.ok(res, { admins: adminList }, req);
    } catch (error) {
      console.error('List admins error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to list admins', undefined, req);
    }
  }
);

/**
 * @route GET /admin/:id
 * @desc Get specific admin details (Super Admin only)
 * @access Super Admin only
 */
router.get(
  '/:id',
  requireAdminAuth,
  requireAdminPermission('view_admins'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Remove sensitive password hash
      const adminData = {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        permissions: admin.permissions,
        status: admin.status,
        lastLogin: admin.lastLogin,
        createdAt: admin.createdAt,
        createdBy: admin.createdBy
      };

      http.ok(res, { admin: adminData }, req);
    } catch (error) {
      console.error('Get admin error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to get admin details', undefined, req);
    }
  }
);

/**
 * @route POST /admin
 * @desc Create new admin (Super Admin only)
 * @access Super Admin only
 */
router.post(
  '/',
  requireAdminAuth,
  requireAdminPermission('create_admins'),
  validateContentType,
  sanitizeInput,
  async (req: Request, res: Response) => {
    try {
      const { email, password, fullName, role = 'admin', permissions = [] } = req.body;

      // Validation
      if (!email || !password) {
        http.badRequest(res, 'MISSING_FIELDS', 'Email and password are required', undefined, req);
        return;
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        http.badRequest(res, 'INVALID_EMAIL', 'Invalid email format', undefined, req);
        return;
      }

      // Password strength validation
      if (password.length < 8) {
        http.badRequest(res, 'WEAK_PASSWORD', 'Password must be at least 8 characters long', undefined, req);
        return;
      }

      // Check if admin already exists
      const existingAdmin = await database.getAdminByEmail(email);
      if (existingAdmin) {
        http.badRequest(res, 'ADMIN_EXISTS', 'An admin with this email already exists', undefined, req);
        return;
      }

      // Validate role
      const validRoles: AdminRole[] = ['super_admin', 'admin', 'support'];
      if (!validRoles.includes(role)) {
        http.badRequest(res, 'INVALID_ROLE', 'Invalid role. Must be: super_admin, admin, or support', undefined, req);
        return;
      }

      // Only super_admin can create other super_admins
      if (role === 'super_admin' && req.admin?.role !== 'super_admin') {
        http.forbidden(res, 'INSUFFICIENT_PERMISSIONS', 'Only super admins can create other super admins', undefined, req);
        return;
      }

      // Set default permissions based on role if none provided
      let finalPermissions = permissions;
      if (finalPermissions.length === 0) {
        finalPermissions = DEFAULT_PERMISSIONS[role] || [];
      }

      // Validate permissions
      const invalidPermissions = finalPermissions.filter(p => !AVAILABLE_PERMISSIONS[p]);
      if (invalidPermissions.length > 0) {
        http.badRequest(res, 'INVALID_PERMISSIONS', `Invalid permissions: ${invalidPermissions.join(', ')}`, undefined, req);
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create admin
      const adminData: AdminData = {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        role,
        permissions: finalPermissions,
        status: 'active',
        createdBy: req.admin?.id
      };

      const newAdmin = await database.createAdmin(adminData);

      // Remove sensitive data from response
      const responseAdmin = {
        id: newAdmin.id,
        email: newAdmin.email,
        fullName: newAdmin.fullName,
        role: newAdmin.role,
        permissions: newAdmin.permissions,
        status: newAdmin.status,
        createdAt: newAdmin.createdAt,
        createdBy: newAdmin.createdBy
      };

      http.created(res, { 
        admin: responseAdmin,
        message: `Admin account created successfully with role: ${role}`
      }, req);

      console.log(`✅ New admin created: ${email} (${role}) by ${req.admin?.email}`);

    } catch (error) {
      console.error('Create admin error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to create admin', undefined, req);
    }
  }
);

/**
 * @route PUT /admin/:id
 * @desc Update admin details (Super Admin only)
 * @access Super Admin only
 */
router.put(
  '/:id',
  requireAdminAuth,
  requireAdminPermission('edit_admins'),
  validateContentType,
  sanitizeInput,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { email, fullName, role, permissions, status } = req.body;

      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Prevent self-modification of role/permissions (super admin only)
      if (admin.id === req.admin?.id && req.admin?.role !== 'super_admin') {
        http.forbidden(res, 'SELF_MODIFICATION', 'You cannot modify your own role or permissions', undefined, req);
        return;
      }

      const updates: Partial<AdminData> = {};

      // Update email if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          http.badRequest(res, 'INVALID_EMAIL', 'Invalid email format', undefined, req);
          return;
        }

        // Check if email is already taken by another admin
        const existingAdmin = await database.getAdminByEmail(email);
        if (existingAdmin && existingAdmin.id !== id) {
          http.badRequest(res, 'EMAIL_TAKEN', 'This email is already used by another admin', undefined, req);
          return;
        }

        updates.email = email.toLowerCase();
      }

      // Update full name if provided
      if (fullName !== undefined) {
        updates.fullName = fullName;
      }

      // Update role if provided
      if (role) {
        const validRoles: AdminRole[] = ['super_admin', 'admin', 'support'];
        if (!validRoles.includes(role)) {
          http.badRequest(res, 'INVALID_ROLE', 'Invalid role. Must be: super_admin, admin, or support', undefined, req);
          return;
        }

        // Only super_admin can assign super_admin role
        if (role === 'super_admin' && req.admin?.role !== 'super_admin') {
          http.forbidden(res, 'INSUFFICIENT_PERMISSIONS', 'Only super admins can assign super admin role', undefined, req);
          return;
        }

        updates.role = role;
      }

      // Update permissions if provided
      if (permissions) {
        if (!Array.isArray(permissions)) {
          http.badRequest(res, 'INVALID_PERMISSIONS_FORMAT', 'Permissions must be an array', undefined, req);
          return;
        }

        // Validate permissions
        const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS[p]);
        if (invalidPermissions.length > 0) {
          http.badRequest(res, 'INVALID_PERMISSIONS', `Invalid permissions: ${invalidPermissions.join(', ')}`, undefined, req);
          return;
        }

        updates.permissions = permissions;
      }

      // Update status if provided
      if (status) {
        const validStatuses = ['active', 'suspended'];
        if (!validStatuses.includes(status)) {
          http.badRequest(res, 'INVALID_STATUS', 'Status must be: active or suspended', undefined, req);
          return;
        }

        // Prevent self-suspension
        if (admin.id === req.admin?.id && status === 'suspended') {
          http.forbidden(res, 'SELF_SUSPENSION', 'You cannot suspend your own account', undefined, req);
          return;
        }

        updates.status = status;
      }

      // Apply updates
      const updatedAdmin = await database.updateAdmin(id, updates);

      // Remove sensitive data from response
      const responseAdmin = {
        id: updatedAdmin.id,
        email: updatedAdmin.email,
        fullName: updatedAdmin.fullName,
        role: updatedAdmin.role,
        permissions: updatedAdmin.permissions,
        status: updatedAdmin.status,
        lastLogin: updatedAdmin.lastLogin,
        createdAt: updatedAdmin.createdAt,
        updatedAt: updatedAdmin.updatedAt
      };

      http.ok(res, { 
        admin: responseAdmin,
        message: 'Admin updated successfully'
      }, req);

      console.log(`✅ Admin updated: ${updatedAdmin.email} by ${req.admin?.email}`);

    } catch (error) {
      console.error('Update admin error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to update admin', undefined, req);
    }
  }
);

/**
 * @route DELETE /admin/:id
 * @desc Delete admin (Super Admin only)
 * @access Super Admin only
 */
router.delete(
  '/:id',
  requireAdminAuth,
  requireAdminPermission('delete_admins'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Prevent self-deletion
      if (admin.id === req.admin?.id) {
        http.forbidden(res, 'SELF_DELETION', 'You cannot delete your own account', undefined, req);
        return;
      }

      // Prevent deletion of other super admins (unless you're also a super admin)
      if (admin.role === 'super_admin' && req.admin?.role !== 'super_admin') {
        http.forbidden(res, 'DELETE_SUPER_ADMIN', 'Only super admins can delete other super admins', undefined, req);
        return;
      }

      await database.deleteAdmin(id);

      http.ok(res, { 
        message: `Admin ${admin.email} has been deleted successfully`
      }, req);

      console.log(`⚠️  Admin deleted: ${admin.email} by ${req.admin?.email}`);

    } catch (error) {
      console.error('Delete admin error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to delete admin', undefined, req);
    }
  }
);

/**
 * @route GET /admin/permissions
 * @desc Get list of all available permissions
 * @access Admin (to understand permission system)
 */
router.get(
  '/permissions',
  requireAdminAuth,
  requireAdminPermission('view_admins'),
  (req: Request, res: Response) => {
    try {
      http.ok(res, { 
        permissions: AVAILABLE_PERMISSIONS,
        defaultPermissions: DEFAULT_PERMISSIONS
      }, req);
    } catch (error) {
      console.error('Get permissions error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to get permissions', undefined, req);
    }
  }
);

/**
 * @route POST /admin/:id/permissions/grant
 * @desc Grant specific permissions to admin (Super Admin only)
 * @access Super Admin only
 */
router.post(
  '/:id/permissions/grant',
  requireAdminAuth,
  requireAdminPermission('manage_admin_permissions'),
  validateContentType,
  sanitizeInput,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions) || permissions.length === 0) {
        http.badRequest(res, 'INVALID_PERMISSIONS', 'Permissions must be a non-empty array', undefined, req);
        return;
      }

      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Validate permissions
      const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS[p]);
      if (invalidPermissions.length > 0) {
        http.badRequest(res, 'INVALID_PERMISSIONS', `Invalid permissions: ${invalidPermissions.join(', ')}`, undefined, req);
        return;
      }

      // Combine existing permissions with new ones (avoid duplicates)
      const updatedPermissions = [...new Set([...admin.permissions, ...permissions])];
      
      await database.updateAdmin(id, { permissions: updatedPermissions });

      http.ok(res, { 
        message: `Permissions granted successfully: ${permissions.join(', ')}`,
        permissions: updatedPermissions
      }, req);

      console.log(`✅ Permissions granted to ${admin.email}: ${permissions.join(', ')} by ${req.admin?.email}`);

    } catch (error) {
      console.error('Grant permissions error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to grant permissions', undefined, req);
    }
  }
);

/**
 * @route POST /admin/:id/permissions/revoke
 * @desc Revoke specific permissions from admin (Super Admin only)
 * @access Super Admin only
 */
router.post(
  '/:id/permissions/revoke',
  requireAdminAuth,
  requireAdminPermission('manage_admin_permissions'),
  validateContentType,
  sanitizeInput,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions) || permissions.length === 0) {
        http.badRequest(res, 'INVALID_PERMISSIONS', 'Permissions must be a non-empty array', undefined, req);
        return;
      }

      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Prevent revoking all permissions from yourself
      if (admin.id === req.admin?.id) {
        const remainingPermissions = admin.permissions.filter(p => !permissions.includes(p));
        if (remainingPermissions.length === 0) {
          http.forbidden(res, 'SELF_PERMISSION_REVOKE', 'You cannot revoke all your own permissions', undefined, req);
          return;
        }
      }

      // Remove specified permissions
      const updatedPermissions = admin.permissions.filter(p => !permissions.includes(p));
      
      await database.updateAdmin(id, { permissions: updatedPermissions });

      http.ok(res, { 
        message: `Permissions revoked successfully: ${permissions.join(', ')}`,
        permissions: updatedPermissions
      }, req);

      console.log(`⚠️  Permissions revoked from ${admin.email}: ${permissions.join(', ')} by ${req.admin?.email}`);

    } catch (error) {
      console.error('Revoke permissions error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to revoke permissions', undefined, req);
    }
  }
);

/**
 * @route POST /admin/:id/reset-password
 * @desc Reset admin password (Super Admin only)
 * @access Super Admin only
 */
router.post(
  '/:id/reset-password',
  requireAdminAuth,
  requireAdminPermission('edit_admins'),
  validateContentType,
  sanitizeInput,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword) {
        http.badRequest(res, 'MISSING_PASSWORD', 'New password is required', undefined, req);
        return;
      }

      if (newPassword.length < 8) {
        http.badRequest(res, 'WEAK_PASSWORD', 'Password must be at least 8 characters long', undefined, req);
        return;
      }

      const admin = await database.getAdmin(id);
      if (!admin) {
        http.notFound(res, 'ADMIN_NOT_FOUND', 'Admin not found', undefined, req);
        return;
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 12);
      
      await database.updateAdmin(id, { passwordHash });

      http.ok(res, { 
        message: `Password reset successfully for ${admin.email}`
      }, req);

      console.log(`🔐 Password reset for ${admin.email} by ${req.admin?.email}`);

    } catch (error) {
      console.error('Reset password error:', error);
      http.serverError(res, 'INTERNAL_ERROR', 'Failed to reset password', undefined, req);
    }
  }
);

export { router as adminManagementRouter };