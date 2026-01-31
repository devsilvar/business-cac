/**
 * QoreID Token Management Service
 * 
 * This service handles automatic token refresh for QoreID API calls.
 * It ensures we always have a valid token without making unnecessary requests.
 * 
 * Usage:
 * - Call getValidQoreIDToken() to get a fresh token
 * - Token is automatically refreshed when expired
 * - Token is cached in database with expiry tracking
 */

import { database } from '../database/index.js';

interface QoreIDTokenData {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

interface StoredQoreIDToken {
  id: string;
  accessToken: string;
  tokenType: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class QoreIDTokenService {
  private static readonly QOREID_TOKEN_URL = 'https://api.qoreid.com/token';
  private static readonly CLIENT_ID = process.env.QOREID_CLIENT_ID || '';
  private static readonly SECRET = process.env.QOREID_SECRET || '';
  private static readonly TOKEN_BUFFER_SECONDS = 300; // Refresh 5 minutes before actual expiry

  /**
   * Get a valid QoreID token (main entry point)
   * This is the function other services should call
   */
  static async getValidQoreIDToken(): Promise<string> {
    try {
      // Check if we have a valid token in database
      const storedToken = await this.getStoredToken();
      
      if (storedToken && !this.isTokenExpired(storedToken)) {
        console.log('[QoreID] Using cached token (expires at:', storedToken.expiresAt.toISOString(), ')');
        return storedToken.accessToken;
      }

      // Token is expired or doesn't exist, get a fresh one
      console.log('[QoreID] Token expired or missing, fetching new token...');
      const newToken = await this.fetchFreshToken();
      await this.storeToken(newToken);
      
      return newToken.accessToken;
    } catch (error: any) {
      console.error('[QoreID] Error getting valid token:', error.message);
      const err = new Error('QoreID service error');
      err.name = 'QoreIdServiceError';
      throw err;
    }
  }

  /**
   * Force refresh token (bypass cache)
   */
  static async refreshToken(): Promise<string> {
    try {
      console.log('[QoreID] Force refreshing token...');
      const newToken = await this.fetchFreshToken();
      await this.storeToken(newToken);
      return newToken.accessToken;
    } catch (error: any) {
      console.error('[QoreID] Error refreshing token:', error.message);
      const err = new Error('QoreID service error');
      err.name = 'QoreIdServiceError';
      throw err;
    }
  }

  /**
   * Get token info (for debugging/monitoring)
   */
  static async getTokenInfo(): Promise<{ hasToken: boolean; expiresAt?: Date; isExpired?: boolean }> {
    try {
      const storedToken = await this.getStoredToken();
      
      if (!storedToken) {
        return { hasToken: false };
      }

      return {
        hasToken: true,
        expiresAt: storedToken.expiresAt,
        isExpired: this.isTokenExpired(storedToken)
      };
    } catch (error) {
      return { hasToken: false };
    }
  }

  /**
   * Private Methods
   */

  /**
   * Fetch fresh token from QoreID API
   */
  private static async fetchFreshToken(): Promise<QoreIDTokenData> {
    if (!this.CLIENT_ID || !this.SECRET) {
      const err = new Error('QoreID not configured');
      err.name = 'QoreIdNotConfiguredError';
      throw err;
    }

    const requestBody = {
      clientId: this.CLIENT_ID,
      secret: this.SECRET
    };

    console.log('[QoreID] ===== REQUESTING NEW TOKEN =====');
    console.log('[QoreID] URL:', this.QOREID_TOKEN_URL);
    console.log('[QoreID] Method: POST');
    console.log('[QoreID] ClientId:', this.CLIENT_ID);
    console.log('[QoreID] Secret:', this.SECRET.substring(0, 10) + '...');
    console.log('[QoreID] Request Body:', JSON.stringify(requestBody));

    try {
      const response = await fetch(this.QOREID_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'text/plain',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('[QoreID] Response Status:', response.status, response.statusText);
      console.log('[QoreID] Response Headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[QoreID] Error Response Body:', errorText);
        console.error('[QoreID] Token request failed with status:', response.status);
        
        // Try to parse error as JSON
        try {
          const errorJson = JSON.parse(errorText);
          console.error('[QoreID] Parsed error:', errorJson);
        } catch (e) {
          console.error('[QoreID] Error is not JSON, raw text:', errorText);
        }
        
        const err = new Error('QoreID authentication failed');
        err.name = 'QoreIdAuthError';
        throw err;
      }

      const responseText = await response.text();
      console.log('[QoreID] Response Body:', responseText);

      const tokenData: QoreIDTokenData = JSON.parse(responseText);

      // Validate response
      if (!tokenData.accessToken) {
        console.error('[QoreID] Invalid response - no accessToken:', tokenData);
        const err = new Error('QoreID service error');
        err.name = 'QoreIdServiceError';
        throw err;
      }

      console.log('[QoreID] ✅ New token received successfully');
      console.log('[QoreID] Token expires in:', tokenData.expiresIn, 'seconds');
      console.log('[QoreID] Token type:', tokenData.tokenType);
      console.log('[QoreID] ================================');
      
      return tokenData;
      
    } catch (error: any) {
      console.error('[QoreID] ===== FETCH ERROR =====');
      console.error('[QoreID] Error type:', error.constructor.name);
      console.error('[QoreID] Error message:', error.message);
      console.error('[QoreID] Error stack:', error.stack);
      console.error('[QoreID] =========================');
      throw error;
    }
  }

  /**
   * Store token in database
   */
  private static async storeToken(tokenData: QoreIDTokenData): Promise<void> {
    const expiresAt = new Date(Date.now() + (tokenData.expiresIn * 1000));
    const now = new Date();

    const tokenRecord: Omit<StoredQoreIDToken, 'id'> = {
      accessToken: tokenData.accessToken,
      tokenType: tokenData.tokenType || 'Bearer',
      expiresAt,
      createdAt: now,
      updatedAt: now
    };

    // Try to update existing token first, then create if none exists
    try {
      await database.updateQoreIDToken(tokenRecord);
      console.log('[QoreID] Token updated in database, expires at:', expiresAt.toISOString());
    } catch (error) {
      await database.createQoreIDToken(tokenRecord);
      console.log('[QoreID] Token created in database, expires at:', expiresAt.toISOString());
    }
  }

  /**
   * Get stored token from database
   */
  private static async getStoredToken(): Promise<StoredQoreIDToken | null> {
    try {
      return await database.getQoreIDToken();
    } catch (error) {
      console.log('[QoreID] No stored token found or database error');
      return null;
    }
  }

  /**
   * Check if token is expired (with buffer)
   */
  private static isTokenExpired(token: StoredQoreIDToken): boolean {
    const now = new Date();
    const expiryWithBuffer = new Date(token.expiresAt.getTime() - (this.TOKEN_BUFFER_SECONDS * 1000));
    return now >= expiryWithBuffer;
  }

  /**
   * Validate configuration
   */
  static validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.CLIENT_ID) {
      errors.push('QOREID_CLIENT_ID is required');
    }

    if (!this.SECRET) {
      errors.push('QOREID_SECRET is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Auto-refresh token every hour (background process)
if (process.env.NODE_ENV !== 'test') {
  setInterval(async () => {
    try {
      const tokenInfo = await QoreIDTokenService.getTokenInfo();
      if (tokenInfo.hasToken && tokenInfo.isExpired) {
        console.log('[QoreID] Auto-refreshing expired token...');
        await QoreIDTokenService.refreshToken();
      }
    } catch (error) {
      console.error('[QoreID] Auto-refresh failed:', error);
    }
  }, 60 * 60 * 1000); // Check every hour
}