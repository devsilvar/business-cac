import { Router } from 'express';
import { registerAuthRoutes } from './auth.routes.js';
import { registerDashboardRoutes } from './dashboard.routes.js';
import { registerSystemRoutes } from './system.routes.js';
import { registerMonitoringRoutes } from './monitoring.routes.js';
import adminCustomersRoutes from './customers.routes.js';
import { registerVerificationRoutes } from './verification.register.js';
import { registerPricingRoutes } from './pricing.routes.js';
import { adminManagementRouter } from './admin.routes.js';

/**
 * ===================================================================
 * ADMIN ROUTES BARREL ROUTER
 * ===================================================================
 * 
 * This router aggregates all admin-related sub-routers.
 * 
 * Migration Status: ✅ COMPLETE (Phase 7)
 * - All routes migrated to modular structure
 * - Legacy admin.routes.ts deprecated
 * 
 * Admin Routes Structure:
 * - auth.routes.ts: Admin login, profile, password management (5 routes)
 * - dashboard.routes.ts: Dashboard data, metrics, system status (4 routes)
 * - customers.routes.ts: Customer management (10 routes)
 * - system.routes.ts: Admin management, audit logs (2 routes)
 * 
 * Total: 21 core admin routes
 * 
 * Note: Debug and dev routes remain in legacy admin.routes.ts
 * They are optional development utilities and can be removed in production.
 * 
 * Base Path: /api/v1/admin
 * 
 * Authentication:
 * - All routes require admin JWT authentication
 * - Some routes require specific permissions (view_all, manage_customers, manage_system)
 * 
 * Route Structure:
 * ```
 * /api/v1/admin/
 * ├── /auth/login              POST   - Admin login
 * ├── /auth/profile            GET    - Get profile (legacy)
 * ├── /profile                 GET    - Get profile
 * ├── /profile                 PUT    - Update profile
 * ├── /auth/change-password    POST   - Change password
 * ├── /overview                GET    - Dashboard overview
 * ├── /usage/overview          GET    - Usage statistics
 * ├── /system-status           GET    - System health
 * ├── /metrics                 GET    - Business metrics
 * ├── /admins                  POST   - Create admin
 * ├── /audit/self              GET    - Admin audit log
 * ├── /customers/...           *      - Customer management (10 routes)
 * └── /pricing/...             *      - Service pricing management (6 routes)
 *     ├── GET    /             - List all pricing
 *     ├── GET    /:code        - Get specific service pricing
 *     ├── POST   /             - Create new pricing
 *     ├── PUT    /:code        - Update pricing
 *     ├── DELETE /:code        - Delete pricing
 *     └── POST   /seed         - Seed default pricing
 * ```
 */

export const adminRouter = Router();

// Register all admin routes
registerAuthRoutes(adminRouter);
registerDashboardRoutes(adminRouter);
registerSystemRoutes(adminRouter);
registerMonitoringRoutes(adminRouter);
registerVerificationRoutes(adminRouter);
registerPricingRoutes(adminRouter);  // Service pricing management

// Mount customer management routes at /customers
adminRouter.use('/customers', adminCustomersRoutes);

// Mount admin management routes at /management
adminRouter.use('/management', adminManagementRouter);

export default adminRouter;
