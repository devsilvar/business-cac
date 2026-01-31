/**
 * Customer Service
 * Handles customer operations, API key generation, and management
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { database } from '../database/index.js';
import type { Customer, CustomerData, ApiKey, ApiKeyData } from '../database/index.js';
import { CustomerStore } from './customerPortal.store.js';
import { savePlainApiKey } from '../utils/keyVault.js';

export interface CreateCustomerRequest {
  email: string;
  company?: string;
  // plan removed - pay-per-use pricing model
  full_name?: string;
  nin_bvn?: string;
  phone_number?: string;
  id_document?: string;
  passwordHash?: string; // FIXED: Add passwordHash to customer creation
}

export interface CreateApiKeyRequest {
  customerId: string;
  name: string;
  permissions?: string[];
  expiresAt?: Date;
}

export interface CustomerWithKeys extends Customer {
  apiKeys: ApiKey[];
  usage: {
    requestsThisMonth: number;
    requestsToday: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number;
    lastUsed?: Date;
    lastCallAt?: Date;
  };
}

/**
 * Plan configurations
 */
// Plans removed - pay-per-use pricing model
// (left here as historical reference)
/*
/*
export const PLANS = {
  basic: {
    price: 50, // USD per month
    requests: 1000,
    rateLimit: 10, // per minute
    features: ["Business Registration", "Name Search"]
  },
  pro: {
    price: 150, // USD per month
    requests: 5000,
    rateLimit: 30, // per minute
    features: ["All Basic", "Status Tracking", "Priority Support"]
  }
} as const;
*/

export class CustomerService {
  /**
   * Sync any customer portal (in-memory) API keys into the primary database so Admin can see them
   * and auth uses a single source of truth. If customerId is provided, sync only that customer.
   */
  static async syncPortalKeysToDatabase(customerId?: string): Promise<{ migrated: number; skipped: number }> {
    let migrated = 0;
    let skipped = 0;
    try {
      await database.initialize();
      const customers = (CustomerStore as any).customers || [];
      for (const c of customers) {
        if (customerId && c.id !== customerId) continue;
        // Ensure the customer exists in DB
        const dbCustomer = await database.getCustomer(c.id) || await database.getCustomerByEmail(c.email);
        if (!dbCustomer) {
          // If the portal customer isn't in DB, skip gracefully
          skipped += (c.apiKeys?.length || 0);
          continue;
        }
        // Plan config removed - using wallet-based pricing
        for (const keyRecord of c.apiKeys || []) {
          // Check if this key hash already exists in DB
          const existing = await database.getApiKeyByHash(keyRecord.keyHash);
          if (existing) {
            skipped++;
            continue;
          }
          // Create in DB using the same hash; prefix unknown (no plain token), set to a marker
          const apiKeyData: ApiKeyData = {
            customerId: dbCustomer.id,
            keyHash: keyRecord.keyHash,
            keyPrefix: 'ck_portal',
            name: keyRecord.name || 'Portal Key',
            permissions: ['business:read', 'business:write'],
            status: keyRecord.status === 'active' ? 'active' : 'revoked',
            requestsUsed: 0,
            rateLimitPerMin: 60,
            expiresAt: undefined
          };
          await database.createApiKey(apiKeyData);
          migrated++;
        }
      }
      return { migrated, skipped };
    } catch (e) {
      console.error('syncPortalKeysToDatabase error:', e);
      return { migrated, skipped };
    }
  }
  /**
   * Create a new customer
   */
  static async createCustomer(customerData: CreateCustomerRequest): Promise<Customer> {
    // Check if customer already exists
    const existingCustomer = await database.getCustomerByEmail(customerData.email);
    if (existingCustomer) {
      const error = new Error('Customer already exists');
      error.name = 'CustomerExistsError';
      throw error;
    }

    // Pay-per-use: no plan validation

    // Create customer with all fields including passwordHash
    const customer = await database.createCustomer({
      email: customerData.email,
      company: customerData.company,
      walletBalance: 1000000,
      status: 'active',
      passwordHash: customerData.passwordHash, // FIXED: Pass passwordHash to database
      full_name: customerData.full_name,
      nin_bvn: customerData.nin_bvn,
      phone_number: customerData.phone_number,
      id_document: customerData.id_document
    });

    return customer;
  }

  /**
   * Generate API key for customer
   */
  static async generateApiKey(request: CreateApiKeyRequest): Promise<{ apiKey: ApiKey; plainKey: string }> {
    // Verify customer exists
    const customer = await database.getCustomer(request.customerId);
    if (!customer) {
      const error = new Error('Customer not found');
      error.name = 'CustomerNotFoundError';
      throw error;
    }

    // Generate random API key (ck_ prefix for customer keys)
    const plainKey = `ck_${crypto.randomBytes(16).toString('hex')}`;
    const keyHash = await bcrypt.hash(plainKey, 12);
    const keyPrefix = plainKey.substring(0, 10); // ck_ + first 8 chars

    // Get plan configuration
    // Plan config removed

    // Create API key data
    const apiKeyData: ApiKeyData = {
      customerId: request.customerId,
      keyHash,
      keyPrefix,
      name: request.name,
      permissions: request.permissions || ['business:read', 'business:write'],
      // plan removed
      status: 'active',
      requestsUsed: 0,
      // requestsLimit removed
      rateLimitPerMin: 60,
      expiresAt: request.expiresAt
    };

    const apiKey = await database.createApiKey(apiKeyData);

    // Optionally persist the plain key locally for ops/debug (DEV ONLY)
    if (process.env.SAVE_PLAIN_KEYS === '1' || process.env.SAVE_PLAIN_KEYS === 'true') {
      try {
        await savePlainApiKey({
          customerId: request.customerId,
          keyId: apiKey.id,
          keyPrefix,
          plainKey,
          name: request.name,
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn('[auth] Failed to save plain API key to local vault:', (e as Error).message);
      }
    }

    // Optionally persist to sqlite vault if enabled (DEV ONLY)
    if (process.env.SAVE_PLAIN_KEYS_SQLITE === '1' || process.env.SAVE_PLAIN_KEYS_SQLITE === 'true') {
      try {
        const { savePlainApiKeySqlite } = await import('../utils/keyVaultSqlite.js');
        await savePlainApiKeySqlite({
          customerId: request.customerId,
          keyId: apiKey.id,
          keyPrefix,
          plainKey,
          name: request.name,
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn('[auth] Failed to save plain API key to sqlite vault:', (e as Error).message);
      }
    }

    return {
      apiKey,
      plainKey // Return plain key once for customer to save
    };
  }

  /**
   * Get customer with keys and usage
   */
  static async getCustomerDetails(customerId: string): Promise<CustomerWithKeys> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      const error = new Error('Customer not found');
      error.name = 'CustomerNotFoundError';
      throw error;
    }

    const apiKeys = await database.listApiKeys(customerId);
    const usageStats = await database.getUsageStats(customerId);

    return {
      ...customer,
      apiKeys,
      usage: {
        requestsThisMonth: usageStats.requestsThisMonth,
        requestsToday: usageStats.requestsToday,
        totalCalls: usageStats.totalCalls,
        successfulCalls: usageStats.successfulCalls,
        failedCalls: usageStats.failedCalls,
        successRate: usageStats.successRate,
        lastUsed: apiKeys.length > 0 ? apiKeys[0]?.lastUsed : undefined,
        lastCallAt: usageStats.lastCallAt
      }
    };
  }

  /**
   * List customers with pagination and search
   */
  static async listCustomers(options: {
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
  } = {}) {
    return await database.listCustomers(options);
  }

  /**
   * Update customer
   */
  static async updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      const error = new Error('Customer not found');
      error.name = 'CustomerNotFoundError';
      throw error;
    }

    // Pay-per-use: no plan updates

    return await database.updateCustomer(customerId, updates);
  }

  /**
   * Suspend customer (soft delete)
   */
  static async suspendCustomer(customerId: string, reason?: string): Promise<void> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      const error = new Error('Customer not found');
      error.name = 'CustomerNotFoundError';
      throw error;
    }

    // Update customer status
    await database.updateCustomer(customerId, { status: 'suspended' });

    // Suspend all active API keys
    const apiKeys = await database.listApiKeys(customerId);
    for (const apiKey of apiKeys) {
      if (apiKey.status === 'active') {
        await database.updateApiKey(apiKey.id, { status: 'suspended' });
      }
    }
  }

  /**
   * Activate customer
   */
  static async activateCustomer(customerId: string): Promise<void> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      const error = new Error('Customer not found');
      error.name = 'CustomerNotFoundError';
      throw error;
    }

    // Update customer status
    await database.updateCustomer(customerId, { status: 'active' });

    // Reactivate suspended API keys
    const apiKeys = await database.listApiKeys(customerId);
    for (const apiKey of apiKeys) {
      if (apiKey.status === 'suspended') {
        await database.updateApiKey(apiKey.id, { status: 'active' });
      }
    }
  }

  /**
   * Revoke API key
   */
  static async revokeApiKey(keyId: string): Promise<void> {
    const apiKey = await database.getApiKey(keyId);
    if (!apiKey) {
      const error = new Error('API key not found');
      error.name = 'ApiKeyNotFoundError';
      throw error;
    }

    await database.updateApiKey(keyId, { status: 'revoked' });
  }

  /**
   * Check customer portal store for API key verification
   */
  private static async checkCustomerPortalStoreForApiKey(plainKey: string): Promise<{ customer: Customer; apiKey: ApiKey } | null> {
    try {
      // Access the customers array from the CustomerStore instance
      const customers = CustomerStore.getAllCustomers();
      // Find customer with this API key in portal store
      for (const portalCustomer of customers) {
        for (const keyRecord of portalCustomer.apiKeys) {
          if (keyRecord.status !== 'active') continue;
          // Compare provided token with stored bcrypt hash
          const isMatch = await bcrypt.compare(plainKey, keyRecord.keyHash);
          if (!isMatch) continue;

          // Ensure a DB customer exists (create if missing)
          let dbCustomer = await database.getCustomer(portalCustomer.id) || await database.getCustomerByEmail(portalCustomer.email);
          if (!dbCustomer) {
            dbCustomer = await database.createCustomer({
              email: portalCustomer.email,
              company: portalCustomer.company,
              walletBalance: 1000000,
              status: 'active'
            });
          }

          // Ensure this key exists in DB (by hash). If not, create it now.
          let dbKey = await database.getApiKeyByHash(keyRecord.keyHash);
          if (!dbKey) {
            // Plan config removed - using wallet-based pricing
            dbKey = await database.createApiKey({
              customerId: dbCustomer.id,
              keyHash: keyRecord.keyHash,
              keyPrefix: plainKey.substring(0, 10),
              name: keyRecord.name || 'Portal Key',
              permissions: ['business:read', 'business:write'],
              // plan removed
              status: keyRecord.status === 'active' ? 'active' : 'revoked',
              requestsUsed: 0,
              // requestsLimit removed
              rateLimitPerMin: 60,
              expiresAt: undefined
            });
          }

          return { customer: dbCustomer, apiKey: dbKey };
        }
      }
      return null;
    } catch (error) {
      console.error('Error checking customer portal store:', error);
      return null;
    }
  }

  /**
   * Verify API key and return customer and key details
   * Single source of truth for API key verification
   */
  private static async importPlainKeyFromVault(rawToken: string): Promise<ApiKey | null> {
    try {
      const tokenPrefix = rawToken.substring(0, 10);
      // Check if already exists in DB (by prefix + bcrypt compare)
      const existing = (await database.listApiKeys()).filter(k => k.keyPrefix === tokenPrefix);
      for (const k of existing) {
        if (await bcrypt.compare(rawToken, k.keyHash)) {
          return k;
        }
      }

      // Try sqlite vault first
      try {
        const { getRecentPlainKeysSqlite } = await import('../utils/keyVaultSqlite.js');
        const items = await getRecentPlainKeysSqlite(1000);
        const rec = items.find(i => i.plainKey === rawToken);
        if (rec) {
          const customer = await database.getCustomer(rec.customerId) || await database.getCustomerByEmail((rec as any).email || '');
          if (!customer) return null;
          const keyHash = await bcrypt.hash(rawToken, 12);
          // Plan config removed - using wallet-based pricing
          const created = await database.createApiKey({
            customerId: customer.id,
            keyHash,
            keyPrefix: tokenPrefix,
            name: rec.name || 'Imported Key',
            permissions: ['business:read','business:write'],
            // plan removed
            status: 'active',
            requestsUsed: 0,
            // requestsLimit removed
            rateLimitPerMin: 60,
          });
          return created;
        }
      } catch {}

      // Fallback to file vault
      try {
        const { promises: fs } = await import('fs');
        const path = (await import('path')).default;
        const target = process.env.PLAIN_KEY_FILE || path.join('.data','plain_api_keys.ndjson');
        const content = await fs.readFile(target, { encoding: 'utf8' }).catch(() => '');
        if (!content) return null;
        const lines = content.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.plainKey === rawToken) {
              const customer = await database.getCustomer(obj.customerId) || await database.getCustomerByEmail(obj.email || '');
              if (!customer) return null;
              const keyHash = await bcrypt.hash(rawToken, 12);
              // Plan config removed - using wallet-based pricing
              const created = await database.createApiKey({
                customerId: customer.id,
                keyHash,
                keyPrefix: tokenPrefix,
                name: obj.name || 'Imported Key',
                permissions: ['business:read','business:write'],
                // plan removed
                status: 'active',
                requestsUsed: 0,
                // requestsLimit removed
                rateLimitPerMin: 60,
              });
              return created;
            }
          } catch {}
        }
      } catch {}
      return null;
    } catch (e) {
      console.warn('[auth] importPlainKeyFromVault failed:', (e as Error).message);
      return null;
    }
  }

  static async verifyApiKey(rawToken: string): Promise<{ customer: Customer; apiKey: ApiKey } | null> {
    const debug = (process.env.DEBUG_API_KEY === '1' || process.env.DEBUG_API_KEY === 'true') && process.env.LOG_LEVEL === 'debug';
    const tokenPrefix = typeof rawToken === 'string' ? rawToken.substring(0, 10) : '';
    if (debug) console.log(`[DEBUG AUTH] Verifying API key tokenPrefix=${tokenPrefix}`);

    // First check the database (production system)
    const keys = await database.listApiKeys();
    
    // Prefilter by keyPrefix to avoid unnecessary bcrypt compares
    const candidates = keys.filter(k => (k.status === 'active') && (k.keyPrefix === tokenPrefix));
    if (debug) console.log(`[DEBUG AUTH] Found ${candidates.length} candidate keys with matching prefix`);
    
    for (const key of candidates) {
      if (key.status !== 'active') {
        if (debug) console.log(`[DEBUG AUTH] Skip key id=${key.id} status=${key.status}`);
        continue;
      }
      if (debug) console.log(`[DEBUG AUTH] Comparing tokenPrefix=${tokenPrefix} with dbKey id=${key.id} keyPrefix=${key.keyPrefix}`);
      
      const match = await bcrypt.compare(rawToken, key.keyHash);
      if (debug) console.log(`[DEBUG AUTH] bcrypt.compare result for key id=${key.id}: ${match}`);
      
      if (!match) continue;

      // Optional expiration check
      if (key.expiresAt && new Date() > key.expiresAt) {
        if (debug) console.log(`[DEBUG AUTH] Key id=${key.id} expired at ${key.expiresAt.toISOString()}`);
        await database.updateApiKey(key.id, { status: 'revoked' });
        continue;
      }
      const customer = await database.getCustomer(key.customerId);
      if (!customer || customer.status !== 'active') {
        if (debug) console.log(`[DEBUG AUTH] Customer ${key.customerId} not active or not found`);
        continue;
      }

      if (debug) console.log(`[DEBUG AUTH] Verified tokenPrefix=${tokenPrefix} matches key id=${key.id} for customer=${customer.id}`);
      return { customer, apiKey: key };
    }

    if (debug) console.log(`[DEBUG AUTH] No matching API key found for tokenPrefix=${tokenPrefix}`);

    // Dev-only auto-import from vault on first failure
    if (process.env.NODE_ENV !== 'production' || process.env.AUTO_IMPORT_KEY === '1' || process.env.AUTO_IMPORT_KEY === 'true') {
      const imported = await this.importPlainKeyFromVault(rawToken);
      if (imported) {
        const customer = await database.getCustomer(imported.customerId);
        if (customer && customer.status === 'active' && imported.status === 'active') {
          if (debug) console.log(`[DEBUG AUTH] Auto-imported key id=${imported.id} for customer=${customer.id}`);
          return { customer, apiKey: imported };
        }
      }
    }

    return null;
  }

  /**
   * Get customer by API key (for authentication)
   * Now uses the centralized verifyApiKey method
   */
  static async getCustomerByApiKey(plainKey: string): Promise<{ customer: Customer; apiKey: ApiKey } | null> {
    return await this.verifyApiKey(plainKey);
  }

  /**
   * List API keys for a customer
   */
  static async listApiKeys(customerId?: string) {
    return await database.listApiKeys(customerId);
  }

  /**
   * Record API usage
   */
  static async recordUsage(customerId: string, keyId: string, endpoint: string, method: string, statusCode: number, responseTimeMs: number): Promise<void> {
    const now = new Date();
    const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await database.recordUsage({
      customerId,
      keyId,
      endpoint,
      method,
      statusCode,
      responseTimeMs,
      billingPeriod,
      cost: 0
    });

    // Update API key usage counter
    const apiKey = await database.getApiKey(keyId);
    if (apiKey) {
      await database.updateApiKey(keyId, {
        requestsUsed: apiKey.requestsUsed + 1
      });
    }
  }

  /**
   * Check if customer has exceeded usage limits
   */
  static async checkUsageLimits(customerId: string, keyId: string): Promise<{
    allowed: boolean;
    reason?: string;
    usage: {
      requestsUsed: number;
      percentage: number;
    };
  }> {
    const apiKey = await database.getApiKey(keyId);
    if (!apiKey) {
      return {
        allowed: false,
        reason: 'API key not found',
        usage: { requestsUsed: 0, percentage: 0 }
      };
    }

    const usage = {
      requestsUsed: apiKey.requestsUsed,
      percentage: 0
    };

    // Pay-per-use: request limits removed; wallet enforcement will be added later
    if (false) {
      return {
        allowed: false,
        reason: 'Monthly usage limit exceeded',
        usage
      };
    }

    return {
      allowed: true,
      usage
    };
  }

  /**
   * Get business metrics for admin dashboard
   */
  static async getBusinessMetrics(): Promise<{
    totalCustomers: number;
    activeCustomers: number;
    totalApiKeys: number;
    activeApiKeys: number;
    newCustomersThisMonth: number;
    totalUsageThisMonth: number;
    popularEndpoints: Array<{ endpoint: string; count: number }>;
  }> {
    const overview = await database.getBusinessOverview();
    
    // Additional metrics
    const { customers: allCustomers } = await database.listCustomers();
    const totalApiKeys = (await database.listApiKeys()).length;
    const activeApiKeys = (await database.listApiKeys()).filter(key => key.status === 'active').length;

    return {
      totalCustomers: overview.totalCustomers,
      activeCustomers: overview.activeCustomers,
      totalApiKeys,
      activeApiKeys,
      newCustomersThisMonth: overview.newSignupsThisMonth,
      totalUsageThisMonth: overview.apiRequestsThisMonth,
      popularEndpoints: [] // Will be populated from usage data
    };
  }
}



