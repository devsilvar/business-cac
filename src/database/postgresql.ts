/**
 * PostgreSQL Implementation
 * Digital Ocean/traditional database implementation
 */

import { 
  DatabaseInterface, 
  DatabaseTransactionInterface,
  Customer, 
  CustomerData, 
  ApiKey, 
  ApiKeyData, 
  UsageRecord, 
  UsageRecordData,
  UsageStats,
  BusinessOverview,
  SystemMetrics,
  ListOptions,
  QoreIDToken,
  Admin,
  AdminData,
  WalletTransaction,
  WalletTransactionData,
  WalletTransactionStatus,
  ServicePricing,
  ServicePricingData
} from './index.js';

import type { Pool, QueryResult } from 'pg';

// PostgreSQL client (will be installed when migrating to Digital Ocean)
let pool: Pool | null = null;

export class PostgreSQLDatabase implements DatabaseInterface {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Import pg (PostgreSQL client)
      const { Pool } = await import('pg');
      
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // Enable SSL for Neon and production environments
        ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.NODE_ENV === 'production' 
          ? { rejectUnauthorized: false } 
          : (process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false)
      });

      // Test connection
      await pool.query('SELECT NOW()');
      
      // Create tables if they don't exist
      await this.createTables();
      
      this.initialized = true;
      console.log('✅ PostgreSQL initialized successfully');
    } catch (error) {
      console.error('❌ PostgreSQL initialization failed:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    // First, ensure the pgcrypto extension is available for gen_random_uuid()
    // This is needed for Neon and other PostgreSQL providers
    const setupQueries = [
      `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
      // Ensure password/reset columns exist for customer login persistence
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(255)`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`
    ];

    const tables = [
      // Customers table
      `CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        company VARCHAR(255),
        password_hash VARCHAR(255),
        reset_token_hash VARCHAR(255),
        reset_token_expires TIMESTAMP,
        wallet_balance BIGINT DEFAULT 1000000,
        status VARCHAR(50) DEFAULT 'active',
        verification_status VARCHAR(50) DEFAULT 'inactive',
        verification_data JSONB,
        paystack_customer_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // Admins table
      `CREATE TABLE IF NOT EXISTS admins (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        permissions JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'active',
        created_by VARCHAR(50),
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // API Keys table
      `CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(20) NOT NULL,
        name VARCHAR(255) NOT NULL,
        permissions JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'active',
        requests_used INTEGER DEFAULT 0,
        rate_limit_per_min INTEGER NOT NULL,
        last_used TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // Usage Records table
      `CREATE TABLE IF NOT EXISTS usage_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
        endpoint VARCHAR(255) NOT NULL,
        method VARCHAR(10) NOT NULL,
        status_code INTEGER NOT NULL,
        response_time_ms INTEGER,
        billing_period VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW()
      )`,

      // QoreID Token table (stores a single cached token for external API auth)
      `CREATE TABLE IF NOT EXISTS qoreid_token (
        id VARCHAR(50) PRIMARY KEY,
        access_token TEXT NOT NULL,
        token_type VARCHAR(20) DEFAULT 'Bearer',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // Wallet Transactions table (tracks all wallet credits/debits)
      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY,
        customer_id VARCHAR(255) REFERENCES customers(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL,
        amount BIGINT NOT NULL,
        balance_before BIGINT NOT NULL,
        balance_after BIGINT NOT NULL,
        description VARCHAR(500) NOT NULL,
        reference VARCHAR(255) UNIQUE NOT NULL,
        usage_record_id UUID,
        payment_method VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )`,

      // Service Pricing table (dynamic pricing for API services)
      `CREATE TABLE IF NOT EXISTS service_pricing (
        id UUID PRIMARY KEY,
        service_code VARCHAR(100) UNIQUE NOT NULL,
        service_name VARCHAR(255) NOT NULL,
        price_kobo BIGINT NOT NULL,
        currency VARCHAR(10) DEFAULT 'NGN',
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // Indexes for better performance
      `CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)`,
      `CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_customer_id ON api_keys(customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_customer_id ON usage_records(customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_billing_period ON usage_records(billing_period)`,
      `CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email)`,
      `CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role)`,
      // Wallet transactions indexes
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_customer_id ON wallet_transactions(customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_reference ON wallet_transactions(reference)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_status ON wallet_transactions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_created_at ON wallet_transactions(created_at)`,
      // Service pricing indexes
      `CREATE INDEX IF NOT EXISTS idx_service_pricing_code ON service_pricing(service_code)`,
      `CREATE INDEX IF NOT EXISTS idx_service_pricing_active ON service_pricing(is_active)`
    ];

    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    // Run setup queries first (extensions, etc.)
    for (const query of setupQueries) {
      try {
        await pool.query(query);
      } catch (err: any) {
        // Ignore errors for extensions (may not have permission in some environments)
        console.warn(`Setup query warning: ${err.message}`);
      }
    }

    // Create tables
    for (const table of tables) {
      await pool.query(table);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!pool) return false;
      await pool.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('PostgreSQL health check failed:', error);
      return false;
    }
  }

  // Generate a UUID v4 (portable, doesn't rely on database extensions)
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Customer operations
  async createCustomer(customerData: CustomerData): Promise<Customer> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = this.generateUUID();
    const query = `
      INSERT INTO customers (id, email, company, password_hash, reset_token_hash, reset_token_expires, wallet_balance, status, verification_status, verification_data, paystack_customer_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    
    const values = [
      id,
      customerData.email,
      customerData.company || null,
      customerData.passwordHash || null,
      customerData.resetTokenHash || null,
      customerData.resetTokenExpires || null,
      customerData.walletBalance ?? 1000000,
      customerData.status,
      customerData.verificationStatus || 'inactive',
      customerData.verificationData ? JSON.stringify(customerData.verificationData) : null,
      customerData.paystackCustomerId || null
    ];

    const result: QueryResult = await pool.query(query, values);
    const row = result.rows[0];

    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getCustomer(customerId: string): Promise<Customer | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM customers WHERE id = $1';
    const result: QueryResult = await pool.query(query, [customerId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getCustomerByEmail(email: string): Promise<Customer | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM customers WHERE email = $1';
    const result: QueryResult = await pool.query(query, [email]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getCustomerByResetTokenHash(tokenHash: string): Promise<Customer | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM customers WHERE reset_token_hash = $1';
    const result: QueryResult = await pool.query(query, [tokenHash]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${this.camelToSnake(key)} = $${index + 2}`)
      .join(', ');

    const query = `
      UPDATE customers 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const values = [customerId, ...Object.values(updates)];
    const result: QueryResult = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Customer not found');
    }

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async listCustomers(options: ListOptions = {}): Promise<{ customers: Customer[]; total: number; }> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    let query = 'SELECT * FROM customers';
    let countQuery = 'SELECT COUNT(*) FROM customers';
    const conditions: string[] = [];
    const queryValues: any[] = [];
    const countValues: any[] = [];
    let valueIndex = 1;

    // Apply filters
    if (options.search) {
      conditions.push(`email ILIKE $${valueIndex}`);
      queryValues.push(`%${options.search}%`);
      countValues.push(`%${options.search}%`);
      valueIndex++;
    }

    if (options.status) {
      conditions.push(`status = $${valueIndex}`);
      queryValues.push(options.status);
      countValues.push(options.status);
      valueIndex++;
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    // Apply pagination (only to main query, not count query)
    query += ' ORDER BY created_at DESC';
    if (options.limit) {
      query += ` LIMIT $${valueIndex}`;
      queryValues.push(options.limit);
      valueIndex++;
    }
    if (options.offset) {
      query += ` OFFSET $${valueIndex}`;
      queryValues.push(options.offset);
    }

    // Execute queries with separate value arrays
    const [result, countResult] = await Promise.all([
      pool.query(query, queryValues),
      pool.query(countQuery, countValues)
    ]);

    const customers = result.rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return {
      customers,
      total: parseInt(countResult.rows[0]?.count || '0')
    };
  }

  async deleteCustomer(customerId: string): Promise<void> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
  }

  // API Key operations (implementing essential methods)
  async createApiKey(apiKeyData: ApiKeyData): Promise<ApiKey> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = this.generateUUID();
    const query = `
      INSERT INTO api_keys (
        id, customer_id, key_hash, key_prefix, name, permissions, status, requests_used, rate_limit_per_min, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const values = [
      id,
      apiKeyData.customerId,
      apiKeyData.keyHash,
      apiKeyData.keyPrefix,
      apiKeyData.name,
      JSON.stringify(apiKeyData.permissions),
      apiKeyData.status,
      apiKeyData.requestsUsed,
      apiKeyData.rateLimitPerMin,
      apiKeyData.expiresAt || null
    ];

    const result: QueryResult = await pool.query(query, values);
    const row = result.rows[0];

    return this.mapApiKeyRow(row);
  }

  async getApiKey(keyId: string): Promise<ApiKey | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const result: QueryResult = await pool.query('SELECT * FROM api_keys WHERE id = $1', [keyId]);
    return result.rows.length > 0 ? this.mapApiKeyRow(result.rows[0]) : null;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM api_keys WHERE key_hash = $1 AND status = $2';
    const result: QueryResult = await pool.query(query, [keyHash, 'active']);
    return result.rows.length > 0 ? this.mapApiKeyRow(result.rows[0]) : null;
  }

  async listApiKeys(customerId?: string): Promise<ApiKey[]> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    let query = 'SELECT * FROM api_keys';
    const values: any[] = [];

    if (customerId) {
      query += ' WHERE customer_id = $1';
      values.push(customerId);
    }

    query += ' ORDER BY created_at DESC';
    const result: QueryResult = await pool.query(query, values);
    
    return result.rows.map((row: any) => this.mapApiKeyRow(row));
  }

  async updateApiKey(keyId: string, updates: Partial<ApiKeyData>): Promise<ApiKey> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const updateFields: string[] = [];
    const values: any[] = [keyId];
    let valueIndex = 2;

    if (updates.name !== undefined) {
      updateFields.push(`name = $${valueIndex++}`);
      values.push(updates.name);
    }
    if (updates.permissions !== undefined) {
      updateFields.push(`permissions = $${valueIndex++}`);
      values.push(JSON.stringify(updates.permissions));
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${valueIndex++}`);
      values.push(updates.status);
    }
    if (updates.requestsUsed !== undefined) {
      updateFields.push(`requests_used = $${valueIndex++}`);
      values.push(updates.requestsUsed);
    }
    if (updates.rateLimitPerMin !== undefined) {
      updateFields.push(`rate_limit_per_min = $${valueIndex++}`);
      values.push(updates.rateLimitPerMin);
    }
    if ((updates as any).lastUsed !== undefined) {
      updateFields.push(`last_used = $${valueIndex++}`);
      values.push((updates as any).lastUsed);
    }
    if (updates.expiresAt !== undefined) {
      updateFields.push(`expires_at = $${valueIndex++}`);
      values.push(updates.expiresAt);
    }

    if (updateFields.length === 0) {
      const existing = await this.getApiKey(keyId);
      if (!existing) throw new Error('API key not found');
      return existing;
    }

    updateFields.push('updated_at = NOW()');

    const query = `
      UPDATE api_keys 
      SET ${updateFields.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('API key not found');
    }

    return this.mapApiKeyRow(result.rows[0]);
  }

  async deleteApiKey(keyId: string): Promise<void> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    await pool.query('DELETE FROM api_keys WHERE id = $1', [keyId]);
  }

  // Usage tracking (basic implementation)
  async recordUsage(usageData: UsageRecordData): Promise<void> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = this.generateUUID();
    const query = `
      INSERT INTO usage_records (
        id, customer_id, key_id, endpoint, method, status_code, 
        response_time_ms, billing_period
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    const values = [
      id,
      usageData.customerId,
      usageData.keyId,
      usageData.endpoint,
      usageData.method,
      usageData.statusCode,
      usageData.responseTimeMs,
      usageData.billingPeriod
    ];

    await pool.query(query, values);
  }

  // Other methods (implementing basic versions)
  async getUsage(customerId: string, period?: string): Promise<UsageRecord[]> {
    // Basic implementation - can be expanded
    return [];
  }

  async getUsageStats(customerId: string): Promise<UsageStats> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];

    // Get all usage for this customer
    const allUsageQuery = `
      SELECT * FROM usage_records 
      WHERE customer_id = $1 
      ORDER BY timestamp DESC
    `;
    const allUsageResult = await pool.query(allUsageQuery, [customerId]);
    
    // Get this month's usage
    const monthlyQuery = `
      SELECT * FROM usage_records 
      WHERE customer_id = $1 AND billing_period = $2
    `;
    const monthlyResult = await pool.query(monthlyQuery, [customerId, thisMonth]);
    
    // Get today's usage
    const todayQuery = `
      SELECT COUNT(*) as count FROM usage_records 
      WHERE customer_id = $1 AND DATE(timestamp) = $2
    `;
    const todayResult = await pool.query(todayQuery, [customerId, today]);

    const allUsage = allUsageResult.rows;
    const monthlyUsage = monthlyResult.rows;
    
    // Calculate stats
    const totalCalls = allUsage.length;
    const successfulCalls = allUsage.filter(r => r.status_code >= 200 && r.status_code < 400).length;
    const failedCalls = allUsage.filter(r => r.status_code >= 400).length;
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;
    
    const requestsThisMonth = monthlyUsage.length;
    const requestsToday = parseInt(todayResult.rows[0]?.count || '0');
    
    // Calculate popular endpoints
    const endpointCounts: Record<string, number> = {};
    monthlyUsage.forEach(r => {
      endpointCounts[r.endpoint] = (endpointCounts[r.endpoint] || 0) + 1;
    });
    const popularEndpoints = Object.entries(endpointCounts)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    const errorRequests = monthlyUsage.filter(r => r.status_code >= 400).length;
    const errorRate = requestsThisMonth > 0 ? errorRequests / requestsThisMonth : 0;
    
    const lastCallAt = allUsage.length > 0 ? new Date(allUsage[0].timestamp) : undefined;

    return {
      requestsThisMonth,
      requestsToday,
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate,
      popularEndpoints,
      errorRate,
      lastCallAt
    };
  }

  async getBusinessOverview(): Promise<BusinessOverview> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Get customer counts with simple queries
      const totalCustomersResult = await pool.query('SELECT COUNT(*) as count FROM customers');
      const activeCustomersResult = await pool.query("SELECT COUNT(*) as count FROM customers WHERE status = 'active'");
      const newSignupsResult = await pool.query('SELECT COUNT(*) as count FROM customers WHERE created_at >= $1', [monthStart]);

      const totalCustomers = parseInt(totalCustomersResult.rows[0]?.count || '0');
      const activeCustomers = parseInt(activeCustomersResult.rows[0]?.count || '0');
      const newSignupsThisMonth = parseInt(newSignupsResult.rows[0]?.count || '0');

      // Calculate monthly revenue from wallet transactions
      const revenueResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total 
         FROM wallet_transactions 
         WHERE type = 'credit' 
         AND status = 'completed' 
         AND payment_method != 'admin'
         AND created_at >= $1`,
        [monthStart]
      );
      const monthlyRevenue = parseInt(revenueResult.rows[0]?.total || '0');

      // Get API stats if usage_records table exists
      let apiRequestsToday = 0;
      let apiRequestsThisMonth = 0;
      let errorRate = 0;

      try {
        const today = now.toISOString().split('T')[0];
        const todayResult = await pool.query(
          'SELECT COUNT(*) as count FROM usage_records WHERE DATE(timestamp) = $1',
          [today]
        );
        apiRequestsToday = parseInt(todayResult.rows[0]?.count || '0');

        const monthResult = await pool.query(
          'SELECT COUNT(*) as count FROM usage_records WHERE timestamp >= $1',
          [monthStart]
        );
        apiRequestsThisMonth = parseInt(monthResult.rows[0]?.count || '0');

        if (apiRequestsThisMonth > 0) {
          const errorResult = await pool.query(
            'SELECT COUNT(*) as count FROM usage_records WHERE timestamp >= $1 AND status_code >= 400',
            [monthStart]
          );
          const errorCount = parseInt(errorResult.rows[0]?.count || '0');
          errorRate = errorCount / apiRequestsThisMonth;
        }
      } catch (err) {
        // usage_records table might not exist yet
        console.warn('[PostgreSQL] Could not fetch usage stats:', err);
      }

      return {
        totalCustomers,
        activeCustomers,
        monthlyRevenue,
        apiRequestsToday,
        apiRequestsThisMonth,
        errorRate,
        newSignupsThisMonth
      };
    } catch (error) {
      console.error('[PostgreSQL] getBusinessOverview error:', error);
      // Return zeros on error
      return {
        totalCustomers: 0,
        activeCustomers: 0,
        monthlyRevenue: 0,
        apiRequestsToday: 0,
        apiRequestsThisMonth: 0,
        errorRate: 0,
        newSignupsThisMonth: 0
      };
    }
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    const databaseHealth = await this.healthCheck();
    
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      activeConnections: 0, // Can be queried from pg_stat_activity
      databaseHealth
    };
  }

  // QoreID Token operations
  async getQoreIDToken(): Promise<QoreIDToken | null> {
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    const result = await pool.query(
      'SELECT * FROM qoreid_token WHERE id = $1 LIMIT 1',
      ['current']
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      accessToken: row.access_token,
      tokenType: row.token_type,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async createQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    const id = 'current';

    const result = await pool.query(
      `INSERT INTO qoreid_token (id, access_token, token_type, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         token_type = EXCLUDED.token_type,
         expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [id, data.accessToken, data.tokenType, data.expiresAt, data.createdAt, data.updatedAt]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      accessToken: row.access_token,
      tokenType: row.token_type,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    // Same behavior as create: upsert single record
    return this.createQoreIDToken(data);
  }

  // Admin operations
  async createAdmin(adminData: AdminData): Promise<Admin> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = `admin_${Date.now().toString(36)}`;
    const query = `
      INSERT INTO admins (id, email, password_hash, full_name, role, permissions, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const values = [
      id,
      adminData.email,
      adminData.passwordHash,
      adminData.fullName || null,
      adminData.role,
      JSON.stringify(adminData.permissions),
      adminData.status || 'active',
      adminData.createdBy || null
    ];

    const result: QueryResult = await pool.query(query, values);
    return this.mapAdminRow(result.rows[0]);
  }

  async getAdmin(adminId: string): Promise<Admin | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM admins WHERE id = $1';
    const result: QueryResult = await pool.query(query, [adminId]);
    
    if (result.rows.length === 0) return null;
    return this.mapAdminRow(result.rows[0]);
  }

  async getAdminByEmail(email: string): Promise<Admin | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM admins WHERE email = $1';
    const result: QueryResult = await pool.query(query, [email]);
    
    if (result.rows.length === 0) return null;
    return this.mapAdminRow(result.rows[0]);
  }

  async updateAdmin(adminId: string, updates: Partial<AdminData>): Promise<Admin> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const updateFields: string[] = [];
    const values: any[] = [adminId];
    let valueIndex = 2;

    if (updates.email !== undefined) {
      updateFields.push(`email = $${valueIndex++}`);
      values.push(updates.email);
    }
    if (updates.passwordHash !== undefined) {
      updateFields.push(`password_hash = $${valueIndex++}`);
      values.push(updates.passwordHash);
    }
    if (updates.fullName !== undefined) {
      updateFields.push(`full_name = $${valueIndex++}`);
      values.push(updates.fullName);
    }
    if (updates.role !== undefined) {
      updateFields.push(`role = $${valueIndex++}`);
      values.push(updates.role);
    }
    if (updates.permissions !== undefined) {
      updateFields.push(`permissions = $${valueIndex++}`);
      values.push(JSON.stringify(updates.permissions));
    }
    if (updates.status !== undefined) {
      updateFields.push(`status = $${valueIndex++}`);
      values.push(updates.status);
    }

    if (updateFields.length === 0) {
      const existing = await this.getAdmin(adminId);
      if (!existing) throw new Error('Admin not found');
      return existing;
    }

    updateFields.push('updated_at = NOW()');

    const query = `
      UPDATE admins 
      SET ${updateFields.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error('Admin not found');
    }

    return this.mapAdminRow(result.rows[0]);
  }

  async listAdmins(): Promise<Admin[]> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM admins ORDER BY created_at DESC';
    const result: QueryResult = await pool.query(query);
    
    return result.rows.map((row: any) => this.mapAdminRow(row));
  }

  async deleteAdmin(adminId: string): Promise<void> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    // Prevent deleting the last super_admin
    const superAdmins = await pool.query(
      "SELECT COUNT(*) as count FROM admins WHERE role = 'super_admin' AND status = 'active'"
    );
    
    const admin = await this.getAdmin(adminId);
    if (admin?.role === 'super_admin' && parseInt(superAdmins.rows[0].count) <= 1) {
      throw new Error('Cannot delete the last super admin');
    }

    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
  }

  // Wallet Transaction operations
  async createWalletTransaction(transactionData: WalletTransactionData): Promise<WalletTransaction> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = this.generateUUID();
    const query = `
      INSERT INTO wallet_transactions (
        id, customer_id, type, amount, balance_before, balance_after,
        description, reference, usage_record_id, payment_method, status, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      id,
      transactionData.customerId,
      transactionData.type,
      transactionData.amount,
      transactionData.balanceBefore,
      transactionData.balanceAfter,
      transactionData.description,
      transactionData.reference,
      transactionData.usageRecordId || null,
      transactionData.paymentMethod || null,
      transactionData.status,
      transactionData.metadata ? JSON.stringify(transactionData.metadata) : null
    ];

    const result: QueryResult = await pool.query(query, values);
    return this.mapWalletTransactionRow(result.rows[0]);
  }

  async getWalletTransaction(transactionId: string): Promise<WalletTransaction | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const result = await pool.query('SELECT * FROM wallet_transactions WHERE id = $1', [transactionId]);
    return result.rows.length > 0 ? this.mapWalletTransactionRow(result.rows[0]) : null;
  }

  async getWalletTransactionByReference(reference: string): Promise<WalletTransaction | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const result = await pool.query('SELECT * FROM wallet_transactions WHERE reference = $1', [reference]);
    return result.rows.length > 0 ? this.mapWalletTransactionRow(result.rows[0]) : null;
  }

  async listWalletTransactions(customerId: string, options: ListOptions = {}): Promise<{ transactions: WalletTransaction[]; total: number }> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    let query = 'SELECT * FROM wallet_transactions WHERE customer_id = $1';
    let countQuery = 'SELECT COUNT(*) FROM wallet_transactions WHERE customer_id = $1';
    const values: any[] = [customerId];
    let valueIndex = 2;

    // Apply pagination
    query += ' ORDER BY created_at DESC';
    if (options.limit) {
      query += ` LIMIT $${valueIndex}`;
      values.push(options.limit);
      valueIndex++;
    }
    if (options.offset) {
      query += ` OFFSET $${valueIndex}`;
      values.push(options.offset);
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, [customerId])
    ]);

    return {
      transactions: result.rows.map((row: any) => this.mapWalletTransactionRow(row)),
      total: parseInt(countResult.rows[0]?.count || '0')
    };
  }

  async getAllWalletTransactions(): Promise<WalletTransaction[]> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM wallet_transactions ORDER BY created_at DESC';
    const result = await pool.query(query);
    
    return result.rows.map((row: any) => this.mapWalletTransactionRow(row));
  }

  async updateWalletTransactionStatus(transactionId: string, status: WalletTransactionStatus, completedAt?: Date): Promise<WalletTransaction> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const query = `
      UPDATE wallet_transactions
      SET status = $2, completed_at = $3
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(query, [transactionId, status, completedAt || null]);
    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }

    return this.mapWalletTransactionRow(result.rows[0]);
  }

  // Service Pricing operations
  async createServicePricing(pricingData: ServicePricingData): Promise<ServicePricing> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const id = this.generateUUID();
    const query = `
      INSERT INTO service_pricing (
        id, service_code, service_name, price_kobo, currency, description, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      id,
      pricingData.serviceCode,
      pricingData.serviceName,
      pricingData.priceKobo,
      pricingData.currency || 'NGN',
      pricingData.description || null,
      pricingData.isActive ?? true
    ];

    const result: QueryResult = await pool.query(query, values);
    return this.mapServicePricingRow(result.rows[0]);
  }

  async getServicePricing(serviceCode: string): Promise<ServicePricing | null> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const result = await pool.query('SELECT * FROM service_pricing WHERE service_code = $1', [serviceCode]);
    return result.rows.length > 0 ? this.mapServicePricingRow(result.rows[0]) : null;
  }

  async listServicePricing(activeOnly: boolean = false): Promise<ServicePricing[]> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    let query = 'SELECT * FROM service_pricing';
    if (activeOnly) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY service_code ASC';

    const result = await pool.query(query);
    return result.rows.map((row: any) => this.mapServicePricingRow(row));
  }

  async updateServicePricing(serviceCode: string, updates: Partial<ServicePricingData>): Promise<ServicePricing> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const updateFields: string[] = [];
    const values: any[] = [serviceCode];
    let valueIndex = 2;

    if (updates.serviceName !== undefined) {
      updateFields.push(`service_name = $${valueIndex++}`);
      values.push(updates.serviceName);
    }
    if (updates.priceKobo !== undefined) {
      updateFields.push(`price_kobo = $${valueIndex++}`);
      values.push(updates.priceKobo);
    }
    if (updates.currency !== undefined) {
      updateFields.push(`currency = $${valueIndex++}`);
      values.push(updates.currency);
    }
    if (updates.description !== undefined) {
      updateFields.push(`description = $${valueIndex++}`);
      values.push(updates.description);
    }
    if (updates.isActive !== undefined) {
      updateFields.push(`is_active = $${valueIndex++}`);
      values.push(updates.isActive);
    }

    if (updateFields.length === 0) {
      const existing = await this.getServicePricing(serviceCode);
      if (!existing) throw new Error('Service pricing not found');
      return existing;
    }

    updateFields.push('updated_at = NOW()');

    const query = `
      UPDATE service_pricing
      SET ${updateFields.join(', ')}
      WHERE service_code = $1
      RETURNING *
    `;

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      throw new Error('Service pricing not found');
    }

    return this.mapServicePricingRow(result.rows[0]);
  }

  async deleteServicePricing(serviceCode: string): Promise<void> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    await pool.query('DELETE FROM service_pricing WHERE service_code = $1', [serviceCode]);
  }

  // Helper methods
  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private mapCustomerRow(row: any): Customer {
    return {
      id: row.id,
      email: row.email,
      company: row.company,
      walletBalance: Number(row.wallet_balance),
      status: row.status,
      passwordHash: row.password_hash,
      resetTokenHash: row.reset_token_hash,
      resetTokenExpires: row.reset_token_expires,
      phone_number: row.phone_number,
      full_name: row.full_name,
      nin_bvn: row.nin_bvn,
      id_document: row.id_document,
      verificationStatus: row.verification_status || 'inactive',
      verificationData: row.verification_data ? (typeof row.verification_data === 'string' ? JSON.parse(row.verification_data) : row.verification_data) : undefined,
      paystackCustomerId: row.paystack_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapApiKeyRow(row: any): ApiKey {
    // Handle permissions - could be JSON string, array, or comma-separated string
    let permissions: string[] = [];
    if (row.permissions) {
      if (Array.isArray(row.permissions)) {
        permissions = row.permissions;
      } else if (typeof row.permissions === 'string') {
        try {
          permissions = JSON.parse(row.permissions);
        } catch {
          // If not valid JSON, try comma-separated
          permissions = row.permissions.split(',').map((p: string) => p.trim()).filter(Boolean);
        }
      }
    }

    return {
      id: row.id,
      customerId: row.customer_id,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      name: row.name,
      permissions,
      status: row.status,
      requestsUsed: row.requests_used,
      rateLimitPerMin: row.rate_limit_per_min,
      lastUsed: row.last_used,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapAdminRow(row: any): Admin {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      fullName: row.full_name,
      role: row.role,
      permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
      status: row.status,
      lastLogin: row.last_login,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapWalletTransactionRow(row: any): WalletTransaction {
    return {
      id: row.id,
      customerId: row.customer_id,
      type: row.type,
      amount: Number(row.amount),
      balanceBefore: Number(row.balance_before),
      balanceAfter: Number(row.balance_after),
      description: row.description,
      reference: row.reference,
      usageRecordId: row.usage_record_id,
      paymentMethod: row.payment_method,
      status: row.status,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  }

  private mapServicePricingRow(row: any): ServicePricing {
    return {
      id: row.id,
      serviceCode: row.service_code,
      serviceName: row.service_name,
      priceKobo: Number(row.price_kobo),
      currency: row.currency,
      description: row.description,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Atomic transaction implementation
  async transaction<T>(callback: (tx: DatabaseTransactionInterface) => Promise<T>): Promise<T> {
    if (!pool) {
      throw new Error('Database not initialized');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Create transaction interface with client-scoped operations
      const txInterface: DatabaseTransactionInterface = {
        createCustomer: async (customer: CustomerData) => {
          const id = this.generateUUID();
          const query = `
            INSERT INTO customers (
              id, email, password_hash, company, phone_number, wallet_balance, 
              status, verification_status, verification_data, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING *
          `;
          const values = [
            id,
            customer.email,
            customer.passwordHash,
            customer.company || null,
            customer.phone_number || null,
            customer.walletBalance || 0,
            customer.status || 'active',
            customer.verificationStatus || 'inactive',
            customer.verificationData ? JSON.stringify(customer.verificationData) : null
          ];
          const result = await client.query(query, values);
          return this.mapCustomerRow(result.rows[0]);
        },

        getCustomer: async (customerId: string) => {
          const result = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
          return result.rows.length > 0 ? this.mapCustomerRow(result.rows[0]) : null;
        },

        updateCustomer: async (customerId: string, updates: Partial<CustomerData>) => {
          const updateFields: string[] = [];
          const values: any[] = [customerId];
          let valueIndex = 2;

          for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
              updateFields.push(`${this.camelToSnake(key)} = $${valueIndex++}`);
              if (key === 'verificationData') {
                values.push(JSON.stringify(value));
              } else {
                values.push(value);
              }
            }
          }

          if (updateFields.length === 0) {
            const existing = await this.getCustomer(customerId);
            if (!existing) throw new Error('Customer not found');
            return existing;
          }

          updateFields.push('updated_at = NOW()');

          const query = `
            UPDATE customers
            SET ${updateFields.join(', ')}
            WHERE id = $1
            RETURNING *
          `;

          const result = await client.query(query, values);
          if (result.rows.length === 0) {
            throw new Error('Customer not found');
          }

          return this.mapCustomerRow(result.rows[0]);
        },

        createWalletTransaction: async (transactionData: WalletTransactionData) => {
          const id = this.generateUUID();
          const query = `
            INSERT INTO wallet_transactions (
              id, customer_id, type, amount, balance_before, balance_after, 
              description, reference, usage_record_id, payment_method, status, metadata, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
            RETURNING *
          `;

          const values = [
            id,
            transactionData.customerId,
            transactionData.type,
            transactionData.amount,
            transactionData.balanceBefore,
            transactionData.balanceAfter,
            transactionData.description,
            transactionData.reference,
            transactionData.usageRecordId || null,
            transactionData.paymentMethod || null,
            transactionData.status,
            transactionData.metadata ? JSON.stringify(transactionData.metadata) : null
          ];

          const result = await client.query(query, values);
          return this.mapWalletTransactionRow(result.rows[0]);
        },

        getWalletTransaction: async (transactionId: string) => {
          const result = await client.query('SELECT * FROM wallet_transactions WHERE id = $1', [transactionId]);
          return result.rows.length > 0 ? this.mapWalletTransactionRow(result.rows[0]) : null;
        },

        getWalletTransactionByReference: async (reference: string) => {
          const result = await client.query('SELECT * FROM wallet_transactions WHERE reference = $1', [reference]);
          return result.rows.length > 0 ? this.mapWalletTransactionRow(result.rows[0]) : null;
        },

        updateWalletTransactionStatus: async (transactionId: string, status: WalletTransactionStatus, completedAt?: Date) => {
          const query = `
            UPDATE wallet_transactions
            SET status = $1, completed_at = $2
            WHERE id = $3
            RETURNING *
          `;

          const result = await client.query(query, [transactionId, status, completedAt || null]);
          if (result.rows.length === 0) {
            throw new Error('Transaction not found');
          }

          return this.mapWalletTransactionRow(result.rows[0]);
        }
      };

      const result = await callback(txInterface);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

