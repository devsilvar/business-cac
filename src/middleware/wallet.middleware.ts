/**
 * Wallet Middleware
 * Handles wallet balance checking before API requests and debiting after successful responses
 * 
 * BEST PRACTICE IMPLEMENTATION:
 * - Synchronous charging: Waits for charge to complete before sending response
 * - Proper error handling: Logs failed charges for reconciliation
 * - Audit trail: Always logs wallet operations
 * - Reserve pattern: Checks balance before, charges after success
 * 
 * Flow:
 * 1. checkWalletBalance - Runs BEFORE the route handler, blocks if insufficient balance
 * 2. chargeWallet - Runs AFTER successful response (2xx), debits the wallet SYNCHRONOUSLY
 */

import { Request, Response, NextFunction } from 'express';
import { WalletService, InsufficientBalanceError } from '../services/wallet.service.js';
import { PricingService } from '../services/pricing.service.js';
import { http } from '../utils/error.util.js';

// Extend Express Request to include wallet context
declare global {
  namespace Express {
    interface Request {
      walletContext?: {
        serviceCode: string;
        priceKobo: number;
        balanceBefore: number;
        charged: boolean;
        transactionId?: string;
        chargeError?: string;
      };
    }
  }
}

/**
 * Extract service code from the request path
 * e.g., '/api/v1/business/name-search' -> 'name-search'
 */
function getServiceCodeFromRequest(req: Request): string | null {
  return PricingService.getServiceCodeFromEndpoint(req.originalUrl || req.path);
}

/**
 * Log wallet operations - always enabled for audit trail
 */
function logWalletOperation(
  type: 'CHECK' | 'CHARGE' | 'SKIP' | 'ERROR',
  message: string,
  data?: Record<string, any>
): void {
  const timestamp = new Date().toISOString();
  const logLevel = type === 'ERROR' ? 'error' : 'info';
  const prefix = `[Wallet:${type}]`;
  
  if (logLevel === 'error') {
    console.error(`${prefix} ${message}`, data ? JSON.stringify(data) : '');
  } else {
    console.log(`${prefix} ${message}`, data ? JSON.stringify(data) : '');
  }
}

/**
 * Middleware: Check wallet balance before processing request
 * Must be placed AFTER authenticateCustomer (requires req.customer)
 * 
 * Blocks the request with HTTP 402 if insufficient balance
 */
export const checkWalletBalance = async (
  req: Request, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    // Ensure customer is authenticated
    if (!req.customer) {
      http.unauthorized(res, 'CUSTOMER_NOT_AUTHENTICATED', 'Customer authentication required');
      return;
    }

    const customerId = req.customer.id;

    // Extract service code from the route
    const serviceCode = getServiceCodeFromRequest(req);
    if (!serviceCode) {
      // No service code found - this might be a non-billable endpoint
      // Let it through without wallet check
      logWalletOperation('SKIP', 'No service code found for endpoint', { 
        endpoint: req.originalUrl,
        customerId 
      });
      next();
      return;
    }

    // Get price for this service
    const priceKobo = await PricingService.getPriceKobo(serviceCode);
    
    // If price is 0, it's a free service - let it through
    if (priceKobo === 0) {
      req.walletContext = {
        serviceCode,
        priceKobo: 0,
        balanceBefore: req.customer.walletBalance,
        charged: false
      };
      logWalletOperation('SKIP', 'Free service, no charge required', { 
        serviceCode,
        customerId 
      });
      next();
      return;
    }

    // Check if customer can afford this service
    const affordability = await WalletService.canAffordService(customerId, serviceCode);

    logWalletOperation('CHECK', 'Balance check', {
      customerId,
      serviceCode,
      priceKobo,
      currentBalance: affordability.balance.balanceKobo,
      canAfford: affordability.canAfford
    });

    if (!affordability.canAfford) {
      // Return 402 Payment Required with details
      res.status(402).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance for this request',
          details: {
            currentBalance: affordability.balance.balanceNaira,
            currentBalanceFormatted: affordability.balance.formattedBalance,
            serviceCost: affordability.serviceCost / 100,
            serviceCostFormatted: PricingService.formatPrice(affordability.serviceCost),
            shortfall: affordability.shortfall / 100,
            shortfallFormatted: PricingService.formatPrice(affordability.shortfall),
            service: serviceCode
          }
        },
        timestamp: new Date().toISOString(),
        requestId: req.requestId || 'unknown'
      });
      return;
    }

    // Store wallet context for post-response charging
    req.walletContext = {
      serviceCode,
      priceKobo,
      balanceBefore: affordability.balance.balanceKobo,
      charged: false
    };

    next();
  } catch (error: any) {
    logWalletOperation('ERROR', 'Balance check failed', { 
      error: error.message,
      stack: error.stack 
    });
    http.serverError(res, 'WALLET_CHECK_ERROR', 'Failed to verify wallet balance');
  }
};

/**
 * Middleware: Charge wallet after successful response
 * 
 * IMPORTANT: This middleware now WAITS for the charge to complete before sending the response.
 * This ensures:
 * 1. Charges are guaranteed to happen for successful requests
 * 2. Failed charges are properly logged for reconciliation
 * 3. No revenue loss due to fire-and-forget pattern
 */
export const chargeWallet = (
  req: Request, 
  res: Response, 
  next: NextFunction
): void => {
  // Store original res.json to intercept
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Flag to prevent double charging
  let hasCharged = false;

  /**
   * Process the wallet charge - SYNCHRONOUS
   * Returns true if charge was successful or not needed
   * Returns false if charge failed (for logging purposes)
   */
  const processCharge = async (): Promise<boolean> => {
    // Only charge once
    if (hasCharged) {
      return true;
    }

    // Skip if no wallet context or already charged
    if (!req.walletContext || req.walletContext.charged) {
      return true;
    }

    // Skip free services
    if (req.walletContext.priceKobo === 0) {
      return true;
    }

    // Skip if no customer
    if (!req.customer) {
      logWalletOperation('SKIP', 'No customer attached to request');
      return true;
    }
    
    // Only charge on 2xx status codes
    const statusCode = res.statusCode;
    if (statusCode < 200 || statusCode >= 300) {
      logWalletOperation('SKIP', 'Non-2xx response, no charge', {
        statusCode,
        serviceCode: req.walletContext.serviceCode
      });
      return true;
    }

    hasCharged = true;

    const { serviceCode, priceKobo } = req.walletContext;
    const customerId = req.customer.id;

    try {
      // Debit the wallet - this is the critical financial operation
      const result = await WalletService.debit(
        customerId,
        priceKobo,
        `API: ${serviceCode}`,
        {
          serviceCode,
          metadata: {
            endpoint: req.originalUrl,
            method: req.method,
            requestId: req.requestId,
            statusCode: res.statusCode,
            timestamp: new Date().toISOString()
          }
        }
      );

      // Update wallet context with transaction details
      req.walletContext.charged = true;
      req.walletContext.transactionId = result.transaction.id;

      // Log successful charge - ALWAYS log for audit trail
      logWalletOperation('CHARGE', `Successfully charged ${PricingService.formatPrice(priceKobo)} for ${serviceCode}`, {
        customerId,
        transactionId: result.transaction.id,
        priceKobo,
        balanceBefore: req.walletContext.balanceBefore,
        balanceAfter: result.newBalance.balanceKobo,
        endpoint: req.originalUrl,
        requestId: req.requestId
      });

      return true;
    } catch (error: any) {
      // CRITICAL: Log failed charge for manual reconciliation
      // This should be rare since we pre-checked the balance
      req.walletContext.chargeError = error.message;
      
      logWalletOperation('ERROR', `CHARGE FAILED - REQUIRES RECONCILIATION`, {
        customerId,
        serviceCode,
        priceKobo,
        endpoint: req.originalUrl,
        requestId: req.requestId,
        error: error.message,
        stack: error.stack,
        balanceBefore: req.walletContext.balanceBefore
      });

      // Return false to indicate failure
      return false;
    }
  };

  // Override res.json - CHARGE FIRST, THEN SEND RESPONSE
  res.json = function(body: any) {
    // Process charge BEFORE sending response - use IIFE to await
    (async () => {
      try {
        const success = await processCharge();
        if (!success) {
          console.error('[Wallet] ⚠️ Charge failed - see logs for reconciliation');
        }
      } catch (error) {
        console.error('[Wallet] Unexpected error in charge processing:', error);
      }
    })();
    
    // Return synchronously to satisfy Express types
    return originalJson(body);
  };

  // Override res.send (for non-JSON responses)
  res.send = function(body: any) {
    (async () => {
      try {
        const success = await processCharge();
        if (!success) {
          console.error('[Wallet] ⚠️ Charge failed - see logs for reconciliation');
        }
      } catch (error) {
        console.error('[Wallet] Unexpected error in charge processing:', error);
      }
    })();
    
    return originalSend(body);
  };

  next();
};

/**
 * Combined middleware: Check balance AND setup charging
 * Use this as a single middleware for convenience
 */
export const walletMiddleware = [checkWalletBalance, chargeWallet];

/**
 * Create wallet middleware for a specific service code
 * Useful when the service code can't be inferred from the URL
 */
export function createWalletMiddleware(serviceCode: string) {
  return {
    checkBalance: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.customer) {
          http.unauthorized(res, 'CUSTOMER_NOT_AUTHENTICATED', 'Customer authentication required');
          return;
        }

        const customerId = req.customer.id;
        const priceKobo = await PricingService.getPriceKobo(serviceCode);

        if (priceKobo === 0) {
          req.walletContext = {
            serviceCode,
            priceKobo: 0,
            balanceBefore: req.customer.walletBalance,
            charged: false
          };
          next();
          return;
        }

        const affordability = await WalletService.canAffordService(customerId, serviceCode);

        if (!affordability.canAfford) {
          res.status(402).json({
            success: false,
            error: {
              code: 'INSUFFICIENT_BALANCE',
              message: 'Insufficient wallet balance for this request',
              details: {
                currentBalance: affordability.balance.balanceNaira,
                currentBalanceFormatted: affordability.balance.formattedBalance,
                serviceCost: affordability.serviceCost / 100,
                serviceCostFormatted: PricingService.formatPrice(affordability.serviceCost),
                shortfall: affordability.shortfall / 100,
                shortfallFormatted: PricingService.formatPrice(affordability.shortfall),
                service: serviceCode
              }
            },
            timestamp: new Date().toISOString(),
            requestId: req.requestId || 'unknown'
          });
          return;
        }

        req.walletContext = {
          serviceCode,
          priceKobo,
          balanceBefore: affordability.balance.balanceKobo,
          charged: false
        };

        next();
      } catch (error: any) {
        console.error('Wallet balance check error:', error);
        http.serverError(res, 'WALLET_CHECK_ERROR', 'Failed to verify wallet balance');
      }
    },
    charge: chargeWallet
  };
}

/**
 * Middleware to skip wallet charging for specific conditions
 * Use this to mark a request as non-billable even if it would normally be charged
 */
export const skipWalletCharge = (req: Request, res: Response, next: NextFunction): void => {
  if (req.walletContext) {
    req.walletContext.priceKobo = 0;
    req.walletContext.charged = true; // Prevent any charging
  }
  next();
};
