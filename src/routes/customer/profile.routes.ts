import { Router, type Request, type Response } from 'express';
import { authenticateCustomerJWT } from '../../middleware/customerJwt.middleware.js';
import { CustomerService } from '../../services/customer.service.js';
import { database } from '../../database/index.js';
import { http } from '../../utils/error.util.js';

/**
 * ===================================================================
 * CUSTOMER PROFILE ROUTES
 * ===================================================================
 * Handles customer profile retrieval and management.
 * 
 * Authentication: JWT Token (from login)
 * 
 * The customer must be logged in (JWT token required) to access their profile.
 * This is different from API key authentication used for business operations.
 * 
 * JWT Token Flow:
 * 1. Customer logs in → receives JWT token
 * 2. Customer includes JWT in portal requests: Authorization: Bearer <jwt_token>
 * 3. This middleware validates JWT and attaches customer to request
 * 4. Route handlers access customer via req.customer
 */

/**
 * Registers customer profile routes.
 * 
 * Routes:
 * - GET /customer/me - Get current customer's profile
 */
export function registerProfileRoutes(router: Router) {
  /**
   * GET /customer/me
   * 
   * Retrieve the authenticated customer's profile information.
   * 
   * Authentication: JWT Bearer token required
   * 
   * Response:
   * - Customer profile (id, email, company, plan, status, created date)
   * 
   * Used by: Customer portal dashboard to display user info
   */
  router.get('/me', authenticateCustomerJWT, async (req: Request, res: Response) => {
    try {
      // Customer JWT payload is attached to request by authenticateCustomerJWT middleware
      const jwt = (req as any).customerJwt;
      
      if (!jwt || !jwt.customerId) {
        return http.unauthorized(res, 'AUTHENTICATION_REQUIRED', 'Please login to access your profile', undefined, req);
      }
      
      // Fetch customer details from DATABASE (not in-memory store)
      const customer = await database.getCustomer(jwt.customerId);
      
      if (!customer) {
        return http.unauthorized(res, 'CUSTOMER_NOT_FOUND', 'Customer account not found', undefined, req);
      }
      
      // Return customer profile (password hash excluded)
      return http.ok(res, {
        id: customer.id,
        email: customer.email,
        company: customer.company || null,
        fullName: customer.full_name || null,
        phoneNumber: customer.phone_number || null,
        walletBalance: customer.walletBalance || 0,
        status: customer.status || 'active',
        verificationStatus: customer.verificationStatus || 'inactive',
        createdAt: customer.createdAt || new Date().toISOString(),
      }, req);
    } catch (e: any) {
      console.error('[Customer Profile] Error fetching profile:', e.message);
      return http.serverError(res, 'PROFILE_FETCH_FAILED', 'Failed to retrieve profile', undefined, req);
    }
  });

  /**
   * PUT /customer/me
   * 
   * Update the authenticated customer's profile information.
   * 
   * Allowed updates (customer-managed):
   * - company
   * - full_name
   * - phone_number
   */
  router.put('/me', authenticateCustomerJWT, async (req: Request, res: Response) => {
    try {
      const jwt = (req as any).customerJwt;
      if (!jwt || !jwt.customerId) {
        return http.unauthorized(res, 'AUTHENTICATION_REQUIRED', 'Please login to update your profile', undefined, req);
      }

      const existing = await database.getCustomer(jwt.customerId);
      if (!existing) {
        return http.unauthorized(res, 'CUSTOMER_NOT_FOUND', 'Customer account not found', undefined, req);
      }

      const { company, fullName, phoneNumber } = req.body || {};

      // Validate company (optional)
      let companyValue: string | undefined = undefined;
      if (company !== undefined) {
        const c = String(company).trim();
        if (c.length > 0 && c.length < 2) {
          return http.badRequest(res, 'INVALID_COMPANY', 'Company name must be at least 2 characters', undefined, req);
        }
        if (c.length > 120) {
          return http.badRequest(res, 'INVALID_COMPANY', 'Company name must be 120 characters or less', undefined, req);
        }
        companyValue = c.length ? c : undefined;
      }

      // Validate fullName (optional)
      let fullNameValue: string | undefined = undefined;
      if (fullName !== undefined) {
        const c = String(fullName).trim();
        if (c.length > 0 && c.length < 2) {
          return http.badRequest(res, 'INVALID_NAME', 'Full name must be at least 2 characters', undefined, req);
        }
        if (c.length > 120) {
          return http.badRequest(res, 'INVALID_NAME', 'Full name must be 120 characters or less', undefined, req);
        }
        fullNameValue = c.length ? c : undefined;
      }

      // Validate phone number (optional)
      let phoneValue: string | undefined = undefined;
      if (phoneNumber !== undefined) {
        const raw = String(phoneNumber).replace(/\s+/g, '');
        if (raw.length === 0) {
          phoneValue = undefined;
        } else {
          const phonePattern = /^(\+234|0)?[789]\d{9}$/;
          if (!phonePattern.test(raw)) {
            return http.badRequest(res, 'INVALID_PHONE', 'Please provide a valid Nigerian phone number (e.g., 08012345678 or +2348012345678)', undefined, req);
          }
          phoneValue = raw;
        }
      }

      // Build update object with correct field names
      const updates: any = {};
      if (company !== undefined) updates.company = companyValue;
      if (fullName !== undefined) updates.full_name = fullNameValue;
      if (phoneNumber !== undefined) updates.phone_number = phoneValue;

      // Update customer in database
      const updated = await database.updateCustomer(jwt.customerId, updates);

      if (!updated) {
        return http.serverError(res, 'PROFILE_UPDATE_FAILED', 'Failed to update profile', undefined, req);
      }

      return http.ok(res, {
        id: updated.id,
        email: updated.email,
        company: updated.company || null,
        fullName: updated.full_name || null,
        phoneNumber: updated.phone_number || null,
        walletBalance: updated.walletBalance || 0,
        status: updated.status || 'active',
        verificationStatus: updated.verificationStatus || 'inactive',
        createdAt: updated.createdAt || new Date().toISOString(),
      }, req);
    } catch (e: any) {
      console.error('[Customer Profile] Error updating profile:', e.message);
      return http.serverError(res, 'PROFILE_UPDATE_FAILED', e?.message || 'Failed to update profile', undefined, req);
    }
  });
}


