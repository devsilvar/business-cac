/**
 * Wallet Service
 * Handles all wallet operations: balance checks, credits, debits, transactions
 * All amounts are in kobo (100 kobo = ₦1)
 */

import { 
  database, 
  Customer, 
  WalletTransaction, 
  WalletTransactionData, 
  WalletTransactionType,
  WalletTransactionStatus,
  PaymentMethod,
  ListOptions 
} from '../database/index.js';
import { PricingService } from './pricing.service.js';

// Custom error classes for wallet operations
export class InsufficientBalanceError extends Error {
  public readonly requiredAmount: number;
  public readonly currentBalance: number;
  public readonly shortfall: number;

  constructor(requiredAmount: number, currentBalance: number) {
    const shortfall = requiredAmount - currentBalance;
    // Internal message for logging - sanitizer will replace with user-friendly message
    super(`Insufficient wallet balance for transaction`);
    this.name = 'InsufficientBalanceError';
    this.requiredAmount = requiredAmount;
    this.currentBalance = currentBalance;
    this.shortfall = shortfall;
  }
}

export class WalletNotFoundError extends Error {
  public readonly customerId: string;

  constructor(customerId: string) {
    // Internal message - sanitizer will replace with user-friendly message
    super(`Wallet not found`);
    this.name = 'WalletNotFoundError';
    this.customerId = customerId;
  }
}

export class DuplicateTransactionError extends Error {
  public readonly reference: string;

  constructor(reference: string) {
    // Internal message - sanitizer will replace with user-friendly message
    super(`Duplicate transaction detected`);
    this.name = 'DuplicateTransactionError';
    this.reference = reference;
  }
}

// Response types
export interface WalletBalance {
  customerId: string;
  balanceKobo: number;
  balanceNaira: number;
  formattedBalance: string;
}

export interface DebitResult {
  success: boolean;
  transaction: WalletTransaction;
  newBalance: WalletBalance;
}

export interface CreditResult {
  success: boolean;
  transaction: WalletTransaction;
  newBalance: WalletBalance;
}

export interface TransactionHistory {
  transactions: WalletTransaction[];
  total: number;
  summary: {
    totalCredits: number;
    totalDebits: number;
    netChange: number;
  };
}

export class WalletService {
  /**
   * Generate a unique transaction reference
   */
  private static generateReference(type: WalletTransactionType, prefix?: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    const typePrefix = type === 'credit' ? 'CR' : 'DR';
    return `${prefix || 'TXN'}_${typePrefix}_${timestamp}_${random}`.toUpperCase();
  }

  /**
   * Format balance for response
   */
  private static formatBalance(customerId: string, balanceKobo: number): WalletBalance {
    return {
      customerId,
      balanceKobo,
      balanceNaira: balanceKobo / 100,
      formattedBalance: PricingService.formatPrice(balanceKobo)
    };
  }

  /**
   * Get customer's wallet balance
   */
  static async getBalance(customerId: string): Promise<WalletBalance> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      throw new WalletNotFoundError(customerId);
    }

    return this.formatBalance(customerId, customer.walletBalance);
  }

  /**
   * Check if customer has sufficient balance for an amount
   */
  static async hasSufficientBalance(customerId: string, amountKobo: number): Promise<boolean> {
    const balance = await this.getBalance(customerId);
    return balance.balanceKobo >= amountKobo;
  }

  /**
   * Check balance for a specific service
   */
  static async canAffordService(customerId: string, serviceCode: string): Promise<{
    canAfford: boolean;
    balance: WalletBalance;
    serviceCost: number;
    shortfall: number;
  }> {
    const [balance, serviceCost] = await Promise.all([
      this.getBalance(customerId),
      PricingService.getPriceKobo(serviceCode)
    ]);

    const canAfford = balance.balanceKobo >= serviceCost;
    const shortfall = canAfford ? 0 : serviceCost - balance.balanceKobo;

    return {
      canAfford,
      balance,
      serviceCost,
      shortfall
    };
  }

  /**
   * Debit customer wallet (for API calls)
   * This is the main method called by the wallet middleware after successful API response
   */
  static async debit(
    customerId: string,
    amountKobo: number,
    description: string,
    options: {
      reference?: string;
      serviceCode?: string;
      usageRecordId?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<DebitResult> {
    // Get current customer and balance
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      throw new WalletNotFoundError(customerId);
    }

    const balanceBefore = customer.walletBalance;

    // Check sufficient balance
    if (balanceBefore < amountKobo) {
      throw new InsufficientBalanceError(amountKobo, balanceBefore);
    }

    // Generate reference if not provided
    const reference = options.reference || this.generateReference('debit', options.serviceCode);

    // Check for duplicate transaction
    const existingTxn = await database.getWalletTransactionByReference(reference);
    if (existingTxn) {
      throw new DuplicateTransactionError(reference);
    }

    // Calculate new balance
    const balanceAfter = balanceBefore - amountKobo;

    // Create transaction record
    const transactionData: WalletTransactionData = {
      customerId,
      type: 'debit',
      amount: amountKobo,
      balanceBefore,
      balanceAfter,
      description,
      reference,
      usageRecordId: options.usageRecordId,
      paymentMethod: 'api_charge',
      status: 'completed',
      metadata: options.metadata
    };

    // Execute in sequence: create transaction, then update balance
    const transaction = await database.createWalletTransaction(transactionData);
    await database.updateCustomer(customerId, { walletBalance: balanceAfter });

    return {
      success: true,
      transaction,
      newBalance: this.formatBalance(customerId, balanceAfter)
    };
  }

  /**
   * Credit customer wallet (for top-ups, refunds, admin adjustments)
   */
  static async credit(
    customerId: string,
    amountKobo: number,
    description: string,
    options: {
      reference?: string;
      paymentMethod?: PaymentMethod;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<CreditResult> {
    // Get current customer and balance
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      throw new WalletNotFoundError(customerId);
    }

    const balanceBefore = customer.walletBalance;

    // Generate reference if not provided
    const reference = options.reference || this.generateReference('credit');

    // Check for duplicate transaction
    const existingTxn = await database.getWalletTransactionByReference(reference);
    if (existingTxn) {
      throw new DuplicateTransactionError(reference);
    }

    // Calculate new balance
    const balanceAfter = balanceBefore + amountKobo;

    // Create transaction record
    const transactionData: WalletTransactionData = {
      customerId,
      type: 'credit',
      amount: amountKobo,
      balanceBefore,
      balanceAfter,
      description,
      reference,
      paymentMethod: options.paymentMethod || 'card',
      status: 'completed',
      metadata: options.metadata
    };

    // Execute in sequence: create transaction, then update balance
    const transaction = await database.createWalletTransaction(transactionData);
    await database.updateCustomer(customerId, { walletBalance: balanceAfter });

    return {
      success: true,
      transaction,
      newBalance: this.formatBalance(customerId, balanceAfter)
    };
  }

  /**
   * Refund a previous debit transaction
   */
  static async refund(
    originalTransactionId: string,
    reason: string
  ): Promise<CreditResult> {
    // Get original transaction
    const originalTxn = await database.getWalletTransaction(originalTransactionId);
    if (!originalTxn) {
      const error = new Error('Transaction not found');
      error.name = 'TransactionNotFoundError';
      throw error;
    }

    if (originalTxn.type !== 'debit') {
      const error = new Error('Invalid transaction type for refund');
      error.name = 'InvalidTransactionError';
      throw error;
    }

    if (originalTxn.status === 'reversed') {
      const error = new Error('Transaction already refunded');
      error.name = 'DuplicateRefundError';
      throw error;
    }

    // Credit the customer
    const result = await this.credit(
      originalTxn.customerId,
      originalTxn.amount,
      `Refund: ${reason}`,
      {
        paymentMethod: 'refund',
        metadata: {
          originalTransactionId,
          refundReason: reason
        }
      }
    );

    // Mark original transaction as reversed
    await database.updateWalletTransactionStatus(originalTransactionId, 'reversed');

    return result;
  }

  /**
   * Admin credit (manual adjustment by admin)
   */
  static async adminCredit(
    customerId: string,
    amountKobo: number,
    reason: string,
    adminId: string
  ): Promise<CreditResult> {
    return this.credit(
      customerId,
      amountKobo,
      `Admin Credit: ${reason}`,
      {
        paymentMethod: 'admin',
        metadata: {
          adminId,
          reason,
          adjustmentType: 'credit'
        }
      }
    );
  }

  /**
   * Admin debit (manual adjustment by admin - use with caution)
   */
  static async adminDebit(
    customerId: string,
    amountKobo: number,
    reason: string,
    adminId: string
  ): Promise<DebitResult> {
    return this.debit(
      customerId,
      amountKobo,
      `Admin Debit: ${reason}`,
      {
        metadata: {
          adminId,
          reason,
          adjustmentType: 'debit'
        }
      }
    );
  }

  /**
   * Get transaction history for a customer
   */
  static async getTransactionHistory(
    customerId: string,
    options: ListOptions = {}
  ): Promise<TransactionHistory> {
    const { transactions, total } = await database.listWalletTransactions(customerId, options);

    // Calculate summary
    let totalCredits = 0;
    let totalDebits = 0;

    for (const txn of transactions) {
      if (txn.type === 'credit' && txn.status === 'completed') {
        totalCredits += txn.amount;
      } else if (txn.type === 'debit' && txn.status === 'completed') {
        totalDebits += txn.amount;
      }
    }

    return {
      transactions,
      total,
      summary: {
        totalCredits,
        totalDebits,
        netChange: totalCredits - totalDebits
      }
    };
  }

  /**
   * Get a single transaction by ID
   */
  static async getTransaction(transactionId: string): Promise<WalletTransaction | null> {
    return database.getWalletTransaction(transactionId);
  }

  /**
   * Get transaction by reference
   */
  static async getTransactionByReference(reference: string): Promise<WalletTransaction | null> {
    return database.getWalletTransactionByReference(reference);
  }

  /**
   * Reserve balance for a pending operation (creates pending transaction)
   * Useful for long-running operations where you want to reserve funds first
   */
  static async reserveBalance(
    customerId: string,
    amountKobo: number,
    description: string,
    serviceCode?: string
  ): Promise<WalletTransaction> {
    const customer = await database.getCustomer(customerId);
    if (!customer) {
      throw new WalletNotFoundError(customerId);
    }

    if (customer.walletBalance < amountKobo) {
      throw new InsufficientBalanceError(amountKobo, customer.walletBalance);
    }

    const reference = this.generateReference('debit', serviceCode);
    const balanceBefore = customer.walletBalance;
    const balanceAfter = balanceBefore - amountKobo;

    // Create pending transaction (balance not yet deducted)
    const transaction = await database.createWalletTransaction({
      customerId,
      type: 'debit',
      amount: amountKobo,
      balanceBefore,
      balanceAfter,
      description,
      reference,
      paymentMethod: 'api_charge',
      status: 'pending'
    });

    return transaction;
  }

  /**
   * Complete a pending reservation
   */
  static async completeReservation(transactionId: string): Promise<DebitResult> {
    const transaction = await database.getWalletTransaction(transactionId);
    if (!transaction) {
      const error = new Error('Transaction not found');
      error.name = 'TransactionNotFoundError';
      throw error;
    }

    if (transaction.status !== 'pending') {
      const error = new Error('Transaction is not in pending status');
      error.name = 'InvalidTransactionStatusError';
      throw error;
    }

    // Update customer balance
    await database.updateCustomer(transaction.customerId, { 
      walletBalance: transaction.balanceAfter 
    });

    // Mark transaction as completed
    const completedTxn = await database.updateWalletTransactionStatus(
      transactionId, 
      'completed', 
      new Date()
    );

    return {
      success: true,
      transaction: completedTxn,
      newBalance: this.formatBalance(transaction.customerId, transaction.balanceAfter)
    };
  }

  /**
   * Cancel a pending reservation
   */
  static async cancelReservation(transactionId: string): Promise<void> {
    const transaction = await database.getWalletTransaction(transactionId);
    if (!transaction) {
      const error = new Error('Transaction not found');
      error.name = 'TransactionNotFoundError';
      throw error;
    }

    if (transaction.status !== 'pending') {
      const error = new Error('Transaction is not in pending status');
      error.name = 'InvalidTransactionStatusError';
      throw error;
    }

    // Mark transaction as failed (balance was never deducted)
    await database.updateWalletTransactionStatus(transactionId, 'failed');
  }
}
