/**
 * Pricing Service
 * Manages service pricing for all API endpoints
 * Prices are stored in kobo (100 kobo = ₦1)
 */

import { database, ServicePricing, ServicePricingData } from '../database/index.js';

// Default pricing in kobo (from valv.txt)
const DEFAULT_PRICING: Omit<ServicePricingData, 'isActive'>[] = [
  { serviceCode: 'name-search', serviceName: 'CAC Name Search', priceKobo: 10000, currency: 'NGN', description: 'Search for business names in CAC registry' },
  { serviceCode: 'name-registration', serviceName: 'CAC Name Registration', priceKobo: 4000000, currency: 'NGN', description: 'Register a new business name with CAC' },
  { serviceCode: 'company-registration', serviceName: 'CAC Company Registration', priceKobo: 9000000, currency: 'NGN', description: 'Register a new company with CAC' },
  { serviceCode: 'drivers-license-verification', serviceName: "Driver's License Verification", priceKobo: 15000, currency: 'NGN', description: 'Verify Nigerian driver\'s license' },
  { serviceCode: 'passport-verification', serviceName: 'Passport Verification', priceKobo: 15000, currency: 'NGN', description: 'Verify Nigerian passport' },
  { serviceCode: 'voters-card-verification', serviceName: "Voter's Card Verification", priceKobo: 15000, currency: 'NGN', description: 'Verify Nigerian voter\'s card (PVC)' },
  { serviceCode: 'passport-face-verification', serviceName: 'Passport Face Verification', priceKobo: 20000, currency: 'NGN', description: 'Verify passport with face matching' },
  { serviceCode: 'bvn-basic', serviceName: 'BVN Basic Verification', priceKobo: 10000, currency: 'NGN', description: 'Basic BVN verification' },
];

// In-memory cache for pricing (to avoid repeated DB calls)
let pricingCache: Map<string, ServicePricing> | null = null;
let cacheLastUpdated: Date | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

export class PricingService {
  /**
   * Initialize default pricing in the database if not exists
   */
  static async seedDefaultPricing(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const pricing of DEFAULT_PRICING) {
      try {
        const existing = await database.getServicePricing(pricing.serviceCode);
        if (existing) {
          skipped++;
          continue;
        }

        await database.createServicePricing({
          ...pricing,
          isActive: true
        });
        created++;
      } catch (error) {
        console.error(`Failed to seed pricing for ${pricing.serviceCode}:`, error);
      }
    }

    // Invalidate cache after seeding
    pricingCache = null;

    return { created, skipped };
  }

  /**
   * Get pricing for a specific service
   * Returns null if service not found or inactive
   */
  static async getPrice(serviceCode: string): Promise<ServicePricing | null> {
    // Check cache first
    if (pricingCache && cacheLastUpdated) {
      const cacheAge = Date.now() - cacheLastUpdated.getTime();
      if (cacheAge < CACHE_TTL_MS) {
        const cached = pricingCache.get(serviceCode);
        if (cached && cached.isActive) {
          return cached;
        }
        // If in cache but inactive or not found, still return from cache
        if (cached) return null;
      }
    }

    // Fetch from database
    const pricing = await database.getServicePricing(serviceCode);
    
    // Update cache with this single item
    if (pricing) {
      if (!pricingCache) {
        pricingCache = new Map();
        cacheLastUpdated = new Date();
      }
      pricingCache.set(serviceCode, pricing);
    }

    return pricing?.isActive ? pricing : null;
  }

  /**
   * Get price in kobo for a service
   * Returns 0 if service not found (allows free services)
   */
  static async getPriceKobo(serviceCode: string): Promise<number> {
    const pricing = await this.getPrice(serviceCode);
    return pricing?.priceKobo ?? 0;
  }

  /**
   * Get price in Naira for a service
   */
  static async getPriceNaira(serviceCode: string): Promise<number> {
    const priceKobo = await this.getPriceKobo(serviceCode);
    return priceKobo / 100;
  }

  /**
   * List all pricing (optionally only active)
   */
  static async listPricing(activeOnly: boolean = false): Promise<ServicePricing[]> {
    const pricing = await database.listServicePricing(activeOnly);
    
    // Update cache
    pricingCache = new Map(pricing.map(p => [p.serviceCode, p]));
    cacheLastUpdated = new Date();

    return pricing;
  }

  /**
   * Update pricing for a service
   */
  static async updatePrice(
    serviceCode: string, 
    updates: { priceKobo?: number; serviceName?: string; description?: string; isActive?: boolean }
  ): Promise<ServicePricing> {
    const updated = await database.updateServicePricing(serviceCode, updates);
    
    // Invalidate cache
    pricingCache = null;

    return updated;
  }

  /**
   * Create a new service pricing
   */
  static async createPricing(data: ServicePricingData): Promise<ServicePricing> {
    const pricing = await database.createServicePricing(data);
    
    // Invalidate cache
    pricingCache = null;

    return pricing;
  }

  /**
   * Delete a service pricing
   */
  static async deletePricing(serviceCode: string): Promise<void> {
    await database.deleteServicePricing(serviceCode);
    
    // Invalidate cache
    pricingCache = null;
  }

  /**
   * Invalidate pricing cache (useful after admin updates)
   */
  static invalidateCache(): void {
    pricingCache = null;
    cacheLastUpdated = null;
  }

  /**
   * Map endpoint path to service code
   * e.g., '/api/v1/business/name-search' -> 'name-search'
   * e.g., '/api/v1/business/identity/passport-verification/A123' -> 'passport-verification'
   */
  static getServiceCodeFromEndpoint(endpoint: string): string | null {
    // Remove query string if present
    const pathOnly = endpoint.split('?')[0];
    const segments = pathOnly.split('/').filter(Boolean);
    
    // Known service codes from pricing
    const knownServiceCodes = [
      'name-search',
      'name-registration',
      'company-registration',
      'drivers-license-verification',
      'passport-verification',
      'voters-card-verification',
      'passport-face-verification',
      'bvn-basic'
    ];
    
    // Check if any segment matches a known service code
    for (const segment of segments) {
      if (knownServiceCodes.includes(segment)) {
        return segment;
      }
    }
    
    // Fallback: Look for business routes pattern
    const businessIndex = segments.indexOf('business');
    if (businessIndex !== -1 && segments.length > businessIndex + 1) {
      // Skip 'identity' if present and get the actual service
      const nextSegment = segments[businessIndex + 1];
      if (nextSegment === 'identity' && segments.length > businessIndex + 2) {
        return segments[businessIndex + 2];
      }
      return nextSegment;
    }

    // Last fallback: use the second-to-last segment (before any ID params)
    if (segments.length >= 2) {
      const lastSegment = segments[segments.length - 1];
      // If last segment looks like an ID (contains numbers), use second-to-last
      if (/[0-9]/.test(lastSegment)) {
        return segments[segments.length - 2];
      }
      return lastSegment;
    }

    return segments[segments.length - 1] || null;
  }

  /**
   * Format price for display
   */
  static formatPrice(kobo: number): string {
    const naira = kobo / 100;
    return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
