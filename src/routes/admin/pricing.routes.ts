/**
 * Admin Pricing Routes
 * 
 * CRUD operations for service pricing management.
 * These prices determine how much customers are charged for each API service.
 * 
 * All prices are stored in kobo (100 kobo = ₦1) for precision.
 * 
 * Note: This integrates with the wallet system. When customers make payments
 * via Paystack, those funds are credited to their wallet, which is then
 * debited when they use API services based on these prices.
 * 
 * Routes:
 * - GET    /api/v1/admin/pricing           - List all service pricing
 * - GET    /api/v1/admin/pricing/:code     - Get pricing for specific service
 * - POST   /api/v1/admin/pricing           - Create new service pricing
 * - PUT    /api/v1/admin/pricing/:code     - Update service pricing
 * - DELETE /api/v1/admin/pricing/:code     - Delete service pricing
 * - POST   /api/v1/admin/pricing/seed      - Seed default pricing (dev/setup)
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { requireAdminAuth, requireAdminPermission } from '../../middleware/admin.middleware.js';
import { PricingService } from '../../services/pricing.service.js';
import { http } from '../../utils/error.util.js';

const router = Router();

/**
 * GET /api/v1/admin/pricing
 * List all service pricing
 * 
 * Query params:
 * - activeOnly: boolean - If true, only return active pricing (default: false)
 */
router.get(
  '/',
  requireAdminAuth,
  requireAdminPermission('view_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const activeOnly = req.query.activeOnly === 'true';
    const pricing = await PricingService.listPricing(activeOnly);

    // Format response with both kobo and naira for convenience
    const formattedPricing = pricing.map(p => ({
      id: p.id,
      serviceCode: p.serviceCode,
      serviceName: p.serviceName,
      priceKobo: p.priceKobo,
      priceNaira: p.priceKobo / 100,
      priceFormatted: PricingService.formatPrice(p.priceKobo),
      currency: p.currency,
      description: p.description,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));

    res.json({
      success: true,
      data: {
        pricing: formattedPricing,
        total: formattedPricing.length,
        activeCount: formattedPricing.filter(p => p.isActive).length
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /api/v1/admin/pricing/:code
 * Get pricing for a specific service
 */
router.get(
  '/:code',
  requireAdminAuth,
  requireAdminPermission('view_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;
    const pricing = await PricingService.getPrice(code);

    if (!pricing) {
      return http.notFound(res, 'PRICING_NOT_FOUND', `Pricing not found for service: ${code}`);
    }

    res.json({
      success: true,
      data: {
        id: pricing.id,
        serviceCode: pricing.serviceCode,
        serviceName: pricing.serviceName,
        priceKobo: pricing.priceKobo,
        priceNaira: pricing.priceKobo / 100,
        priceFormatted: PricingService.formatPrice(pricing.priceKobo),
        currency: pricing.currency,
        description: pricing.description,
        isActive: pricing.isActive,
        createdAt: pricing.createdAt,
        updatedAt: pricing.updatedAt
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /api/v1/admin/pricing
 * Create new service pricing
 * 
 * Body:
 * - serviceCode: string (required) - Unique identifier for the service (e.g., 'name-search')
 * - serviceName: string (required) - Human-readable name
 * - priceKobo: number (required) - Price in kobo (100 kobo = ₦1)
 * - description: string (optional) - Service description
 * - isActive: boolean (optional, default: true) - Whether pricing is active
 * 
 * Alternative: Can use priceNaira instead of priceKobo (will be converted)
 */
router.post(
  '/',
  requireAdminAuth,
  requireAdminPermission('edit_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const { serviceCode, serviceName, priceKobo, priceNaira, description, isActive } = req.body;

    // Validation
    if (!serviceCode || typeof serviceCode !== 'string') {
      return http.badRequest(res, 'INVALID_SERVICE_CODE', 'serviceCode is required and must be a string');
    }

    if (!serviceName || typeof serviceName !== 'string') {
      return http.badRequest(res, 'INVALID_SERVICE_NAME', 'serviceName is required and must be a string');
    }

    // Allow either priceKobo or priceNaira
    let finalPriceKobo: number;
    if (priceKobo !== undefined) {
      if (typeof priceKobo !== 'number' || priceKobo < 0) {
        return http.badRequest(res, 'INVALID_PRICE', 'priceKobo must be a non-negative number');
      }
      finalPriceKobo = Math.round(priceKobo);
    } else if (priceNaira !== undefined) {
      if (typeof priceNaira !== 'number' || priceNaira < 0) {
        return http.badRequest(res, 'INVALID_PRICE', 'priceNaira must be a non-negative number');
      }
      finalPriceKobo = Math.round(priceNaira * 100);
    } else {
      return http.badRequest(res, 'PRICE_REQUIRED', 'Either priceKobo or priceNaira is required');
    }

    // Check if service code already exists
    const existing = await PricingService.getPrice(serviceCode);
    if (existing) {
      return http.conflict(res, 'SERVICE_CODE_EXISTS', `Pricing already exists for service: ${serviceCode}`);
    }

    // Normalize service code (lowercase, hyphenated)
    const normalizedCode = serviceCode.toLowerCase().replace(/\s+/g, '-');

    const pricing = await PricingService.createPricing({
      serviceCode: normalizedCode,
      serviceName,
      priceKobo: finalPriceKobo,
      currency: 'NGN',
      description: description || '',
      isActive: isActive !== false // Default to true
    });

    res.status(201).json({
      success: true,
      message: 'Service pricing created successfully',
      data: {
        id: pricing.id,
        serviceCode: pricing.serviceCode,
        serviceName: pricing.serviceName,
        priceKobo: pricing.priceKobo,
        priceNaira: pricing.priceKobo / 100,
        priceFormatted: PricingService.formatPrice(pricing.priceKobo),
        currency: pricing.currency,
        description: pricing.description,
        isActive: pricing.isActive,
        createdAt: pricing.createdAt
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * PUT /api/v1/admin/pricing/:code
 * Update service pricing
 * 
 * Body (all optional):
 * - serviceName: string - Update display name
 * - priceKobo: number - Update price in kobo
 * - priceNaira: number - Update price in naira (alternative to priceKobo)
 * - description: string - Update description
 * - isActive: boolean - Enable/disable pricing
 */
router.put(
  '/:code',
  requireAdminAuth,
  requireAdminPermission('edit_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;
    const { serviceName, priceKobo, priceNaira, description, isActive } = req.body;

    // Check if pricing exists
    const existing = await PricingService.getPrice(code);
    if (!existing) {
      return http.notFound(res, 'PRICING_NOT_FOUND', `Pricing not found for service: ${code}`);
    }

    // Build updates object
    const updates: any = {};

    if (serviceName !== undefined) {
      if (typeof serviceName !== 'string' || serviceName.trim() === '') {
        return http.badRequest(res, 'INVALID_SERVICE_NAME', 'serviceName must be a non-empty string');
      }
      updates.serviceName = serviceName;
    }

    // Handle price update (prefer priceKobo over priceNaira if both provided)
    if (priceKobo !== undefined) {
      if (typeof priceKobo !== 'number' || priceKobo < 0) {
        return http.badRequest(res, 'INVALID_PRICE', 'priceKobo must be a non-negative number');
      }
      updates.priceKobo = Math.round(priceKobo);
    } else if (priceNaira !== undefined) {
      if (typeof priceNaira !== 'number' || priceNaira < 0) {
        return http.badRequest(res, 'INVALID_PRICE', 'priceNaira must be a non-negative number');
      }
      updates.priceKobo = Math.round(priceNaira * 100);
    }

    if (description !== undefined) {
      updates.description = description;
    }

    if (isActive !== undefined) {
      if (typeof isActive !== 'boolean') {
        return http.badRequest(res, 'INVALID_IS_ACTIVE', 'isActive must be a boolean');
      }
      updates.isActive = isActive;
    }

    // Check if there's anything to update
    if (Object.keys(updates).length === 0) {
      return http.badRequest(res, 'NO_UPDATES', 'No valid fields provided for update');
    }

    const pricing = await PricingService.updatePrice(code, updates);

    // Log the price change for audit purposes
    console.log(`[Admin Pricing] Service "${code}" updated by admin:`, {
      previousPrice: existing.priceKobo,
      newPrice: pricing.priceKobo,
      changes: updates
    });

    res.json({
      success: true,
      message: 'Service pricing updated successfully',
      data: {
        id: pricing.id,
        serviceCode: pricing.serviceCode,
        serviceName: pricing.serviceName,
        priceKobo: pricing.priceKobo,
        priceNaira: pricing.priceKobo / 100,
        priceFormatted: PricingService.formatPrice(pricing.priceKobo),
        currency: pricing.currency,
        description: pricing.description,
        isActive: pricing.isActive,
        updatedAt: pricing.updatedAt,
        previousPriceKobo: existing.priceKobo,
        previousPriceNaira: existing.priceKobo / 100
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * DELETE /api/v1/admin/pricing/:code
 * Delete service pricing
 * 
 * Warning: This will cause the service to become free (price = 0) 
 * unless re-added. Consider using isActive = false instead.
 */
router.delete(
  '/:code',
  requireAdminAuth,
  requireAdminPermission('edit_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;

    // Check if pricing exists
    const existing = await PricingService.getPrice(code);
    if (!existing) {
      return http.notFound(res, 'PRICING_NOT_FOUND', `Pricing not found for service: ${code}`);
    }

    await PricingService.deletePricing(code);

    // Log deletion for audit
    console.log(`[Admin Pricing] Service "${code}" deleted by admin:`, {
      deletedPricing: {
        serviceCode: existing.serviceCode,
        serviceName: existing.serviceName,
        priceKobo: existing.priceKobo
      }
    });

    res.json({
      success: true,
      message: 'Service pricing deleted successfully',
      data: {
        deletedServiceCode: code,
        deletedServiceName: existing.serviceName,
        warning: 'This service will now be free (price = 0) unless pricing is re-added'
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /api/v1/admin/pricing/seed
 * Seed default pricing for all services
 * 
 * This is useful for:
 * - Initial setup
 * - Resetting to default prices
 * - Development/testing
 * 
 * Only creates pricing for services that don't already have pricing.
 */
router.post(
  '/seed',
  requireAdminAuth,
  requireAdminPermission('edit_pricing'),
  asyncHandler(async (req: Request, res: Response) => {
    const { created, skipped } = await PricingService.seedDefaultPricing();

    res.json({
      success: true,
      message: `Default pricing seeded: ${created} created, ${skipped} skipped (already exist)`,
      data: {
        created,
        skipped,
        total: created + skipped
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * Register pricing routes on the admin router
 * Call this from admin/index.ts
 */
export function registerPricingRoutes(adminRouter: Router): void {
  adminRouter.use('/pricing', router);
}

export default router;
