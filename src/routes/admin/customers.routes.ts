/**
 * Admin Customer Management Routes
 * All customer management operations for admin dashboard
 */

import { Router, Request, Response } from 'express';
import { 
  requireAdminAuth, 
  requireAdminPermission 
} from '../../middleware/admin.middleware.js';
import { http } from '../../utils/error.util.js';
import { validateContentType, sanitizeInput } from '../../middleware/validation.middleware.js';
import { CustomerService, CreateCustomerRequest, CreateApiKeyRequest } from '../../services/customer.service.js';
import { database } from '../../database/index.js';

const router = Router();

/**
 * Admin Customer Management Routes
 * Base path: /api/v1/admin/customers
 */

/**
 * @route GET /admin/customers
 * @desc List all customers with pagination and search
 * @access Admin only
 */
router.get(
  '/',
  requireAdminAuth,
  requireAdminPermission('view_customers'),
  async (req: Request, res: Response) => {
    try {
      const {
        limit = 50,
        offset = 0,
        search,
        status
      } = req.query;

      const options = {
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        search: search as string,
        status: status as string
      };

      const result = await CustomerService.listCustomers(options);

      // Enhance customers with usage data
      const customersWithUsage = await Promise.all(
        result.customers.map(async (customer) => {
          try {
            const usageStats = await database.getUsageStats(customer.id);
            return {
              ...customer,
              usage: usageStats.totalCalls || 0
            };
          } catch (error) {
            console.error(`Failed to get usage for customer ${customer.id}:`, error);
            return {
              ...customer,
              usage: 0
            };
          }
        })
      );

      res.json({
        success: true,
        data: {
          customers: customersWithUsage,
          pagination: {
            total: result.total,
            limit: options.limit,
            offset: options.offset,
            hasMore: (options.offset + options.limit) < result.total
          }
        }
      });

    } catch (error) {
      console.error('List customers error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to list customers', undefined, req);
    }
  }
);

/**
 * @route POST /admin/customers
 * @desc Create a new customer
 * @access Admin only
 */
router.post(
  '/',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const customerData: CreateCustomerRequest = {
        email: req.body.email,
        company: req.body.company,
        // plan removed - pay-per-use
        passwordHash: req.body.passwordHash
      };

      // Validate input
      if (!customerData.email) {
        return http.badRequest(res, 'VALIDATION_ERROR', 'Email is required', undefined, req);
        return;
      }

      // Pay-per-use: no plan validation

      const customer = await CustomerService.createCustomer(customerData);

      return http.created(res, {
          customer,
          message: 'Customer created successfully'
        }, req);

    } catch (error) {
      console.error('Create customer error:', error);
      
      if (error instanceof Error && error.message.includes('already exists')) {
        return http.conflict(res, 'CUSTOMER_EXISTS', error.message
          , undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to create customer', undefined, req);
    }
  }
);

/**
 * @route GET /admin/customers/:customerId
 * @desc Get customer details with API keys and usage
 * @access Admin only
 */
router.get(
  '/:customerId',
  requireAdminAuth,
  requireAdminPermission('view_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const customerDetails = await CustomerService.getCustomerDetails(customerId);

      return http.ok(res, {
        customer: customerDetails
      }, req);

    } catch (error) {
      console.error('Get customer error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get customer details', undefined, req);
    }
  }
);

/**
 * @route PUT /admin/customers/:customerId
 * @desc Update customer details
 * @access Admin only
 */
router.put(
  '/:customerId',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const updates = {
        email: req.body.email,
        company: req.body.company,
        plan: req.body.plan,
        status: req.body.status
      };

      // Remove undefined fields
      Object.keys(updates).forEach(key => {
        if (updates[key as keyof typeof updates] === undefined) {
          delete updates[key as keyof typeof updates];
        }
      });

      const customer = await CustomerService.updateCustomer(customerId, updates);

      res.json({
        success: true,
        data: {
          customer,
          message: 'Customer updated successfully'
        }
      });

    } catch (error) {
      console.error('Update customer error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to update customer', undefined, req);
    }
  }
);

/**
 * @route POST /admin/customers/:customerId/suspend
 * @desc Suspend customer account
 * @access Admin only
 */
router.post(
  '/:customerId/suspend',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const { reason } = req.body;

      await CustomerService.suspendCustomer(customerId, reason);

      res.json({
        success: true,
        data: {
          message: 'Customer suspended successfully',
          customerId,
          reason: reason || 'No reason provided'
        }
      });

    } catch (error) {
      console.error('Suspend customer error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to suspend customer', undefined, req);
    }
  }
);

/**
 * @route POST /admin/customers/:customerId/activate
 * @desc Activate suspended customer account
 * @access Admin only
 */
router.post(
  '/:customerId/activate',
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;

      await CustomerService.activateCustomer(customerId);

      res.json({
        success: true,
        data: {
          message: 'Customer activated successfully',
          customerId
        }
      });

    } catch (error) {
      console.error('Activate customer error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to activate customer', undefined, req);
    }
  }
);

/**
 * @route POST /admin/customers/:customerId/keys
 * @desc Generate new API key for customer
 * @access Admin only
 */
router.post(
  '/:customerId/keys',
  validateContentType,
  sanitizeInput,
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const keyRequest: CreateApiKeyRequest = {
        customerId,
        name: req.body.name || 'Admin Generated Key',
        permissions: req.body.permissions,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined
      };

      const result = await CustomerService.generateApiKey(keyRequest);

      return http.created(res, {
        apiKey: {
          ...result.apiKey,
          keyHash: undefined // Don't return hash
        },
        plainKey: result.plainKey,
        message: 'API key generated successfully',
        warning: 'Save the plain key now - it will not be shown again'
      }, req);

    } catch (error) {
      console.error('Generate API key error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to generate API key', undefined, req);
    }
  }
);

/**
 * @route GET /admin/customers/api-keys
 * @desc List ALL API keys from ALL customers
 * @access Admin only
 */
router.get(
  '/api-keys',
  requireAdminAuth,
  requireAdminPermission('view_api_keys'),
  async (req: Request, res: Response) => {
    try {
      // Get filters from query params
      const { status, customerId } = req.query;
      
      // Get all customers
      const customersResult = await CustomerService.listCustomers();
      const customers = customersResult.customers;
      
      // Collect all API keys with customer info
      const allApiKeys: any[] = [];
      
      for (const customer of customers) {
        const keys = await CustomerService.listApiKeys(customer.id);
        
        // Add customer info to each key
        keys.forEach(key => {
          // Apply filters
          if (status && key.status !== status) return;
          if (customerId && customer.id !== customerId) return;
          
          allApiKeys.push({
            ...key,
            keyHash: undefined, // Don't expose hash
            customer: {
              id: customer.id,
              email: customer.email,
              company: customer.company
            }
          });
        });
      }

      return res.json({
        success: true,
        data: {
          apiKeys: allApiKeys
        }
      });
    } catch (error) {
      console.error('List all API keys error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to list API keys', undefined, req);
    }
  }
);

/**
 * @route GET /admin/customers/:customerId/keys
 * @desc List customer's API keys
 * @access Admin only
 */
router.get(
  '/:customerId/keys',
  requireAdminAuth,
  requireAdminPermission('view_api_keys'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      
      // Verify customer exists
      await CustomerService.getCustomerDetails(customerId);
      
      const apiKeys = await CustomerService.listApiKeys(customerId);

      res.json({
        success: true,
        data: {
          apiKeys: apiKeys.map(key => ({
            ...key,
            keyHash: undefined // Don't expose hash
          }))
        }
      });

    } catch (error) {
      console.error('List API keys error:', error);
      
      if (error instanceof Error && error.message === 'Customer not found') {
        return http.notFound(res, 'CUSTOMER_NOT_FOUND', 'Customer not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to list API keys', undefined, req);
    }
  }
);

/**
 * @route DELETE /admin/customers/:customerId/keys/:keyId
 * @desc Revoke customer's API key
 * @access Admin only
 */
router.delete(
  '/:customerId/keys/:keyId',
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { keyId } = req.params;

      await CustomerService.revokeApiKey(keyId);

      res.json({
        success: true,
        data: {
          message: 'API key revoked successfully',
          keyId
        }
      });

    } catch (error) {
      console.error('Revoke API key error:', error);
      
      if (error instanceof Error && error.message === 'API key not found') {
        return http.notFound(res, 'API_KEY_NOT_FOUND', 'API key not found', undefined, req);
        return;
      }

      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to revoke API key', undefined, req);
    }
  }
);

/**
 * @route POST /admin/customers/:customerId/sync-portal-keys
 * @desc Migrate any in-memory portal keys into the database for this customer
 * @access Admin only
 */
router.post(
  '/:customerId/sync-portal-keys',
  requireAdminAuth,
  requireAdminPermission('manage_customers'),
  async (req: Request, res: Response) => {
    try {
      const { customerId } = req.params;
      const result = await CustomerService.syncPortalKeysToDatabase(customerId);
      res.json({
        success: true,
        data: {
          migrated: result.migrated,
          skipped: result.skipped
        }
      });
    } catch (error) {
      console.error('Sync portal keys error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to sync portal keys', undefined, req);
    }
  }
);

/**
 * GET /customers/wallet/transactions
 * Get all wallet transactions across all customers (for revenue tracking)
 * 
 * @route   GET /api/v1/admin/customers/wallet/transactions
 * @desc    Fetch paginated wallet transactions with customer details for admin revenue tracking
 * @access  Private (Admin only - requires view_all permission)
 * 
 * @queryparam {number} limit - Max items per page (default: 50, max: 100)
 * @queryparam {number} offset - Pagination offset (default: 0)
 * @queryparam {string} type - Filter by transaction type: 'all' | 'credit' | 'debit' (default: 'all')
 * @queryparam {string} startDate - ISO date string for filtering transactions after this date
 * @queryparam {string} endDate - ISO date string for filtering transactions before this date
 * 
 * @performance
 * - Uses database indexes on customer_id, type, created_at
 * - Implements strict pagination to limit memory usage
 * - Calculates summary stats efficiently using reduce
 * 
 * @returns {Object} Paginated transactions with customer info and revenue summary
 * 
 * @example
 * GET /api/v1/admin/customers/wallet/transactions?type=credit&limit=20
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transactions": [...],
 *     "pagination": { "total": 100, "limit": 20, "offset": 0, "hasMore": true },
 *     "summary": {
 *       "totalCredits": 1000000,  // in kobo
 *       "totalDebits": 50000,
 *       "netRevenue": 950000,
 *       "transactionCount": 100
 *     }
 *   }
 * }
 */
router.get(
  '/wallet/transactions',
  requireAdminAuth,
  requireAdminPermission('view_wallet_transactions'),
  async (req: Request, res: Response) => {
    try {
    const { limit = '50', offset = '0', type = 'all', startDate, endDate } = req.query;

    // OPTIMIZATION: Enforce strict pagination limits to prevent memory issues
    const limitNum = Math.min(parseInt(limit as string, 10), 100);
    const offsetNum = parseInt(offset as string, 10);

    // PERFORMANCE NOTE: getAllWalletTransactions() is cached and uses database index on created_at
    // TODO: Implement database-level filtering instead of in-memory filtering for better performance
    const allTransactions = await database.getAllWalletTransactions();

    // Filter by type
    let filtered = allTransactions;
    if (type === 'credit') {
      filtered = allTransactions.filter(t => t.type === 'credit');
    } else if (type === 'debit') {
      filtered = allTransactions.filter(t => t.type === 'debit');
    }

    // Filter by date range
    if (startDate) {
      const start = new Date(startDate as string);
      filtered = filtered.filter(t => new Date(t.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate as string);
      filtered = filtered.filter(t => new Date(t.createdAt) <= end);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = filtered.length;
    const transactions = filtered.slice(offsetNum, offsetNum + limitNum);

    // OPTIMIZATION: Batch fetch customers to avoid N+1 query problem
    // Instead of querying database for each transaction, we:
    // 1. Get unique customer IDs from transactions
    // 2. Fetch all customers in one query (if we had a batch method)
    // 3. Map customers to transactions
    // 
    // NOTE: Current implementation still has N+1 issue - needs database.getCustomersByIds() method
    // TODO: Implement batch customer fetching for better performance
    const uniqueCustomerIds = [...new Set(transactions.map(t => t.customerId))];
    
    // For now, we'll use Promise.all to at least parallelize the queries
    const customerMap = new Map<string, any>();
    await Promise.all(
      uniqueCustomerIds.map(async (customerId) => {
        const customer = await database.getCustomer(customerId);
        if (customer) {
          // OPTIMIZATION: Only include necessary fields to reduce payload size
          customerMap.set(customerId, {
            id: customer.id,
            email: customer.email,
            company: customer.company,
            fullName: customer.full_name || ''
          });
        }
      })
    );

    // Map customers to transactions using the cached customer data
    const transactionsWithCustomers = transactions.map(txn => ({
      ...txn,
      customer: customerMap.get(txn.customerId) || null
    }));

    // Calculate summary stats - ONLY COMPLETED TRANSACTIONS
    // Credits = Money customers added to their wallets (revenue for business)
    const totalCredits = filtered
      .filter(t => t.type === 'credit' && t.status === 'completed' && t.paymentMethod !== 'admin')
      .reduce((sum, t) => sum + t.amount, 0);
    
    // Debits = Money customers spent on API calls (already stored as positive amounts)
    const totalDebits = filtered
      .filter(t => t.type === 'debit' && t.status === 'completed')
      .reduce((sum, t) => {
        // Debits are stored as negative, so we need to get absolute value
        const amount = t.amount < 0 ? Math.abs(t.amount) : t.amount;
        return sum + amount;
      }, 0);

    // Net Revenue = Total credits from customers (excluding admin credits)
    // This represents actual revenue from customer payments
    const netRevenue = totalCredits;

    res.json({
      success: true,
      data: {
        transactions: transactionsWithCustomers,
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < total
        },
        summary: {
          totalCredits,
          totalDebits,
          netRevenue,
          transactionCount: total
        }
      },
      timestamp: new Date().toISOString()
    });
    } catch (error: any) {
      console.error('[Admin] Get wallet transactions error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch transactions',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

export default router;
