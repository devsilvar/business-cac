/**
 * Firestore Implementation
 * Firebase-specific database operations
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

// Import Firestore (will be available in Firebase Functions environment)
let db: any;

export class FirestoreDatabase implements DatabaseInterface {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Use the centralized Firebase configuration
      const { initializeFirebaseAdmin } = await import('../config/firebase.js');
      const admin = await initializeFirebaseAdmin();
      
      db = admin.firestore();

      this.initialized = true;
      console.log('✅ Firestore initialized successfully');
    } catch (error) {
      console.error('❌ Firestore initialization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await db.collection('health').doc('test').get();
      return true;
    } catch (error) {
      console.error('Firestore health check failed:', error);
      return false;
    }
  }

  // Customer operations
  async createCustomer(customerData: CustomerData): Promise<Customer> {
    const docRef = db.collection('customers').doc();
    const now = new Date();
    
    const customer: Customer = {
      id: docRef.id,
      // Default new customers to inactive unless explicitly set
      verificationStatus: customerData.verificationStatus || 'inactive',
      ...customerData,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set({
      ...customer,
      resetTokenExpires: customer.resetTokenExpires ? customer.resetTokenExpires.toISOString() : null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    return customer;
  }

  async getCustomer(customerId: string): Promise<Customer | null> {
    const doc = await db.collection('customers').doc(customerId).get();
    
    if (!doc.exists) return null;
    
    const data = doc.data();
    return {
      id: doc.id,
      // Grandfather existing customers if missing
      verificationStatus: data.verificationStatus || 'inactive',
      resetTokenExpires: data.resetTokenExpires ? new Date(data.resetTokenExpires) : undefined,
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt)
    };
  }

  async getCustomerByEmail(email: string): Promise<Customer | null> {
    const snapshot = await db.collection('customers')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      // Grandfather existing customers if missing
      verificationStatus: data.verificationStatus || 'inactive',
      resetTokenExpires: data.resetTokenExpires ? new Date(data.resetTokenExpires) : undefined,
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt)
    };
  }

  async getCustomerByResetTokenHash(tokenHash: string): Promise<Customer | null> {
    const snapshot = await db.collection('customers')
      .where('resetTokenHash', '==', tokenHash)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      // Grandfather existing customers if missing
      verificationStatus: data.verificationStatus || 'inactive',
      resetTokenExpires: data.resetTokenExpires ? new Date(data.resetTokenExpires) : undefined,
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt)
    };
  }

  async updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer> {
    const docRef = db.collection('customers').doc(customerId);
    const now = new Date();
    
    await docRef.update({
      ...updates,
      resetTokenExpires: (updates as any).resetTokenExpires ? (updates as any).resetTokenExpires.toISOString() : null,
      updatedAt: now.toISOString()
    });

    const updated = await this.getCustomer(customerId);
    if (!updated) throw new Error('Customer not found after update');
    
    return updated;
  }

  async listCustomers(options: ListOptions = {}): Promise<{ customers: Customer[]; total: number; }> {
    let query = db.collection('customers');

    // Apply search filter
    if (options.search) {
      query = query.where('email', '>=', options.search)
                  .where('email', '<=', options.search + '\uf8ff');
    }

    // Apply status filter
    if (options.status) {
      query = query.where('status', '==', options.status);
    }

    // Apply pagination
    if (options.offset) {
      query = query.offset(options.offset);
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    const customers: Customer[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      customers.push({
        id: doc.id,
        // Grandfather existing customers if missing
        verificationStatus: data.verificationStatus || 'inactive',
        resetTokenExpires: data.resetTokenExpires ? new Date(data.resetTokenExpires) : undefined,
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt)
      });
    });

    // Get total count (approximate for Firestore)
    const totalSnapshot = await db.collection('customers').get();
    const total = totalSnapshot.size;

    return { customers, total };
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await db.collection('customers').doc(customerId).delete();
  }

  // API Key operations
  async createApiKey(apiKeyData: ApiKeyData): Promise<ApiKey> {
    const docRef = db.collection('apiKeys').doc();
    const now = new Date();
    
    const apiKey: ApiKey = {
      id: docRef.id,
      ...apiKeyData,
      createdAt: now,
      updatedAt: now
    };

    await docRef.set({
      ...apiKey,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastUsed: apiKey.lastUsed?.toISOString(),
      expiresAt: apiKey.expiresAt?.toISOString()
    });

    return apiKey;
  }

  async getApiKey(keyId: string): Promise<ApiKey | null> {
    const doc = await db.collection('apiKeys').doc(keyId).get();
    
    if (!doc.exists) return null;
    
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      lastUsed: data.lastUsed ? new Date(data.lastUsed) : undefined,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined
    };
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const snapshot = await db.collection('apiKeys')
      .where('keyHash', '==', keyHash)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      lastUsed: data.lastUsed ? new Date(data.lastUsed) : undefined,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined
    };
  }

  async listApiKeys(customerId?: string): Promise<ApiKey[]> {
    let query = db.collection('apiKeys');
    
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }

    const snapshot = await query.get();
    const apiKeys: ApiKey[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      apiKeys.push({
        id: doc.id,
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        lastUsed: data.lastUsed ? new Date(data.lastUsed) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined
      });
    });

    return apiKeys;
  }

  async updateApiKey(keyId: string, updates: Partial<ApiKeyData>): Promise<ApiKey> {
    const docRef = db.collection('apiKeys').doc(keyId);
    const now = new Date();
    
    const updateData: any = {
      ...updates,
      updatedAt: now.toISOString()
    };

    // Handle date fields
    if ('expiresAt' in updates && updates.expiresAt) {
      updateData.expiresAt = updates.expiresAt.toISOString();
    }

    await docRef.update(updateData);

    const updated = await this.getApiKey(keyId);
    if (!updated) throw new Error('API key not found after update');
    
    return updated;
  }

  async deleteApiKey(keyId: string): Promise<void> {
    await db.collection('apiKeys').doc(keyId).delete();
  }

  // Usage tracking
  async recordUsage(usageData: UsageRecordData): Promise<void> {
    const docRef = db.collection('usageRecords').doc();
    const now = new Date();
    
    const record = {
      id: docRef.id,
      ...usageData,
      timestamp: now.toISOString()
    };
    
    console.log('[Firestore] Recording usage:', JSON.stringify(record, null, 2));
    
    await docRef.set(record);
    
    console.log('[Firestore] ✓ Usage record saved with ID:', docRef.id);
  }

  async getUsage(customerId: string, period?: string): Promise<UsageRecord[]> {
    let query = db.collection('usageRecords')
      .where('customerId', '==', customerId);

    if (period) {
      query = query.where('billingPeriod', '==', period);
    }

    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const usage: UsageRecord[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      usage.push({
        id: doc.id,
        ...data,
        timestamp: new Date(data.timestamp)
      });
    });

    return usage;
  }

  async getUsageStats(customerId: string): Promise<UsageStats> {
    console.log('[Firestore] Getting usage stats for customerId:', customerId);
    
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];
    
    console.log('[Firestore] Query parameters:', { thisMonth, today });

    // Get this month's usage
    const monthlyUsage = await this.getUsage(customerId, thisMonth);
    console.log('[Firestore] Monthly usage count:', monthlyUsage.length);
    
    // Get ALL usage for this customer
    const allUsageQuery = db.collection('usageRecords')
      .where('customerId', '==', customerId)
      .orderBy('timestamp', 'desc');
    const allUsageSnapshot = await allUsageQuery.get();
    
    console.log('[Firestore] Total usage records found:', allUsageSnapshot.size);
    
    const allUsage: UsageRecord[] = [];
    allUsageSnapshot.forEach(doc => {
      const data = doc.data();
      allUsage.push({
        id: doc.id,
        ...data,
        timestamp: new Date(data.timestamp)
      });
    });
    
    console.log('[Firestore] All usage count:', allUsage.length);

    const todayUsage = monthlyUsage.filter(record => 
      record.timestamp.toISOString().startsWith(today)
    );

    // Calculate success/failure stats
    const successfulCalls = allUsage.filter(record => record.statusCode >= 200 && record.statusCode < 400).length;
    const failedCalls = allUsage.filter(record => record.statusCode >= 400).length;
    const totalCalls = allUsage.length;
    const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;

    // Calculate endpoint popularity
    const endpointCounts = monthlyUsage.reduce((acc, record) => {
      acc[record.endpoint] = (acc[record.endpoint] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const popularEndpoints = Object.entries(endpointCounts)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate error rate
    const errorRequests = monthlyUsage.filter(record => record.statusCode >= 400);
    const errorRate = monthlyUsage.length > 0 ? errorRequests.length / monthlyUsage.length : 0;

    // Get last call timestamp
    const lastCallAt = allUsage.length > 0 ? allUsage[0].timestamp : undefined;

    return {
      requestsThisMonth: monthlyUsage.length,
      requestsToday: todayUsage.length,
      totalCalls,
      successfulCalls,
      failedCalls,
      successRate,
      popularEndpoints,
      errorRate,
      lastCallAt
    };
  }

  // Admin operations
  async getBusinessOverview(): Promise<BusinessOverview> {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get customer stats
    const customersSnapshot = await db.collection('customers').get();
    const totalCustomers = customersSnapshot.size;
    
    const activeCustomers = customersSnapshot.docs.filter(doc => 
      doc.data().status === 'active'
    ).length;

    // Get new signups this month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const newSignupsSnapshot = await db.collection('customers')
      .where('createdAt', '>=', startOfMonth.toISOString())
      .get();
    const newSignupsThisMonth = newSignupsSnapshot.size;

    // Get usage stats
    const usageSnapshot = await db.collection('usageRecords')
      .where('billingPeriod', '==', thisMonth)
      .get();
    const apiRequestsThisMonth = usageSnapshot.size;

    const today = now.toISOString().split('T')[0];
    const todayUsageSnapshot = await db.collection('usageRecords')
      .where('timestamp', '>=', today)
      .get();
    const apiRequestsToday = todayUsageSnapshot.size;

    // Calculate error rate
    let errorRequests = 0;
    usageSnapshot.forEach(doc => {
      if (doc.data().statusCode >= 400) {
        errorRequests++;
      }
    });
    const errorRate = apiRequestsThisMonth > 0 ? errorRequests / apiRequestsThisMonth : 0;

    // Calculate monthly revenue from wallet transactions (completed credits this month)
    const transactionsSnapshot = await db.collection('wallet_transactions')
      .where('createdAt', '>=', startOfMonth)
      .where('type', '==', 'credit')
      .where('status', '==', 'completed')
      .get();
    
    let monthlyRevenue = 0;
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      // Exclude admin credits (manual credits by admins should not count as revenue)
      if (data.paymentMethod !== 'admin') {
        monthlyRevenue += Number(data.amount || 0);
      }
    });

    return {
      totalCustomers,
      activeCustomers,
      monthlyRevenue,
      apiRequestsToday,
      apiRequestsThisMonth,
      errorRate,
      newSignupsThisMonth
    };
  }

  async getSystemMetrics(): Promise<SystemMetrics> {
    const databaseHealth = await this.healthCheck();
    
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      activeConnections: 0, // Not applicable for Firestore
      databaseHealth
    };
  }

  // QoreID Token operations
  async getQoreIDToken(): Promise<QoreIDToken | null> {
    const docRef = db.collection('qoreidTokens').doc('current');
    const snap = await docRef.get();

    if (!snap.exists) return null;

    const data = snap.data();
    return {
      id: 'current',
      accessToken: data.accessToken,
      tokenType: data.tokenType,
      expiresAt: data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt),
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
    };
  }

  async createQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    const docRef = db.collection('qoreidTokens').doc('current');
    await docRef.set({
      accessToken: data.accessToken,
      tokenType: data.tokenType,
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    }, { merge: true });

    return {
      id: 'current',
      ...data
    };
  }

  async updateQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken> {
    // Same behavior as create: upsert single record
    return this.createQoreIDToken(data);
  }

  // Admin operations
  async createAdmin(adminData: AdminData): Promise<Admin> {
    const id = `admin_${Date.now().toString(36)}`;
    const admin: Admin = {
      id,
      ...adminData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('admins').doc(id).set({
      ...adminData,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt
    });
    
    return admin;
  }

  async getAdmin(adminId: string): Promise<Admin | null> {
    const doc = await db.collection('admins').doc(adminId).get();
    if (!doc.exists) return null;
    
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email,
      passwordHash: data.passwordHash,
      fullName: data.fullName,
      role: data.role,
      permissions: data.permissions || [],
      status: data.status,
      lastLogin: data.lastLogin?.toDate ? data.lastLogin.toDate() : data.lastLogin,
      createdBy: data.createdBy,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
    };
  }

  async getAdminByEmail(email: string): Promise<Admin | null> {
    const snapshot = await db.collection('admins')
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email,
      passwordHash: data.passwordHash,
      fullName: data.fullName,
      role: data.role,
      permissions: data.permissions || [],
      status: data.status,
      lastLogin: data.lastLogin?.toDate ? data.lastLogin.toDate() : data.lastLogin,
      createdBy: data.createdBy,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
    };
  }

  async updateAdmin(adminId: string, updates: Partial<AdminData>): Promise<Admin> {
    const docRef = db.collection('admins').doc(adminId);
    const doc = await docRef.get();
    
    if (!doc.exists) throw new Error('Admin not found');
    
    await docRef.update({
      ...updates,
      updatedAt: new Date()
    });
    
    const updated = await this.getAdmin(adminId);
    if (!updated) throw new Error('Admin not found after update');
    return updated;
  }

  async listAdmins(): Promise<Admin[]> {
    const snapshot = await db.collection('admins').orderBy('createdAt', 'desc').get();
    
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        role: data.role,
        permissions: data.permissions || [],
        status: data.status,
        lastLogin: data.lastLogin?.toDate ? data.lastLogin.toDate() : data.lastLogin,
        createdBy: data.createdBy,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
      };
    });
  }

  async deleteAdmin(adminId: string): Promise<void> {
    // Prevent deleting the last super_admin
    const superAdminsSnapshot = await db.collection('admins')
      .where('role', '==', 'super_admin')
      .where('status', '==', 'active')
      .get();
    
    const admin = await this.getAdmin(adminId);
    if (admin?.role === 'super_admin' && superAdminsSnapshot.size <= 1) {
      throw new Error('Cannot delete the last super admin');
    }
    
    await db.collection('admins').doc(adminId).delete();
  }

  // ==================== WALLET TRANSACTION OPERATIONS ====================

  async createWalletTransaction(transactionData: WalletTransactionData): Promise<WalletTransaction> {
    const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    
    const transaction: WalletTransaction = {
      id,
      ...transactionData,
      createdAt: now,
      completedAt: transactionData.status === 'completed' ? now : undefined
    };

    await db.collection('wallet_transactions').doc(id).set({
      ...transaction,
      createdAt: now,
      completedAt: transaction.completedAt || null
    });

    return transaction;
  }

  async getWalletTransaction(transactionId: string): Promise<WalletTransaction | null> {
    const doc = await db.collection('wallet_transactions').doc(transactionId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return {
      id: doc.id,
      customerId: data.customerId,
      type: data.type,
      amount: data.amount,
      balanceBefore: data.balanceBefore,
      balanceAfter: data.balanceAfter,
      description: data.description,
      reference: data.reference,
      usageRecordId: data.usageRecordId,
      paymentMethod: data.paymentMethod,
      status: data.status,
      metadata: data.metadata,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : (data.completedAt ? new Date(data.completedAt) : undefined)
    };
  }

  async getWalletTransactionByReference(reference: string): Promise<WalletTransaction | null> {
    const snapshot = await db.collection('wallet_transactions')
      .where('reference', '==', reference)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      customerId: data.customerId,
      type: data.type,
      amount: data.amount,
      balanceBefore: data.balanceBefore,
      balanceAfter: data.balanceAfter,
      description: data.description,
      reference: data.reference,
      usageRecordId: data.usageRecordId,
      paymentMethod: data.paymentMethod,
      status: data.status,
      metadata: data.metadata,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : (data.completedAt ? new Date(data.completedAt) : undefined)
    };
  }

  async listWalletTransactions(customerId: string, options: ListOptions = {}): Promise<{ transactions: WalletTransaction[]; total: number }> {
    let query = db.collection('wallet_transactions')
      .where('customerId', '==', customerId)
      .orderBy('createdAt', 'desc');

    // Get total count first
    const countSnapshot = await db.collection('wallet_transactions')
      .where('customerId', '==', customerId)
      .get();
    const total = countSnapshot.size;

    // Apply pagination
    if (options.offset) {
      const offsetSnapshot = await query.limit(options.offset).get();
      if (!offsetSnapshot.empty) {
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    const transactions = snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        customerId: data.customerId,
        type: data.type,
        amount: data.amount,
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        description: data.description,
        reference: data.reference,
        usageRecordId: data.usageRecordId,
        paymentMethod: data.paymentMethod,
        status: data.status,
        metadata: data.metadata,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : (data.completedAt ? new Date(data.completedAt) : undefined)
      };
    });

    return { transactions, total };
  }

  async getAllWalletTransactions(): Promise<WalletTransaction[]> {
    const snapshot = await db.collection('wallet_transactions')
      .orderBy('createdAt', 'desc')
      .get();
    
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: doc.id,
        customerId: data.customerId,
        type: data.type,
        amountKobo: data.amountKobo,
        amount: data.amount,
        balanceBefore: data.balanceBefore,
        balanceAfter: data.balanceAfter,
        description: data.description,
        reference: data.reference,
        usageRecordId: data.usageRecordId,
        paymentMethod: data.paymentMethod,
        status: data.status,
        metadata: data.metadata,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : (data.completedAt ? new Date(data.completedAt) : undefined)
      };
    });
  }

  async updateWalletTransactionStatus(transactionId: string, status: WalletTransactionStatus, completedAt?: Date): Promise<WalletTransaction> {
    const docRef = db.collection('wallet_transactions').doc(transactionId);
    
    await docRef.update({
      status,
      completedAt: completedAt || (status === 'completed' ? new Date() : null)
    });

    const updated = await this.getWalletTransaction(transactionId);
    if (!updated) throw new Error('Transaction not found after update');
    return updated;
  }

  // ==================== SERVICE PRICING OPERATIONS ====================

  async createServicePricing(pricingData: ServicePricingData): Promise<ServicePricing> {
    const id = `price_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    const pricing: ServicePricing = {
      id,
      ...pricingData,
      createdAt: now,
      updatedAt: now
    };

    // Use serviceCode as document ID for easy lookup
    await db.collection('service_pricing').doc(pricingData.serviceCode).set({
      ...pricing,
      createdAt: now,
      updatedAt: now
    });

    return pricing;
  }

  async getServicePricing(serviceCode: string): Promise<ServicePricing | null> {
    const doc = await db.collection('service_pricing').doc(serviceCode).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return {
      id: data.id || doc.id,
      serviceCode: data.serviceCode,
      serviceName: data.serviceName,
      priceKobo: data.priceKobo,
      currency: data.currency,
      description: data.description,
      isActive: data.isActive,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
    };
  }

  async listServicePricing(activeOnly: boolean = false): Promise<ServicePricing[]> {
    let query: any = db.collection('service_pricing');
    
    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        serviceCode: data.serviceCode,
        serviceName: data.serviceName,
        priceKobo: data.priceKobo,
        currency: data.currency,
        description: data.description,
        isActive: data.isActive,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
      };
    }).sort((a: ServicePricing, b: ServicePricing) => a.serviceCode.localeCompare(b.serviceCode));
  }

  async updateServicePricing(serviceCode: string, updates: Partial<ServicePricingData>): Promise<ServicePricing> {
    const docRef = db.collection('service_pricing').doc(serviceCode);
    
    await docRef.update({
      ...updates,
      updatedAt: new Date()
    });

    const updated = await this.getServicePricing(serviceCode);
    if (!updated) throw new Error('Service pricing not found after update');
    return updated;
  }

  async deleteServicePricing(serviceCode: string): Promise<void> {
    await db.collection('service_pricing').doc(serviceCode).delete();
  }

  // Atomic transaction implementation using Firestore batched writes
  async transaction<T>(callback: (tx: DatabaseTransactionInterface) => Promise<T>): Promise<T> {
    const batch = db.batch();
    let operationsComplete = false;

    // Create transaction interface with batched operations
    const txInterface: DatabaseTransactionInterface = {
      createCustomer: async (customer: CustomerData) => {
        if (operationsComplete) {
          throw new Error('Transaction already completed');
        }
        
        const id = `cust_${Math.random().toString(36).slice(2, 10)}`;
        const customerRef = db.collection('customers').doc(id);
        
        const customerDoc = {
          ...customer,
          created_at: new Date(),
          updated_at: new Date()
        };

        batch.set(customerRef, customerDoc);
        return { id, ...customer, createdAt: new Date(), updatedAt: new Date() } as Customer;
      },

      getCustomer: async (customerId: string) => {
        const customerDoc = await db.collection('customers').doc(customerId).get();
        if (!customerDoc.exists) {
          return null;
        }
        // return this.mapCustomerDoc(customerDoc); // Fix needed - method doesn't exist
        return null;
      },

      updateCustomer: async (customerId: string, updates: Partial<CustomerData>) => {
        if (operationsComplete) {
          throw new Error('Transaction already completed');
        }

        const customerRef = db.collection('customers').doc(customerId);
        const updateData = {
          ...updates,
          updated_at: new Date()
        };

        batch.update(customerRef, updateData);
        
        // Get the current customer data to return
        const currentCustomer = await this.getCustomer(customerId);
        if (!currentCustomer) {
          throw new Error('Customer not found');
        }
        
        return {
          ...currentCustomer,
          ...updates,
          updatedAt: new Date()
        } as Customer;
      },

      createWalletTransaction: async (transactionData: WalletTransactionData) => {
        if (operationsComplete) {
          throw new Error('Transaction already completed');
        }

        const id = `txn_${Math.random().toString(36).slice(2, 10)}`;
        const transactionRef = db.collection('wallet_transactions').doc(id);
        
        const transactionDoc = {
          ...transactionData,
          id,
          created_at: new Date()
        };

        batch.set(transactionRef, transactionDoc);
        return { id, ...transactionData, createdAt: new Date() } as WalletTransaction;
      },

      getWalletTransaction: async (transactionId: string) => {
        const transactionDoc = await db.collection('wallet_transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
          return null;
        }
        // // return this.mapWalletTransactionDoc(transactionDoc); // Fix needed - method doesn't exist
        return null; // Fix needed - method doesn't exist
        return null;
      },

      getWalletTransactionByReference: async (reference: string) => {
        const snapshot = await db.collection('wallet_transactions')
          .where('reference', '==', reference)
          .limit(1)
          .get();
        
        if (snapshot.empty) {
          return null;
        }
        
        // return this.mapWalletTransactionDoc(snapshot.docs[0]); // Fix needed - method doesn't exist
        return null;
      },

      updateWalletTransactionStatus: async (transactionId: string, status: WalletTransactionStatus, completedAt?: Date) => {
        if (operationsComplete) {
          throw new Error('Transaction already completed');
        }

        const transactionRef = db.collection('wallet_transactions').doc(transactionId);
        const updateData = {
          status,
          completed_at: completedAt || (status === 'completed' ? new Date() : null)
        };

        batch.update(transactionRef, updateData);
        
        // Get the current transaction to return
        const currentTransaction = await this.getWalletTransaction(transactionId);
        if (!currentTransaction) {
          throw new Error('Transaction not found');
        }
        
        return {
          ...currentTransaction,
          status,
          completedAt: completedAt || (status === 'completed' ? new Date() : currentTransaction.completedAt)
        } as WalletTransaction;
      }
    };

    try {
      const result = await callback(txInterface);
      operationsComplete = true;
      await batch.commit();
      return result;
    } catch (error) {
      throw error;
    }
  }
}
