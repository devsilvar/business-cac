/**
 * Paystack Service
 * 
 * Handles all Paystack API interactions for wallet top-ups.
 * 
 * Flow:
 * 1. Customer initiates top-up → initializeTransaction()
 * 2. Customer pays on Paystack → (redirect/popup)
 * 3. Paystack sends webhook → verifyTransaction()
 * 4. Wallet credited on success
 * 
 * Environment Variables Required:
 * - PAYSTACK_SECRET_KEY: Your Paystack secret key (sk_test_xxx or sk_live_xxx)
 * - PAYSTACK_PUBLIC_KEY: Your Paystack public key (pk_test_xxx or pk_live_xxx)
 * - PAYSTACK_WEBHOOK_SECRET: (Optional) For additional webhook validation
 * - APP_BASE_URL: Your app's base URL for callback redirects
 */

import crypto from 'crypto';

// Paystack API base URL
const PAYSTACK_API_URL = 'https://api.paystack.co';

// Environment config
const getConfig = () => ({
  secretKey: process.env.PAYSTACK_SECRET_KEY || '',
  publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  isConfigured: !!process.env.PAYSTACK_SECRET_KEY
});

// Types
export interface PaystackInitializeParams {
  email: string;
  amount: number;              // Amount in kobo
  reference?: string;          // Custom reference (auto-generated if not provided)
  callbackUrl?: string;        // URL to redirect after payment
  metadata?: {
    customerId: string;
    customerEmail: string;
    transactionType: 'wallet_topup';
    [key: string]: any;
  };
  channels?: ('card' | 'bank' | 'ussd' | 'qr' | 'mobile_money' | 'bank_transfer')[];
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: 'success' | 'failed' | 'abandoned' | 'pending';
    reference: string;
    amount: number;           // Amount in kobo
    message: string | null;
    gateway_response: string;
    paid_at: string | null;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: {
      customerId?: string;
      customerEmail?: string;
      transactionType?: string;
      [key: string]: any;
    } | null;
    customer: {
      id: number;
      email: string;
      customer_code: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    };
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
    } | null;
    fees: number;
    fees_split: any;
    plan: any;
    requested_amount: number;
  };
}

export interface PaystackWebhookEvent {
  event: 'charge.success' | 'charge.failed' | 'transfer.success' | 'transfer.failed' | string;
  data: PaystackVerifyResponse['data'];
}

export class PaystackServiceError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    // Keep message simple - sanitizer will handle user-friendly messaging
    super('Payment service error');
    this.name = 'PaystackServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PaystackService {
  /**
   * Check if Paystack is properly configured
   */
  static isConfigured(): boolean {
    return getConfig().isConfigured;
  }

  /**
   * Get public key (safe to expose to frontend)
   */
  static getPublicKey(): string {
    return getConfig().publicKey;
  }

  /**
   * Generate a unique transaction reference
   */
  static generateReference(prefix: string = 'WLT'): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Initialize a Paystack transaction
   * Returns authorization URL for customer to complete payment
   */
  static async initializeTransaction(params: PaystackInitializeParams): Promise<PaystackInitializeResponse> {
    const config = getConfig();
    
    if (!config.isConfigured) {
      throw new PaystackServiceError(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY environment variable.',
        'PAYSTACK_NOT_CONFIGURED',
        500
      );
    }

    const reference = params.reference || this.generateReference();
    const callbackUrl = params.callbackUrl || `${config.appBaseUrl}/customer/wallet/callback`;

    const payload = {
      email: params.email,
      amount: params.amount,          // Already in kobo
      reference,
      callback_url: callbackUrl,
      metadata: params.metadata || {},
      channels: params.channels || ['card', 'bank', 'ussd', 'bank_transfer']
    };

    try {
      const response = await fetch(`${PAYSTACK_API_URL}/transaction/initialize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json() as PaystackInitializeResponse;

      if (!response.ok || !data.status) {
        throw new PaystackServiceError(
          data.message || 'Failed to initialize Paystack transaction',
          'PAYSTACK_INIT_FAILED',
          response.status
        );
      }

      return data;
    } catch (error: any) {
      if (error instanceof PaystackServiceError) throw error;
      
      throw new PaystackServiceError(
        `Paystack API error: ${error.message}`,
        'PAYSTACK_API_ERROR',
        500
      );
    }
  }

  /**
   * Verify a Paystack transaction by reference
   * Call this after webhook or callback to confirm payment status
   */
  static async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    const config = getConfig();

    if (!config.isConfigured) {
      throw new PaystackServiceError(
        'Paystack is not configured',
        'PAYSTACK_NOT_CONFIGURED',
        500
      );
    }

    try {
      const response = await fetch(`${PAYSTACK_API_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json() as PaystackVerifyResponse;

      if (!response.ok || !data.status) {
        throw new PaystackServiceError(
          data.message || 'Failed to verify transaction',
          'PAYSTACK_VERIFY_FAILED',
          response.status
        );
      }

      return data;
    } catch (error: any) {
      if (error instanceof PaystackServiceError) throw error;

      throw new PaystackServiceError(
        `Paystack verification error: ${error.message}`,
        'PAYSTACK_API_ERROR',
        500
      );
    }
  }

  /**
   * Validate Paystack webhook signature
   * IMPORTANT: Always validate webhooks to prevent fraud
   */
  static validateWebhookSignature(payload: string, signature: string): boolean {
    const config = getConfig();
    
    if (!config.secretKey) {
      console.error('[Paystack] Cannot validate webhook: secret key not configured');
      return false;
    }

    // Paystack signs webhooks with HMAC SHA512 using your secret key
    const expectedSignature = crypto
      .createHmac('sha512', config.secretKey)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Parse and validate webhook event
   */
  static parseWebhookEvent(rawBody: string, signature: string): PaystackWebhookEvent {
    // Validate signature first
    if (!this.validateWebhookSignature(rawBody, signature)) {
      throw new PaystackServiceError(
        'Invalid webhook signature',
        'INVALID_WEBHOOK_SIGNATURE',
        401
      );
    }

    try {
      const event = JSON.parse(rawBody) as PaystackWebhookEvent;
      return event;
    } catch (error) {
      throw new PaystackServiceError(
        'Invalid webhook payload',
        'INVALID_WEBHOOK_PAYLOAD',
        400
      );
    }
  }

  /**
   * Format amount from kobo to Naira display string
   */
  static formatAmount(kobo: number): string {
    const naira = kobo / 100;
    return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Get list of banks (useful for bank transfer payments)
   */
  static async getBanks(country: string = 'nigeria'): Promise<any[]> {
    const config = getConfig();

    if (!config.isConfigured) {
      throw new PaystackServiceError('Paystack is not configured', 'PAYSTACK_NOT_CONFIGURED', 500);
    }

    try {
      const response = await fetch(`${PAYSTACK_API_URL}/bank?country=${country}`, {
        headers: {
          'Authorization': `Bearer ${config.secretKey}`
        }
      });

      const data = await response.json();
      return data.status ? data.data : [];
    } catch (error) {
      console.error('[Paystack] Failed to fetch banks:', error);
      return [];
    }
  }
}
