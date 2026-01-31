import bcrypt from 'bcrypt';
import { promises as fs } from 'fs';
import path from 'path';
import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
// Plans removed - pay-per-use model
// import { PLANS } from '../services/customer.service.js';
import {
  adminLogin,
  requireAdminAuth,
  requireAdminPermission,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword
} from '../middleware/admin.middleware.js';
import { validateContentType, sanitizeInput } from '../middleware/validation.middleware.js';
import { CustomerService } from '../services/customer.service.js';
import { database } from '../database/index.js';
import { http } from '../utils/error.util.js';
import { CustomerStore } from '../services/customerPortal.store.js';
import adminCustomersRoutes from './admin/customers.routes.js';
import { AdminStore } from '../services/admin.store.js';

/**
 * Check customer portal store for API key verification
 */
const checkCustomerPortalStoreForVerification = async (token: string) => {
  // Find customer with this API key
  for (const customer of CustomerStore['customers']) {
    for (const keyRecord of customer.apiKeys) {
      if (keyRecord.status === 'active') {
        // Check if the token matches the stored hash
        const isMatch = await bcrypt.compare(token, keyRecord.keyHash);
        if (isMatch) {
          // Found a match - return verification result
          return {
            match: true,
            customerId: customer.id,
            keyId: keyRecord.id,
            keyStatus: keyRecord.status,
            customerStatus: customer.status,
            source: 'customer_portal'
          };
        }
      }
    }
  }
  return null;
};

const router = Router();

/**
 * Admin Authentication Routes
 * Base path: /api/v1/admin
 */

/**
 * @route POST /admin/auth/login
 * @desc Admin login
 * @access Public (but admin credentials required)
 */
router.post(
  '/auth/login',
  validateContentType,
  sanitizeInput,
  adminLogin
);

/**
 * @route GET /admin/auth/profile
 * @desc Get admin profile (legacy path)
 * @access Admin only
 */
router.get(
  '/auth/profile',
  requireAdminAuth,
  getAdminProfile
);

/**
 * @route GET /admin/profile
 * @desc Get admin profile (standard REST path)
 * @access Admin only
 */
router.get(
  '/profile',
  requireAdminAuth,
  getAdminProfile
);

/**
 * @route PUT /admin/profile
 * @desc Update admin profile
 * @access Admin only
 */
router.put(
  '/profile',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  updateAdminProfile
);

/**
 * @route POST /admin/auth/change-password
 * @desc Change admin password
 * @access Admin only
 */
router.post(
  '/auth/change-password',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  changeAdminPassword
);

/**
 * @route GET /admin/overview
 * @desc Get business overview dashboard data
 * @access Admin only
 */
router.get(
  '/overview',
  requireAdminAuth,
  requireAdminPermission('view_all'),
  async (req, res) => {
    try {
      // Get real business overview data
      const overview = await CustomerService.getBusinessMetrics();

      return http.ok(res, {
        overview,
        lastUpdated: new Date().toISOString()
      }, req);

    } catch (error) {
      console.error('Admin overview error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get admin overview', undefined, req);
    }
  }
);

/**
 * @route GET /admin/system-status
 * @desc Get system health and status
 * @access Admin only
 */
router.get(
  '/usage/overview',
  requireAdminAuth,
  requireAdminPermission('view_all'),
  async (req, res) => {
    try {
      const range = (req.query.range as string) || '30d';
      // Use database listCustomers to aggregate usage consistently
      const { customers } = await database.listCustomers?.({}) || { customers: [] as any[] };

      const callsByDayMap = new Map<string, number>();
      const endpointsMap = new Map<string, number>();
      const customersMap = new Map<string, number>();

      for (const c of customers) {
        const records = await database.getUsage(c.id, range);
        customersMap.set(c.id, (customersMap.get(c.id) || 0) + records.length);
        for (const r of records) {
          const d = new Date(r.timestamp);
          const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
            .toISOString()
            .slice(0, 10);
          callsByDayMap.set(day, (callsByDayMap.get(day) || 0) + 1);
          endpointsMap.set(r.endpoint, (endpointsMap.get(r.endpoint) || 0) + 1);
        }
      }

      const callsByDay = [...callsByDayMap.entries()].map(([date, count]) => ({ date, count })).sort((a,b)=>a.date.localeCompare(b.date));
      const endpointsByCount = [...endpointsMap.entries()].map(([path, count]) => ({ path, count })).sort((a,b)=>b.count-a.count);
      const customersByUsage = [...customersMap.entries()].map(([customerId, count]) => ({ customerId, count })).sort((a,b)=>b.count-a.count);

      return http.ok(res, {
        totals: {
          calls: customersByUsage.reduce((sum, x) => sum + x.count, 0),
          customers: customers.length,
          activeCustomers: customers.filter((c: any) => c.status === 'active').length,
        },
        callsByDay,
        endpointsByCount,
        customersByUsage,
        range,
      });
    } catch (error) {
      console.error('Admin usage overview error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get usage overview');
    }
  }
);

router.get(
  '/system-status',
  requireAdminAuth,
  requireAdminPermission('view_all'),
  async (req, res) => {
    try {
      const systemStatus = {
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: 'connected', // TODO: Check actual database connection
          documentsApi: 'unknown', // TODO: Check Documents.com.ng API health
          paystack: 'unknown' // TODO: Check Paystack API health
        }
      };

      return http.ok(res, systemStatus, req);

    } catch (error) {
      console.error('System status error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get system status', undefined, req);
    }
  }
);

// Create new admin (super-admin only)
router.post('/admins', requireAdminAuth, requireAdminPermission('manage_system'), async (req, res) => {
  try {
    const { email, password, role = 'admin', permissions = [] } = req.body || {};
    if (!email || !password) {
      return http.badRequest(res, 'MISSING_FIELDS', 'email and password are required');
    }
    if (!['admin', 'super_admin'].includes(role)) {
      return http.badRequest(res, 'INVALID_ROLE', 'role must be admin or super_admin', undefined, req);
    }
    const rec = await AdminStore.create({ email, password, role, permissions });
    return http.created(res, { admin: { id: rec.id, email: rec.email, role: rec.role, permissions: rec.permissions, createdAt: rec.createdAt } }, req);
  } catch (e: any) {
    if (e?.message === 'ADMIN_EXISTS') {
      return http.badRequest(res, 'ADMIN_EXISTS', 'An admin with this email already exists', undefined, req);
    }
    return http.serverError(res, 'ADMIN_CREATE_FAILED', 'Failed to create admin', undefined, req);
  }
});

// Mount customer management routes
router.use('/customers', adminCustomersRoutes);

// Admin monitoring: per-customer usage
router.get(
  '/customers/:id/usage',
  requireAdminAuth,
  requireAdminPermission('view_all'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const range = (req.query.range as string) || '30d';

      // Fetch raw usage from database (memory-backed in local)
      const usage = await database.getUsage(id, range);

      // Aggregate by day
      const byDay = new Map<string, number>();
      const byEndpoint = new Map<string, number>();
      for (const u of usage) {
        const d = new Date(u.timestamp);
        const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
          .toISOString()
          .slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + 1);
        byEndpoint.set(u.endpoint, (byEndpoint.get(u.endpoint) || 0) + 1);
      }

      const callsByDay = [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a,b)=>a.date.localeCompare(b.date));
      const endpointsByCount = [...byEndpoint.entries()].map(([path, count]) => ({ path, count })).sort((a,b)=>b.count-a.count);

      return http.ok(res, {
        totals: { calls: usage.length },
        callsByDay,
        endpointsByCount,
        range
      });
    } catch (error) {
      console.error('Admin customer usage error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get customer usage');
    }
  }
);

/**
 * @route GET /admin/metrics
 * @desc Get business metrics for admin dashboard
 * @access Admin only
 */
router.get(
  '/metrics',
  requireAdminAuth,
  requireAdminPermission('view_all'),
  async (req, res) => {
    try {
      const metrics = await CustomerService.getBusinessMetrics();

      return http.ok(res, {
        metrics,
        lastUpdated: new Date().toISOString()
      }, req);

    } catch (error) {
      console.error('Admin metrics error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get business metrics', undefined, req);
    }
  }
);

/**
 * @route POST /admin/debug/verify-token
 * @desc Verify a raw customer API key (ck_...) against stored hashes (local debug only)
 * @access Super admin only (manage_system)
 */
router.post(
  '/debug/verify-token',
  requireAdminAuth,
  requireAdminPermission('manage_system'),
  async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token || typeof token !== 'string') {
        return http.badRequest(res, 'MISSING_TOKEN', 'token (ck_...) is required in body');
      }

      // First try the database-backed CustomerService
      const dbResult = await CustomerService.getCustomerByApiKey(token);

      if (dbResult) {
        const { customer, apiKey } = dbResult;
        return http.ok(res, {
          match: true,
          customerId: customer.id,
          keyId: apiKey.id,
          keyStatus: apiKey.status,
          customerStatus: customer.status,
          source: 'database'
        });
      }

      return http.ok(res, { match: false });
    } catch (e) {
      return http.serverError(res, 'DEBUG_VERIFY_FAILED', 'Failed to verify token');
    }
  }
);

/**
 * @route GET /admin/debug/plain-keys
 * @desc Read recent plain API key records from local NDJSON vault (masked)
 * @access Admin only
 * Query: limit (default 50)
 */
router.get(
  '/debug/plain-keys',
  requireAdminAuth,
  requireAdminPermission('view_metrics'),
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
      const target = process.env.PLAIN_KEY_FILE || path.join('.data', 'plain_api_keys.ndjson');
      let content = '';
      try {
        content = await fs.readFile(target, { encoding: 'utf8' });
      } catch (e) {
        return http.ok(res, { items: [], info: `No vault file found at ${target}` }, req);
      }
      const lines = content.split(/\r?\n/).filter(Boolean);
      const selected = lines.slice(-limit).map((line) => {
        try {
          const rec = JSON.parse(line);
          const plainKey = String(rec.plainKey || '');
          const last4 = plainKey.slice(-4);
          const masked = plainKey ? `ck_***${last4}` : '';
          return {
            customerId: rec.customerId,
            keyId: rec.keyId,
            keyPrefix: rec.keyPrefix,
            plainKeyMasked: masked,
            name: rec.name,
            createdAt: rec.createdAt,
          };
        } catch {
          return { parseError: true, raw: line } as any;
        }
      });
      return http.ok(res, { items: selected, file: target, count: selected.length }, req);
    } catch (error) {
      console.error('Read plain key vault error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to read plain key vault', undefined, req);
    }
  }
);

/**
 * @route GET /admin/debug/plain-keys-sqlite
 * @desc Read recent plain API key records from sqlite vault (masked)
 * @access Admin only
 * Query: limit (default 50)
 */
router.get(
  '/debug/plain-keys-sqlite',
  requireAdminAuth,
  requireAdminPermission('view_metrics'),
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
      try {
        const { getRecentPlainKeysSqlite } = await import('../utils/keyVaultSqlite.js');
        const items = await getRecentPlainKeysSqlite(limit);
        return http.ok(res, { items, count: items.length }, req);
      } catch (e) {
        return http.ok(res, { items: [], info: 'Sqlite vault not available' }, req);
      }
    } catch (error) {
      console.error('Read sqlite key vault error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to read sqlite key vault', undefined, req);
    }
  }
);

/**
 * @route POST /admin/debug/verify-token-detailed
 * @desc Verify a token against DB and return debugging details (admin-only)
 */
router.post(
  '/debug/verify-token-detailed',
  requireAdminAuth,
  requireAdminPermission('view_metrics'),
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const token: string = req.body?.token || '';
      if (!token || typeof token !== 'string') {
        return http.badRequest(res, 'MISSING_TOKEN', 'token is required in body');
      }
      const tokenPrefix = token.substring(0, 10);
      const keys = await database.listApiKeys();
      const candidates = keys.filter(k => k.keyPrefix === tokenPrefix && k.status === 'active');

      const details: any[] = [];
      for (const k of candidates) {
        const match = await bcrypt.compare(token, k.keyHash);
        details.push({ id: k.id, keyPrefix: k.keyPrefix, status: k.status, match });
      }

      const matched = details.find(d => d.match) || null;
      return http.ok(res, {
        tokenPrefix,
        candidates: details,
        matched
      });
    } catch (error) {
      console.error('verify-token-detailed error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to verify token');
    }
  }
);

/**
 * @route POST /admin/debug/import-plain-key
 * @desc Import a plaintext key from local vault(s) into DB (admin-only)
 * Body: { plainKey: string }
 */
router.post(
  '/debug/import-plain-key',
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const plainKey: string = req.body?.plainKey || '';
      if (!plainKey.startsWith('ck_')) {
        return http.badRequest(res, 'INVALID_PLAIN_KEY', 'plainKey must start with ck_');
      }
      const keyPrefix = plainKey.substring(0, 10);

      // Check DB first (prefix prefilter + bcrypt compare in sequence)
      const allKeys = await database.listApiKeys();
      const prefixed = allKeys.filter(k => k.keyPrefix === keyPrefix);
      let existing: any = null;
      for (const k of prefixed) {
        const match = await bcrypt.compare(plainKey, k.keyHash);
        if (match) { existing = k; break; }
      }
      if (existing) {
        return http.ok(res, { imported: false, info: 'Key already exists in DB', keyId: existing.id });
      }

      // Try sqlite vault first
      let rec: any = null;
      try {
        const { getRecentPlainKeysSqlite } = await import('../utils/keyVaultSqlite.js');
        const items = await getRecentPlainKeysSqlite(1000);
        rec = items.find(i => i.plainKey === plainKey);
      } catch {}

      // Fallback file vault
      if (!rec) {
        try {
          const target = process.env.PLAIN_KEY_FILE || path.join('.data', 'plain_api_keys.ndjson');
          const content = await fs.readFile(target, { encoding: 'utf8' });
          const lines = content.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            try { const obj = JSON.parse(line); if (obj.plainKey === plainKey) { rec = obj; break; } } catch {}
          }
        } catch {}
      }

      if (!rec || !rec.customerId) {
        return http.badRequest(res, 'NOT_FOUND_IN_VAULT', 'Plain key not found in local vaults');
      }

      // Ensure customer exists
      const customer = await database.getCustomer(rec.customerId) || await database.getCustomerByEmail(rec.email || '');
      if (!customer) {
        return http.badRequest(res, 'CUSTOMER_NOT_FOUND', 'Associated customer not found');
      }

      // Create DB key
      const keyHash = await bcrypt.hash(plainKey, 12);
      // Pay-per-use: plans removed
      const planCfg = { rateLimit: 60 };
      const created = await database.createApiKey({
        customerId: customer.id,
        keyHash,
        keyPrefix,
        name: rec.name || 'Imported Key',
        permissions: ['business:read', 'business:write'],
        status: 'active',
        requestsUsed: 0,
        rateLimitPerMin: 60, // Default rate limit
      });

      return http.ok(res, { imported: true, keyId: created.id, customerId: customer.id });
    } catch (error) {
      console.error('import-plain-key error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to import plain key');
    }
  }
);

/**
 * DEV ONLY: Reset admin password to match .env.vault
 */
import { initializeAdminUser } from '../middleware/admin.middleware.js';
router.post('/dev/reset-password', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return http.forbidden(res, 'FORBIDDEN', 'Not available in production');
    }
    // Force re-hash from current env values
    await initializeAdminUser();
    return http.ok(res, { reset: true, email: process.env.ADMIN_EMAIL }, req);
  } catch (e) {
    console.error('dev reset password error:', e);
    return http.serverError(res, 'RESET_FAILED', 'Failed to reset admin password');
  }
});

/**
 * DEV ONLY: Seed admin with provided email/password (overwrites in-memory config)
 * Body: { email: string, password: string }
 */
router.post('/dev/seed', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return http.forbidden(res, 'FORBIDDEN', 'Not available in production', undefined, req);
    }
    const email = (req.body?.email || '').trim();
    const password = (req.body?.password || '').trim();
    if (!email || !password) {
      return http.badRequest(res, 'MISSING_FIELDS', 'email and password are required', undefined, req);
    }
    const { AdminConfigStore } = await import('../config/adminConfig.store.js');
    await AdminConfigStore.setEmailAndPassword(email, password);
    return http.ok(res, { seeded: true, email, ts: new Date().toISOString() }, req);
  } catch (e) {
    console.error('dev seed admin error:', e);
    return http.serverError(res, 'SEED_FAILED', 'Failed to seed admin', undefined, req);
  }
});

/**
 * Admin audit: view own recent actions (DEV/OPS convenience)
 */
router.get('/audit/self', requireAdminAuth, async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50));
    const { database } = await import('../database/index.js');
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const adminId = req.admin?.id || 'unknown_admin';
    const customerId = `admin:${adminId}`;
    const usage = await database.getUsage(customerId, period);
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
});

export default router;



