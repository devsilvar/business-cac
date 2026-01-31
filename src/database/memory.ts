import type { DatabaseInterface, DatabaseTransactionInterface, CustomerData, Customer, ApiKeyData, ApiKey, UsageRecordData, UsageRecord, UsageStats, ListOptions, BusinessOverview, SystemMetrics, QoreIDToken, Admin, AdminData, WalletTransaction, WalletTransactionData, WalletTransactionStatus, ServicePricing, ServicePricingData } from './index.js'
import { promises as fs } from 'fs'
import path from 'path'

function now() { return new Date() }

const DB_FILE = process.env.MEMDB_FILE || path.join('.data', 'memorydb.json')

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export class MemoryDatabase implements DatabaseInterface {
  private customers = new Map<string, Customer>()
  private apiKeys = new Map<string, ApiKey>()
  private usage: UsageRecord[] = []
  private qoreIdToken: QoreIDToken | null = null
  private admins = new Map<string, Admin>()
  private walletTransactions = new Map<string, WalletTransaction>()
  private servicePricing = new Map<string, ServicePricing>()

  private async load() {
    try {
      const raw = await fs.readFile(DB_FILE, 'utf8')
      const data = JSON.parse(raw)
      const customers: Customer[] = (data.customers || []).map((c: any) => ({
        ...c,
        // Grandfather existing customers if field missing
        verificationStatus: c.verificationStatus || 'inactive',
        resetTokenExpires: c.resetTokenExpires ? new Date(c.resetTokenExpires) : undefined,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt)
      }))
      const apiKeys: ApiKey[] = (data.apiKeys || []).map((k: any) => ({
        ...k,
        createdAt: new Date(k.createdAt),
        updatedAt: new Date(k.updatedAt),
        lastUsed: k.lastUsed ? new Date(k.lastUsed) : undefined,
        expiresAt: k.expiresAt ? new Date(k.expiresAt) : undefined,
      }))
      const usage: UsageRecord[] = (data.usage || []).map((u: any) => ({
        ...u,
        timestamp: new Date(u.timestamp)
      }))
      this.customers = new Map(customers.map(c => [c.id, c]))
      this.apiKeys = new Map(apiKeys.map(k => [k.id, k]))
      this.usage = usage
      
      // Load QoreID token if exists
      if (data.qoreIdToken) {
        this.qoreIdToken = {
          ...data.qoreIdToken,
          expiresAt: new Date(data.qoreIdToken.expiresAt),
          createdAt: new Date(data.qoreIdToken.createdAt),
          updatedAt: new Date(data.qoreIdToken.updatedAt)
        }
      }

      // Load admins if exists
      if (data.admins) {
        const admins: Admin[] = data.admins.map((a: any) => ({
          ...a,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
          lastLogin: a.lastLogin ? new Date(a.lastLogin) : undefined
        }))
        this.admins = new Map(admins.map(a => [a.id, a]))
      }

      // Load wallet transactions if exists
      if (data.walletTransactions) {
        const transactions: WalletTransaction[] = data.walletTransactions.map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          completedAt: t.completedAt ? new Date(t.completedAt) : undefined
        }))
        this.walletTransactions = new Map(transactions.map(t => [t.id, t]))
      }

      // Load service pricing if exists
      if (data.servicePricing) {
        const pricing: ServicePricing[] = data.servicePricing.map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt)
        }))
        this.servicePricing = new Map(pricing.map(p => [p.serviceCode, p]))
      }
    } catch (e) {
      // no existing file - seed minimal
      const id = 'cust_001'
      this.customers.set(id, {
        id,
        email: 'customer@example.com',
        company: 'Customer Co',
        walletBalance: 1000000, // ₦10,000 starting balance (kobo)
        status: 'active',
        verificationStatus: 'inactive',
        createdAt: now(),
        updatedAt: now(),
      } as Customer)
      await this.save()
    }
  }

  private async save() {
    try {
      await ensureDir(DB_FILE)
      const data = {
        customers: [...this.customers.values()],
        apiKeys: [...this.apiKeys.values()],
        usage: this.usage,
        qoreIdToken: this.qoreIdToken,
        admins: [...this.admins.values()],
        walletTransactions: [...this.walletTransactions.values()],
        servicePricing: [...this.servicePricing.values()]
      }
      await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
      // best-effort persistence for dev
      console.warn('[MemoryDatabase] persist failed:', (e as Error).message)
    }
  }

  async initialize(): Promise<void> {
    await this.load()
  }

  async healthCheck(): Promise<boolean> { return true }

  async createCustomer(customer: CustomerData): Promise<Customer> {
    const id = 'cust_' + Math.random().toString(36).slice(2,10)
    const rec: Customer = {
      id,
      ...customer,  // Spread first
      // Then set defaults for missing fields
      verificationStatus: customer.verificationStatus || 'inactive',
      walletBalance: customer.walletBalance ?? 1000000,  // Default ₦10,000 in kobo
      status: customer.status || 'active',
      createdAt: now(),
      updatedAt: now(),
    }
    this.customers.set(id, rec)
    await this.save()
    return rec
  }

  async getCustomer(customerId: string): Promise<Customer | null> {
    return this.customers.get(customerId) || null
  }

  async getCustomerByEmail(email: string): Promise<Customer | null> {
    for (const c of this.customers.values()) {
      if (c.email.toLowerCase() === email.toLowerCase()) return c
    }
    return null
  }

  async getCustomerByResetTokenHash(tokenHash: string): Promise<Customer | null> {
    for (const c of this.customers.values()) {
      if (c.resetTokenHash && c.resetTokenHash === tokenHash) return c
    }
    return null
  }

  async updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer> {
    const cur = this.customers.get(customerId)
    if (!cur) throw new Error('CUSTOMER_NOT_FOUND')
    const next: Customer = { ...cur, ...updates, updatedAt: now() }
    this.customers.set(customerId, next)
    await this.save()
    return next
  }

  async listCustomers(options?: ListOptions): Promise<{ customers: Customer[]; total: number; }> {
    const list = [...this.customers.values()]
    return { customers: list, total: list.length }
  }

  async deleteCustomer(customerId: string): Promise<void> {
    this.customers.delete(customerId)
    await this.save()
  }

  async createApiKey(apiKey: ApiKeyData): Promise<ApiKey> {
    const id = 'key_' + Math.random().toString(36).slice(2,10)
    const rec: ApiKey = { id, createdAt: now(), updatedAt: now(), ...apiKey }
    this.apiKeys.set(id, rec)
    await this.save()
    return rec
  }

  async getApiKey(keyId: string): Promise<ApiKey | null> {
    return this.apiKeys.get(keyId) || null
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    for (const k of this.apiKeys.values()) { if (k.keyHash === keyHash) return k }
    return null
  }

  async listApiKeys(customerId?: string): Promise<ApiKey[]> {
    const list = [...this.apiKeys.values()]
    return customerId ? list.filter(k => k.customerId === customerId) : list
  }

  async updateApiKey(keyId: string, updates: Partial<ApiKeyData>): Promise<ApiKey> {
    const cur = this.apiKeys.get(keyId)
    if (!cur) throw new Error('API_KEY_NOT_FOUND')
    const next: ApiKey = { ...cur, ...updates, updatedAt: now() }
    this.apiKeys.set(keyId, next)
    await this.save()
    return next
  }

  async deleteApiKey(keyId: string): Promise<void> {
    this.apiKeys.delete(keyId)
    await this.save()
  }

  async recordUsage(usage: UsageRecordData): Promise<void> {
    const id = 'use_' + Math.random().toString(36).slice(2,10)
    this.usage.push({ id, timestamp: now(), ...usage })
    await this.save()
  }

  async getUsage(customerId: string, period = '30d'): Promise<UsageRecord[]> {
    return this.usage.filter(u => u.customerId === customerId)
  }

  async getUsageStats(customerId: string): Promise<UsageStats> {
    const records = this.usage.filter(u => u.customerId === customerId)
    const totalCalls = records.length
    const successfulCalls = records.filter(r => r.statusCode >= 200 && r.statusCode < 400).length
    const failedCalls = records.filter(r => r.statusCode >= 400).length
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0
    const requestsThisMonth = records.length
    const requestsToday = records.length
    const popularEndpoints = Object.entries(records.reduce((acc, r) => { acc[r.endpoint] = (acc[r.endpoint]||0)+1; return acc }, {} as Record<string, number>)).map(([endpoint,count])=>({endpoint,count})).slice(0, 5)
    const errorRate = records.length ? records.filter(r => r.statusCode >= 400).length / records.length : 0
    const sortedRecords = [...records].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    const lastCallAt = sortedRecords.length > 0 ? sortedRecords[0].timestamp : undefined
    return { requestsThisMonth, requestsToday, totalCalls, successfulCalls, failedCalls, successRate, popularEndpoints, errorRate, lastCallAt }
  }

  async getBusinessOverview(): Promise<BusinessOverview> {
    const totalCustomers = this.customers.size
    const activeCustomers = [...this.customers.values()].filter(c => c.status === 'active').length
    const apiRequestsToday = this.usage.length
    const apiRequestsThisMonth = this.usage.length
    const errorRate = this.usage.length ? this.usage.filter(u => u.statusCode>=400).length / this.usage.length : 0
    
    // Calculate monthly revenue from wallet transactions
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthlyRevenue = [...this.walletTransactions.values()]
      .filter(txn => 
        txn.type === 'credit' && 
        txn.status === 'completed' && 
        txn.paymentMethod !== 'admin' &&
        txn.createdAt >= monthStart
      )
      .reduce((sum, txn) => sum + txn.amount, 0)
    
    return { totalCustomers, activeCustomers, monthlyRevenue, apiRequestsToday, apiRequestsThisMonth, errorRate, newSignupsThisMonth: 0 }
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    return { uptime: process.uptime(), memoryUsage: process.memoryUsage(), activeConnections: 0, databaseHealth: true }
  }

  // QoreID Token operations
  async getQoreIDToken(): Promise<QoreIDToken | null> {
    return this.qoreIdToken
  }

  async createQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    const id = 'qoreid_token_' + Math.random().toString(36).slice(2, 10)
    const token: QoreIDToken = {
      id,
      ...data
    }

    this.qoreIdToken = token
    await this.save()
    return token
  }

  async updateQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    if (!this.qoreIdToken) {
      // If no token exists, create one
      return await this.createQoreIDToken(data)
    }

    this.qoreIdToken = {
      ...this.qoreIdToken,
      ...data,
      updatedAt: new Date()
    }

    await this.save()
    return this.qoreIdToken
  }

  // Admin operations
  async createAdmin(adminData: AdminData): Promise<Admin> {
    const id = `admin_${Date.now().toString(36)}`
    const admin: Admin = {
      id,
      ...adminData,
      createdAt: now(),
      updatedAt: now()
    }
    this.admins.set(id, admin)
    await this.save()
    return admin
  }

  async getAdmin(adminId: string): Promise<Admin | null> {
    return this.admins.get(adminId) || null
  }

  async getAdminByEmail(email: string): Promise<Admin | null> {
    for (const admin of this.admins.values()) {
      if (admin.email === email) return admin
    }
    return null
  }

  async updateAdmin(adminId: string, updates: Partial<AdminData>): Promise<Admin> {
    const admin = this.admins.get(adminId)
    if (!admin) throw new Error('Admin not found')
    
    const updated: Admin = {
      ...admin,
      ...updates,
      updatedAt: now()
    }
    this.admins.set(adminId, updated)
    await this.save()
    return updated
  }

  async listAdmins(): Promise<Admin[]> {
    return Array.from(this.admins.values())
  }

  async deleteAdmin(adminId: string): Promise<void> {
    // Prevent deleting the last super_admin
    const superAdmins = Array.from(this.admins.values()).filter(
      a => a.role === 'super_admin' && a.status === 'active'
    )
    const admin = this.admins.get(adminId)
    if (admin?.role === 'super_admin' && superAdmins.length <= 1) {
      throw new Error('Cannot delete the last super admin')
    }
    
    this.admins.delete(adminId)
    await this.save()
  }

  // Wallet Transaction operations
  async createWalletTransaction(transactionData: WalletTransactionData): Promise<WalletTransaction> {
    const id = 'txn_' + Math.random().toString(36).slice(2, 10)
    const transaction: WalletTransaction = {
      id,
      ...transactionData,
      createdAt: now(),
      completedAt: transactionData.status === 'completed' ? now() : undefined
    }
    this.walletTransactions.set(id, transaction)
    await this.save()
    return transaction
  }

  async getWalletTransaction(transactionId: string): Promise<WalletTransaction | null> {
    return this.walletTransactions.get(transactionId) || null
  }

  async getWalletTransactionByReference(reference: string): Promise<WalletTransaction | null> {
    for (const txn of this.walletTransactions.values()) {
      if (txn.reference === reference) return txn
    }
    return null
  }

  async listWalletTransactions(customerId: string, options: ListOptions = {}): Promise<{ transactions: WalletTransaction[]; total: number }> {
    let transactions = Array.from(this.walletTransactions.values())
      .filter(t => t.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = transactions.length

    // Apply pagination
    if (options.offset) {
      transactions = transactions.slice(options.offset)
    }
    if (options.limit) {
      transactions = transactions.slice(0, options.limit)
    }

    return { transactions, total }
  }

  async getAllWalletTransactions(): Promise<WalletTransaction[]> {
    return Array.from(this.walletTransactions.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async updateWalletTransactionStatus(transactionId: string, status: WalletTransactionStatus, completedAt?: Date): Promise<WalletTransaction> {
    const transaction = this.walletTransactions.get(transactionId)
    if (!transaction) {
      throw new Error('Transaction not found')
    }

    const updated: WalletTransaction = {
      ...transaction,
      status,
      completedAt: completedAt || (status === 'completed' ? now() : transaction.completedAt)
    }
    this.walletTransactions.set(transactionId, updated)
    await this.save()
    return updated
  }

  // Service Pricing operations
  async createServicePricing(pricingData: ServicePricingData): Promise<ServicePricing> {
    const id = 'price_' + Math.random().toString(36).slice(2, 10)
    const pricing: ServicePricing = {
      id,
      ...pricingData,
      createdAt: now(),
      updatedAt: now()
    }
    this.servicePricing.set(pricingData.serviceCode, pricing)
    await this.save()
    return pricing
  }

  async getServicePricing(serviceCode: string): Promise<ServicePricing | null> {
    return this.servicePricing.get(serviceCode) || null
  }

  async listServicePricing(activeOnly: boolean = false): Promise<ServicePricing[]> {
    let pricing = Array.from(this.servicePricing.values())
    if (activeOnly) {
      pricing = pricing.filter(p => p.isActive)
    }
    return pricing.sort((a, b) => a.serviceCode.localeCompare(b.serviceCode))
  }

  async updateServicePricing(serviceCode: string, updates: Partial<ServicePricingData>): Promise<ServicePricing> {
    const pricing = this.servicePricing.get(serviceCode)
    if (!pricing) {
      throw new Error('Service pricing not found')
    }

    const updated: ServicePricing = {
      ...pricing,
      ...updates,
      serviceCode: pricing.serviceCode, // Prevent changing the key
      updatedAt: now()
    }
    this.servicePricing.set(serviceCode, updated)
    await this.save()
    return updated
  }

  async deleteServicePricing(serviceCode: string): Promise<void> {
    this.servicePricing.delete(serviceCode)
    await this.save()
  }

  // Atomic transaction implementation (using in-memory locking)
  private transactionInProgress = false;

  async transaction<T>(callback: (tx: DatabaseTransactionInterface) => Promise<T>): Promise<T> {
    if (this.transactionInProgress) {
      throw new Error('Transaction already in progress');
    }

    this.transactionInProgress = true;
    
    // Save current state for rollback
    const customersBackup = new Map(this.customers);
    const walletTransactionsBackup = new Map(this.walletTransactions);

    try {
      // Create transaction interface with current methods
      const txInterface: DatabaseTransactionInterface = {
        createCustomer: async (customer: CustomerData) => {
          const id = 'cust_' + Math.random().toString(36).slice(2, 10);
          const now = new Date();
          
          const newCustomer: Customer = {
            id,
            ...customer,
            createdAt: now,
            updatedAt: now
          };
          
          this.customers.set(id, newCustomer);
          return newCustomer;
        },

        getCustomer: async (customerId: string) => {
          return this.customers.get(customerId) || null;
        },

        updateCustomer: async (customerId: string, updates: Partial<CustomerData>) => {
          const customer = this.customers.get(customerId);
          if (!customer) {
            throw new Error('Customer not found');
          }

          const updated: Customer = {
            ...customer,
            ...updates,
            updatedAt: new Date()
          };
          
          this.customers.set(customerId, updated);
          return updated;
        },

        createWalletTransaction: async (transactionData: WalletTransactionData) => {
          const id = 'txn_' + Math.random().toString(36).slice(2, 10);
          const now = new Date();
          
          const transaction: WalletTransaction = {
            id,
            ...transactionData,
            createdAt: now,
            completedAt: transactionData.status === 'completed' ? now : undefined
          };
          
          this.walletTransactions.set(id, transaction);
          return transaction;
        },

        getWalletTransaction: async (transactionId: string) => {
          return this.walletTransactions.get(transactionId) || null;
        },

        getWalletTransactionByReference: async (reference: string) => {
          for (const txn of this.walletTransactions.values()) {
            if (txn.reference === reference) {
              return txn;
            }
          }
          return null;
        },

        updateWalletTransactionStatus: async (transactionId: string, status: WalletTransactionStatus, completedAt?: Date) => {
          const transaction = this.walletTransactions.get(transactionId);
          if (!transaction) {
            throw new Error('Transaction not found');
          }

          const updated: WalletTransaction = {
            ...transaction,
            status,
            completedAt: completedAt || (status === 'completed' ? new Date() : transaction.completedAt)
          };
          
          this.walletTransactions.set(transactionId, updated);
          return updated;
        }
      };

      const result = await callback(txInterface);
      await this.save(); // Save the final state
      return result;
    } catch (error) {
      // Rollback by restoring backups
      this.customers = customersBackup;
      this.walletTransactions = walletTransactionsBackup;
      throw error;
    } finally {
      this.transactionInProgress = false;
    }
  }
}
