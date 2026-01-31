import { Router, Request, Response } from 'express';
import { requireAdminAuth, requireAdminPermission } from '../../middleware/admin.middleware.js';
import { CustomerService } from '../../services/customer.service.js';
import { database } from '../../database/index.js';
import { http } from '../../utils/error.util.js';

/**
 * ===================================================================
 * ADMIN DASHBOARD ROUTES
 * ===================================================================
 * 
 * Handles admin dashboard data and metrics display.
 * 
 * These routes provide various views of system data for the admin dashboard:
 * - Business overview (customers, revenue, activity)
 * - Usage statistics (API calls, endpoints, customer usage)
 * - System health (uptime, memory, service status)
 * - Business metrics (detailed business analytics)
 * 
 * All routes require:
 * - Admin authentication (JWT token)
 * - 'view_all' permission
 * 
 * Routes:
 * - GET /overview - Business overview dashboard
 * - GET /usage/overview - Usage statistics and analytics
 * - GET /system-status - System health and status
 * - GET /metrics - Detailed business metrics
 */

/**
 * Registers admin dashboard routes.
 * 
 * @param router - Express router instance
 */
export function registerDashboardRoutes(router: Router) {
  /**
   * GET /overview
   * 
   * Get business overview dashboard data.
   * 
   * Returns high-level summary of business operations including:
   * - Customer count and status breakdown
   * - Recent activity and trends
   * - Key business metrics
   * 
   * Authentication: Admin JWT required
   * Permission: view_all
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "overview": {
   *       "totalCustomers": 150,
   *       "activeCustomers": 145,
   *       "totalApiCalls": 50000,
   *       "revenueThisMonth": 5000
   *     },
   *     "lastUpdated": "2024-12-19T10:00:00Z"
   *   }
   * }
   */
router.get(
    '/overview',
    requireAdminAuth,
    requireAdminPermission('view_dashboard'),
    async (req: Request, res: Response) => {
      try {
        // Get real business overview data from CustomerService
        const metrics = await CustomerService.getBusinessMetrics();
        const businessOverview = await database.getBusinessOverview();
        
        // Get all customers to calculate suspended count
        const { customers } = await database.listCustomers({});
        const suspendedCustomers = customers.filter(c => c.status === 'suspended').length;
        
        // Calculate real revenue from wallet transactions
        const allTransactions = await database.getAllWalletTransactions();
        
        // Calculate total revenue (all completed credit transactions)
        const totalRevenue = allTransactions
          .filter(txn => txn.type === 'credit' && txn.status === 'completed' && txn.paymentMethod !== 'admin')
          .reduce((sum, txn) => sum + txn.amount, 0);
        
        // Calculate revenue this month (completed credit transactions from this month)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const revenueThisMonth = allTransactions
          .filter(txn => 
            txn.type === 'credit' && 
            txn.status === 'completed' && 
            txn.paymentMethod !== 'admin' &&
            new Date(txn.createdAt) >= monthStart
          )
          .reduce((sum, txn) => sum + txn.amount, 0);
        
        // Map the data to match frontend expectations
        const overview = {
          totalCustomers: metrics.totalCustomers,
          activeCustomers: metrics.activeCustomers,
          suspendedCustomers: suspendedCustomers,
          totalApiKeys: metrics.totalApiKeys,
          activeApiKeys: metrics.activeApiKeys,
          totalApiCalls: metrics.totalUsageThisMonth,
          apiCallsToday: businessOverview.apiRequestsToday,
          apiCallsThisMonth: businessOverview.apiRequestsThisMonth,
          revenue: totalRevenue, // Total revenue in kobo from all completed payments
          revenueThisMonth: revenueThisMonth // Revenue this month in kobo
        };

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
   * GET /usage/overview
   * 
   * Get usage statistics and analytics.
   * 
   * Returns detailed usage analytics including:
   * - API calls by day (time series)
   * - Most popular endpoints
   * - Customer usage rankings
   * - Aggregate totals
   * 
   * Query Parameters:
   * - range: Time range (default: '30d')
   *   Options: '7d', '30d', '90d', 'all'
   * 
   * Authentication: Admin JWT required
   * Permission: view_all
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "totals": {
   *       "calls": 50000,
   *       "customers": 150,
   *       "activeCustomers": 145
   *     },
   *     "callsByDay": [
   *       { "date": "2024-12-01", "count": 1200 },
   *       { "date": "2024-12-02", "count": 1350 }
   *     ],
   *     "endpointsByCount": [
   *       { "path": "/business/name-search", "count": 25000 },
   *       { "path": "/business/company-registration", "count": 15000 }
   *     ],
   *     "customersByUsage": [
   *       { "customerId": "cust_123", "count": 5000 },
   *       { "customerId": "cust_456", "count": 3500 }
   *     ],
   *     "range": "30d"
   *   }
   * }
   */
router.get(
    '/usage/overview',
    requireAdminAuth,
    requireAdminPermission('view_usage_analytics'),
    async (req: Request, res: Response) => {
      try {
        const range = (req.query.range as string) || '30d';
        
        // Get all customers
        const { customers } = await database.listCustomers?.({}) || { customers: [] as any[] };

        // Aggregate usage data
        const callsByDayMap = new Map<string, number>();
        const endpointsMap = new Map<string, { count: number; totalResponseTime: number }>();
        const customersMap = new Map<string, { count: number; customer: any }>();

        let totalCalls = 0;
        let totalSuccessful = 0;
        let totalResponseTime = 0;

        for (const c of customers) {
          const records = await database.getUsage(c.id, range);
          customersMap.set(c.id, { 
            count: (customersMap.get(c.id)?.count || 0) + records.length,
            customer: c
          });
          
          for (const r of records) {
            totalCalls++;
            if (r.statusCode >= 200 && r.statusCode < 400) {
              totalSuccessful++;
            }
            totalResponseTime += r.responseTimeMs;

            // Aggregate by day
            const d = new Date(r.timestamp);
            const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
              .toISOString()
              .slice(0, 10);
            callsByDayMap.set(day, (callsByDayMap.get(day) || 0) + 1);
            
            // Aggregate by endpoint with response times
            const existing = endpointsMap.get(r.endpoint) || { count: 0, totalResponseTime: 0 };
            existing.count++;
            existing.totalResponseTime += r.responseTimeMs;
            endpointsMap.set(r.endpoint, existing);
          }
        }

        // Convert maps to sorted arrays
        const callsByDay = [...callsByDayMap.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));
          
        const topEndpoints = [...endpointsMap.entries()]
          .map(([endpoint, data]) => ({ 
            endpoint, 
            count: data.count,
            avgResponseTime: Math.round(data.totalResponseTime / data.count)
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
          
        const topCustomers = [...customersMap.entries()]
          .map(([customerId, data]) => ({ 
            customerId, 
            email: data.customer.email,
            company: data.customer.company,
            calls: data.count 
          }))
          .sort((a, b) => b.calls - a.calls)
          .slice(0, 10);

        // Build the usage object matching frontend expectations
        const usage = {
          totalCalls,
          callsToday: 0, // Would need date filtering
          callsThisWeek: 0, // Would need date filtering
          callsThisMonth: totalCalls,
          avgResponseTime: totalCalls > 0 ? Math.round(totalResponseTime / totalCalls) : 0,
          successRate: totalCalls > 0 ? totalSuccessful / totalCalls : 0,
          topEndpoints,
          topCustomers
        };

        return http.ok(res, {
          usage,
          totals: {
            calls: totalCalls,
            customers: customers.length,
            activeCustomers: customers.filter((c: any) => c.status === 'active').length,
          },
          callsByDay,
          endpointsByCount: topEndpoints.map(e => ({ path: e.endpoint, count: e.count })),
          customersByUsage: topCustomers.map(c => ({ customerId: c.customerId, count: c.calls })),
          range,
        }, req);
        
      } catch (error) {
        console.error('Admin usage overview error:', error);
        return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get usage overview', undefined, req);
      }
    }
  );

  /**
   * GET /system-status
   * 
   * Get system health and status information.
   * 
   * Returns system health metrics including:
   * - Overall status (healthy/degraded/down)
   * - Server uptime
   * - Memory usage
   * - Environment information
   * - External service health
   * 
   * Authentication: Admin JWT required
   * Permission: view_all
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "status": "healthy",
   *     "uptime": 86400,
   *     "memory": {
   *       "rss": 123456789,
   *       "heapTotal": 98765432,
   *       "heapUsed": 87654321
   *     },
   *     "timestamp": "2024-12-19T10:00:00Z",
   *     "version": "1.0.0",
   *     "environment": "production",
   *     "services": {
   *       "database": "connected",
   *       "documentsApi": "healthy",
   *       "paystack": "healthy"
   *     }
   *   }
   * }
   */
router.get(
    '/system-status',
    requireAdminAuth,
    requireAdminPermission('view_system_metrics'),
    async (req: Request, res: Response) => {
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

  /**
   * GET /metrics
   * 
   * Get detailed business metrics for admin dashboard.
   * 
   * Returns comprehensive business analytics including:
   * - Customer metrics (growth, churn, activation)
   * - Revenue metrics (MRR, ARR, ARPU)
   * - Usage metrics (API calls, popular endpoints)
   * - Performance metrics (response times, error rates)
   * 
   * Authentication: Admin JWT required
   * Permission: view_all
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "metrics": {
   *       "customers": {
   *         "total": 150,
   *         "active": 145,
   *         "new_this_month": 12
   *       },
   *       "revenue": {
   *         "mrr": 5000,
   *         "arr": 60000
   *       },
   *       "usage": {
   *         "api_calls_today": 1500,
   *         "api_calls_this_month": 45000
   *       }
   *     },
   *     "lastUpdated": "2024-12-19T10:00:00Z"
   *   }
   * }
   */
router.get(
    '/metrics',
    requireAdminAuth,
    requireAdminPermission('view_usage_analytics'),
    async (req: Request, res: Response) => {
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
}
