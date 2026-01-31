/**
 * Database Abstraction Layer
 * Supports both Firestore (Firebase) and PostgreSQL (Digital Ocean)
 * Switch providers by changing DATABASE_TYPE environment variable
 */

import { FirestoreDatabase } from './firestore.js';
import { PostgreSQLDatabase } from './postgresql.js';
import { MemoryDatabase } from './memory.js';

export interface DatabaseInterface {
  // Customer operations
  createCustomer(customer: CustomerData): Promise<Customer>;
  getCustomer(customerId: string): Promise<Customer | null>;
  getCustomerByEmail(email: string): Promise<Customer | null>;
  getCustomerByResetTokenHash(tokenHash: string): Promise<Customer | null>;
  updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer>;
  listCustomers(options?: ListOptions): Promise<{ customers: Customer[]; total: number; }>;
  deleteCustomer(customerId: string): Promise<void>;

  // API Key operations
  createApiKey(apiKey: ApiKeyData): Promise<ApiKey>;
  getApiKey(keyId: string): Promise<ApiKey | null>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | null>;
  listApiKeys(customerId?: string): Promise<ApiKey[]>;
  updateApiKey(keyId: string, updates: Partial<ApiKeyData>): Promise<ApiKey>;
  deleteApiKey(keyId: string): Promise<void>;

  // Usage tracking
  recordUsage(usage: UsageRecordData): Promise<void>;
  getUsage(customerId: string, period?: string): Promise<UsageRecord[]>;
  getUsageStats(customerId: string): Promise<UsageStats>;

  // Admin operations
  getBusinessOverview(): Promise<BusinessOverview>;
  getSystemMetrics(): Promise<SystemMetrics>;

  // QoreID Token operations (Utility - not tracked for billing)
  getQoreIDToken(): Promise<QoreIDToken | null>;
  createQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken>;
  updateQoreIDToken(data: Omit<QoreIDToken, 'id'>): Promise<QoreIDToken>;

  // Admin operations
  createAdmin(admin: AdminData): Promise<Admin>;
  getAdmin(adminId: string): Promise<Admin | null>;
  getAdminByEmail(email: string): Promise<Admin | null>;
  updateAdmin(adminId: string, updates: Partial<AdminData>): Promise<Admin>;
  listAdmins(): Promise<Admin[]>;
  deleteAdmin(adminId: string): Promise<void>;

  // Wallet Transaction operations
  createWalletTransaction(transaction: WalletTransactionData): Promise<WalletTransaction>;
  getWalletTransaction(transactionId: string): Promise<WalletTransaction | null>;
  getWalletTransactionByReference(reference: string): Promise<WalletTransaction | null>;
  listWalletTransactions(customerId: string, options?: ListOptions): Promise<{ transactions: WalletTransaction[]; total: number }>;
  getAllWalletTransactions(): Promise<WalletTransaction[]>;
  updateWalletTransactionStatus(transactionId: string, status: WalletTransactionStatus, completedAt?: Date): Promise<WalletTransaction>;

  // Service Pricing operations
  createServicePricing(pricing: ServicePricingData): Promise<ServicePricing>;
  getServicePricing(serviceCode: string): Promise<ServicePricing | null>;
  listServicePricing(activeOnly?: boolean): Promise<ServicePricing[]>;
  updateServicePricing(serviceCode: string, updates: Partial<ServicePricingData>): Promise<ServicePricing>;
  deleteServicePricing(serviceCode: string): Promise<void>;

  // Atomic Transaction Support
  transaction<T>(callback: (tx: DatabaseTransactionInterface) => Promise<T>): Promise<T>;

  // Health check
  healthCheck(): Promise<boolean>;
  initialize(): Promise<void>;
}

export interface DatabaseTransactionInterface {
  // Customer operations within transaction
  createCustomer(customer: CustomerData): Promise<Customer>;
  getCustomer(customerId: string): Promise<Customer | null>;
  updateCustomer(customerId: string, updates: Partial<CustomerData>): Promise<Customer>;

  // Wallet Transaction operations within transaction
  createWalletTransaction(transaction: WalletTransactionData): Promise<WalletTransaction>;
  getWalletTransaction(transactionId: string): Promise<WalletTransaction | null>;
  getWalletTransactionByReference(reference: string): Promise<WalletTransaction | null>;
  updateWalletTransactionStatus(transactionId: string, status: WalletTransactionStatus, completedAt?: Date): Promise<WalletTransaction>;
}

// Data interfaces
export type VerificationStatus = 'inactive' | 'cac_pending' | 'cac_verified' | 'admin_review' | 'verified' | 'rejected';

export interface BusinessInfo {
  rcNumber: string;              // CAC RC Number
  companyName: string;           // Company name (for comparison)
  businessAddress: string;       // Full business address
  businessEmail: string;         // Business email
  businessPhone: string;         // Business phone number
  directorName: string;          // Director/Owner full name
  yearOfIncorporation: string;   // Year business was incorporated
  natureOfBusiness: string;      // Description of business activities
}

export interface ComplianceQuestions {
  requiresLicense: boolean;                    // Q1: License required?
  amlCompliance: boolean;                      // Q2: AML compliance?
  amlSanctions: boolean;                       // Q3: AML breach sanctions?
  dataProtectionPolicies: boolean;             // Q4: Data protection policies?
  dataSecurityMeasures: boolean;               // Q5: Security measures?
  internationalDataTransfer: boolean;          // Q6: International data transfer?
  alternateDatabase: boolean;                  // Q7: Alternate database?
  regulatedByAuthority: boolean;               // Q8: Regulated by authority?
  fraudPreventionPolicies: boolean;            // Q9: Fraud prevention?
  ndaWithEmployees: boolean;                   // Q10: NDA with employees?
  dataBreachSanctions: boolean;                // Q11: Data breach sanctions?
  countriesOfOperation: string;                // Q12: Countries list (comma-separated)
  otherPurposeUsage: boolean;                  // Q13: Other purpose usage?
  regulatorySanctions: boolean;                // Q14: Regulatory sanctions in last 2 years?
}

export interface ContactPerson {
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  website?: string;              // Optional
}

export interface CACVerification {
  verified: boolean;             // Did API verification succeed?
  verifiedAt?: Date;             // When verification was attempted
  qoreidStatus?: string;         // Status from QoreID response
  qoreidRcNumber?: string;       // RC number from QoreID response
  qoreidCompanyName?: string;    // Company name from QoreID response
  nameMatch?: boolean;           // Does customer input match QoreID data?
  errorMessage?: string;         // Error if verification failed
}

export interface VerificationDocuments {
  cacCertificate?: string;       // CAC certificate PDF/image (optional)
  supportingDocs?: string[];     // Additional supporting documents (optional)
}

export interface VerificationData {
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;

  // BUSINESS INFORMATION (Required - submitted by customer)
  businessInfo?: BusinessInfo;

  // COMPLIANCE QUESTIONS (14 Yes/No questions)
  complianceQuestions?: ComplianceQuestions;

  // CONTACT PERSON (Primary contact for the business)
  contactPerson?: ContactPerson;

  // CAC API VERIFICATION RESULT (from QoreID)
  cacVerification?: CACVerification;

  // OPTIONAL DOCUMENTS (Supporting documents - URLs after upload)
  documents?: VerificationDocuments;

  // ADMIN REVIEW
  adminNotes?: string;
  rejectionReason?: string;
}

export interface CustomerData {
  email: string;
  company?: string;
  walletBalance: number; // Pay-as-you-go wallet balance in kobo
  status: 'active' | 'suspended' | 'cancelled';
  paystackCustomerId?: string; // For payment processing (optional)
  passwordHash?: string; // FIXED: Add password hash to persistent storage
  resetTokenHash?: string; // Password reset token hash
  resetTokenExpires?: Date; // Password reset token expiry
  phone_number?: string; // Store phone number
  full_name?: string; // Store full name
  nin_bvn?: string; // Store NIN/BVN
  id_document?: string; // Store ID document

  // Business verification
  verificationStatus?: VerificationStatus;
  verificationData?: VerificationData;
}

export interface Customer extends CustomerData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyData {
  customerId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  permissions: string[];
  status: 'active' | 'suspended' | 'revoked';
  requestsUsed: number;
  rateLimitPerMin: number;
  expiresAt?: Date;
}

export interface ApiKey extends ApiKeyData {
  id: string;
  lastUsed?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageRecordData {
  customerId: string;
  keyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  billingPeriod: string;
  cost: number; // Cost of this API call in Naira
}

export interface UsageRecord extends UsageRecordData {
  id: string;
  timestamp: Date;
}

export interface UsageStats {
  requestsThisMonth: number;
  requestsToday: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  popularEndpoints: Array<{ endpoint: string; count: number; }>;
  errorRate: number;
  lastCallAt?: Date;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
}

export interface BusinessOverview {
  totalCustomers: number;
  activeCustomers: number;
  monthlyRevenue: number;
  apiRequestsToday: number;
  apiRequestsThisMonth: number;
  errorRate: number;
  newSignupsThisMonth: number;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeConnections: number;
  databaseHealth: boolean;
}

// QoreID Token interface (for external API authentication)
export interface QoreIDToken {
  id: string;
  accessToken: string;
  tokenType: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Admin interfaces
export type AdminRole = 'super_admin' | 'admin' | 'support';

export interface AdminData {
  email: string;
  passwordHash: string;
  fullName?: string;
  role: AdminRole;
  permissions: string[];
  status: 'active' | 'suspended';
  createdBy?: string;
}

export interface Admin extends AdminData {
  id: string;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Wallet Transaction interfaces
export type WalletTransactionType = 'credit' | 'debit';
export type WalletTransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';
export type PaymentMethod = 'card' | 'bank_transfer' | 'admin' | 'api_charge' | 'refund';

export interface WalletTransactionData {
  customerId: string;
  type: WalletTransactionType;
  amount: number;                    // Amount in kobo
  balanceBefore: number;             // Balance before transaction (kobo)
  balanceAfter: number;              // Balance after transaction (kobo)
  description: string;               // e.g., 'API: name-search' or 'Top-up via card'
  reference: string;                 // Unique reference (payment gateway ref or internal)
  usageRecordId?: string;            // Links to usage_records for API charges
  paymentMethod?: PaymentMethod;
  status: WalletTransactionStatus;
  metadata?: Record<string, any>;    // Extra data (e.g., payment gateway response)
}

export interface WalletTransaction extends WalletTransactionData {
  id: string;
  createdAt: Date;
  completedAt?: Date;
}

// Service Pricing interfaces
export interface ServicePricingData {
  serviceCode: string;               // e.g., 'name-search', 'company-registration'
  serviceName: string;               // Human-readable name
  priceKobo: number;                 // Price in kobo (100 kobo = ₦1)
  currency: string;                  // 'NGN'
  description?: string;
  isActive: boolean;
}

export interface ServicePricing extends ServicePricingData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

// Database factory
function createDatabase(): DatabaseInterface {
  // Check DATABASE_TYPE environment variable
  // Supports: memory, firestore, postgresql/postgres
  const databaseType = process.env.DATABASE_TYPE || 'memory';
  
  console.log(`🗄️  Initializing database: ${databaseType}`);
  
  switch (databaseType.toLowerCase()) {
    case 'firestore':
      return new FirestoreDatabase();
    case 'memory':
      return new MemoryDatabase();
    case 'postgresql':
    case 'postgres':
      return new PostgreSQLDatabase();
    default:
      console.warn(`Unknown database type: ${databaseType}, falling back to memory`);
      return new MemoryDatabase();
  }
}

// Export singleton instance
export const database = createDatabase();

// Initialize database on import
database.initialize().catch(console.error);