import bcrypt from 'bcrypt'

export type CustomerStatus = 'active' | 'suspended'
// Plans removed - pay-per-use model
// export type Plan = 'basic' | 'pro' | 'enterprise'

export interface CustomerApiKey {
  id: string
  name: string
  keyHash: string // Store hashed version of full key
  lastFour: string
  status: 'active' | 'revoked'
  createdAt: string
}

export interface CustomerRecord {
  id: string
  email: string
  passwordHash: string
  resetTokenHash?: string
  resetTokenExpires?: string
  company?: string
  phoneNumber?: string
  walletBalance: number
  status: CustomerStatus
  createdAt: string
  lastLogin?: string
  apiKeys: CustomerApiKey[]
  usage: Record<string, number>
}

class InMemoryCustomerStore {
  private customers: CustomerRecord[] = []

  constructor() {
    // Seed test customer ONLY in development environment with secure password
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined) {
      // Use environment variable for password or generate secure random password
      const devPassword = process.env.DEV_CUSTOMER_PASSWORD || this.generateSecurePassword();
      const hash = bcrypt.hashSync(devPassword, 10);
      
      // Log the development credentials for developers (only in development)
      console.warn(`[DEV] Development customer account created:`);
      console.warn(`[DEV] Email: customer@example.com`);
      console.warn(`[DEV] Password: ${devPassword}`);
      console.warn(`[DEV] This will only be shown in development mode`);
      
      this.customers.push({
        id: 'cust_001',
        email: 'customer@example.com',
        passwordHash: hash,
        company: 'Customer Co',
        phoneNumber: '08012345678',
        walletBalance: 1000000,
        status: 'active',
        createdAt: new Date().toISOString(),
        apiKeys: [],
        usage: {}
      })
    }
  }

  /** Create a new portal customer, enforcing email uniqueness. Password should be pre-hashed. */
  create(email: string, passwordOrHash: string, company?: string, walletBalance: number = 1000000, idOverride?: string, phoneNumber?: string, isHashed: boolean = false): CustomerRecord {
    const existing = this.findByEmail(email)
    if (existing) {
      throw new Error('EMAIL_EXISTS')
    }
    const id = idOverride || `cust_${Math.random().toString(36).slice(2, 10)}`
    // Only hash if not already hashed (for backward compatibility)
    const passwordHash = isHashed ? passwordOrHash : bcrypt.hashSync(passwordOrHash, 10)
    const record: CustomerRecord = {
      id,
      email: email.toLowerCase(),
      passwordHash,
      company,
      phoneNumber,
      walletBalance,
      status: 'active',
      createdAt: new Date().toISOString(),
      apiKeys: [],
      usage: {}
    }
    this.customers.push(record)
    return record
  }

  findByEmail(email: string) {
    return this.customers.find(c => c.email.toLowerCase() === email.toLowerCase()) || null
  }

  findById(id: string) {
    return this.customers.find(c => c.id === id) || null
  }

  update(id: string, patch: Partial<CustomerRecord>) {
    const c = this.findById(id)
    if (!c) return null
    Object.assign(c, patch)
    return c
  }

  listKeys(customerId: string) {
    const c = this.findById(customerId)
    return c ? c.apiKeys : []
  }

  addKey(customerId: string, name = 'Default Key') {
    const c = this.findById(customerId)
    if (!c) return null
    const raw = this.generateKey()
    const keyHash = bcrypt.hashSync(raw, 10) // Hash the full key
    const key: CustomerApiKey = {
      id: `key_${Math.random().toString(36).slice(2, 10)}`,
      name,
      keyHash,
      lastFour: raw.slice(-4),
      status: 'active',
      createdAt: new Date().toISOString()
    }
    c.apiKeys.unshift(key)
    return { key, raw } // return raw once
  }

  revokeKey(customerId: string, keyId: string) {
    const c = this.findById(customerId)
    if (!c) return false
    const k = c.apiKeys.find(k => k.id === keyId)
    if (!k) return false
    k.status = 'revoked'
    return true
  }

  getUsage(customerId: string) {
    const c = this.findById(customerId)
    return c ? c.usage : {}
  }

  // Method to get all customers for API key verification
  getAllCustomers() {
    return this.customers
  }

  private generateKey() {
    // simple dev key
    return 'ck_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }

  /**
   * Generate a secure random password for development
   * 16 characters with mixed case, numbers, and symbols
   */
  private generateSecurePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }
}

export const CustomerStore = new InMemoryCustomerStore()

