import { Router, Request, Response } from 'express';
import { requireAdminAuth, requireAdminPermission } from '../../middleware/admin.middleware.js';
import { http } from '../../utils/error.util.js';
import { database } from '../../database/index.js';
import { verificationStorage } from '../../services/verificationStorage.service.js';
import fs from 'fs';

const router = Router();

/**
 * GET /api/v1/admin/verification/queue
 * List pending verifications (status = 'admin_review')
 * These are customers whose CAC has been verified and are awaiting admin approval
 */
router.get(
  '/verification/queue',
  requireAdminAuth,
  requireAdminPermission('view_verification_requests'),
  async (req: Request, res: Response) => {
    try {
      const { customers } = await database.listCustomers({});
      const pending = customers
        .filter((c: any) => (c.verificationStatus || 'verified') === 'admin_review')
        .sort((a: any, b: any) => {
          // Sort by oldest first (FIFO)
          const at = new Date(a.verificationData?.submittedAt || 0).getTime();
          const bt = new Date(b.verificationData?.submittedAt || 0).getTime();
          return at - bt;
        })
        .map((c: any) => ({
          id: c.id,
          email: c.email,
          company: c.company,
          submittedAt: c.verificationData?.submittedAt,
          businessInfo: {
            rcNumber: c.verificationData?.businessInfo?.rcNumber,
            companyName: c.verificationData?.businessInfo?.companyName
          },
          cacVerification: {
            verified: c.verificationData?.cacVerification?.verified,
            qoreidCompanyName: c.verificationData?.cacVerification?.qoreidCompanyName,
            qoreidStatus: c.verificationData?.cacVerification?.qoreidStatus,
            nameMatch: c.verificationData?.cacVerification?.nameMatch
          }
        }));

      return http.ok(res, { 
        customers: pending,
        total: pending.length 
      }, req);
    } catch (error) {
      console.error('Verification queue error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to load verification queue', undefined, req);
    }
  }
);

/**
 * GET /api/v1/admin/verification/list
 * List verifications by status.
 * Query: ?status=admin_review|verified|rejected|cac_pending|inactive|all
 * NOTE: Must be defined before /verification/:customerId
 */
router.get(
  '/verification/list',
  requireAdminAuth,
  requireAdminPermission('view_verification_requests'),
  async (req: Request, res: Response) => {
    try {
      const status = String(req.query.status || 'all');
      const allowed = new Set(['admin_review', 'verified', 'rejected', 'cac_pending', 'inactive', 'all']);
      if (!allowed.has(status)) {
        return http.badRequest(res, 'VALIDATION_ERROR', 'Invalid status filter', { allowed: Array.from(allowed) }, req);
      }

      const { customers } = await database.listCustomers({});
      const filtered = customers
        .filter((c: any) => {
          const s = c.verificationStatus || 'verified';
          return status === 'all' ? s !== undefined : s === status;
        })
        .sort((a: any, b: any) => {
          const at = new Date(a.verificationData?.submittedAt || 0).getTime();
          const bt = new Date(b.verificationData?.submittedAt || 0).getTime();
          return at - bt;
        })
        .map((c: any) => ({
          id: c.id,
          email: c.email,
          company: c.company,
          verificationStatus: c.verificationStatus || 'verified',
          submittedAt: c.verificationData?.submittedAt,
          businessInfo: {
            rcNumber: c.verificationData?.businessInfo?.rcNumber,
            companyName: c.verificationData?.businessInfo?.companyName
          },
          cacVerification: {
            verified: c.verificationData?.cacVerification?.verified,
            qoreidCompanyName: c.verificationData?.cacVerification?.qoreidCompanyName,
            qoreidStatus: c.verificationData?.cacVerification?.qoreidStatus,
            nameMatch: c.verificationData?.cacVerification?.nameMatch
          }
        }));

      return http.ok(res, { customers: filtered, total: filtered.length }, req);
    } catch (error) {
      console.error('Verification list error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to load verification list', undefined, req);
    }
  }
);

/**
 * GET /api/v1/admin/verification/:customerId
 * Get full verification details for admin review
 * Shows: customer data, business info, compliance questions, contact person, CAC verification result
 */
router.get(
  '/verification/:customerId',
  requireAdminAuth,
  requireAdminPermission('view_verification_requests'),
  async (req: Request, res: Response) => {
    try {
      const customer = await database.getCustomer(req.params.customerId);
      if (!customer) return http.notFound(res, 'NOT_FOUND', 'Customer not found', undefined, req);

      // Return structured data for admin review
      const response = {
        customer: {
          id: customer.id,
          email: customer.email,
          company: customer.company,
          createdAt: customer.createdAt,
          verificationStatus: customer.verificationStatus
        },
        verificationData: {
          submittedAt: customer.verificationData?.submittedAt,
          businessInfo: customer.verificationData?.businessInfo,
          complianceQuestions: customer.verificationData?.complianceQuestions,
          contactPerson: customer.verificationData?.contactPerson,
          cacVerification: customer.verificationData?.cacVerification,
          documents: customer.verificationData?.documents,
          reviewedAt: customer.verificationData?.reviewedAt,
          reviewedBy: customer.verificationData?.reviewedBy,
          adminNotes: customer.verificationData?.adminNotes,
          rejectionReason: customer.verificationData?.rejectionReason
        }
      };

      return http.ok(res, response, req);
    } catch (error) {
      console.error('Verification details error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to load verification details', undefined, req);
    }
  }
);

/**
 * POST /api/v1/admin/verification/:customerId/approve
 * Approve verification - can only approve if CAC verification passed
 */
router.post(
  '/verification/:customerId/approve',
  requireAdminAuth,
  requireAdminPermission('approve_verifications'),
  async (req: Request, res: Response) => {
    try {
      const customerId = req.params.customerId;
      const customer: any = await database.getCustomer(customerId);
      if (!customer) return http.notFound(res, 'NOT_FOUND', 'Customer not found', undefined, req);

      // Check that CAC verification passed
      const cacVerified = customer.verificationData?.cacVerification?.verified;
      
      if (!cacVerified) {
        return http.forbidden(
          res,
          'CAC_NOT_VERIFIED',
          'Cannot approve: CAC verification must pass before approval.',
          { 
            cacVerified: false,
            errorMessage: customer.verificationData?.cacVerification?.errorMessage 
          },
          req
        );
      }

      const vd = { ...(customer.verificationData || {}) };
      vd.reviewedAt = new Date();
      vd.reviewedBy = (req as any).admin?.id || 'admin';
      vd.adminNotes = req.body?.adminNotes || vd.adminNotes;
      vd.rejectionReason = undefined;

      await database.updateCustomer(customerId, {
        verificationStatus: 'verified',
        verificationData: vd
      });

      return http.ok(res, { 
        success: true,
        message: 'Customer verification approved successfully'
      }, req);
    } catch (error) {
      console.error('Approve verification error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to approve verification', undefined, req);
    }
  }
);

/**
 * POST /api/v1/admin/verification/:customerId/reject
 * Reject verification with reason - customer can resubmit
 */
router.post(
  '/verification/:customerId/reject',
  requireAdminAuth,
  requireAdminPermission('reject_verifications'),
  async (req: Request, res: Response) => {
    try {
      const customerId = req.params.customerId;
      const customer: any = await database.getCustomer(customerId);
      if (!customer) return http.notFound(res, 'NOT_FOUND', 'Customer not found', undefined, req);

      const reason = String(req.body?.reason || '').trim();
      if (!reason) return http.badRequest(res, 'VALIDATION_ERROR', 'Rejection reason is required', undefined, req);

      const vd = { ...(customer.verificationData || {}) };
      vd.reviewedAt = new Date();
      vd.reviewedBy = (req as any).admin?.id || 'admin';
      vd.rejectionReason = reason;
      vd.adminNotes = req.body?.adminNotes || vd.adminNotes;

      await database.updateCustomer(customerId, {
        verificationStatus: 'rejected',
        verificationData: vd
      });

      // TODO: Send email notification to customer about rejection

      return http.ok(res, { 
        success: true,
        message: 'Verification rejected. Customer can resubmit.'
      }, req);
    } catch (error) {
      console.error('Reject verification error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to reject verification', undefined, req);
    }
  }
);

/**
 * GET /api/v1/admin/verification/:customerId/document/:documentIndex
 * Get optional document URL (from Cloudinary)
 * documentIndex: 0 for cacCertificate, 1+ for supportingDocs array
 */
router.get(
  '/verification/:customerId/document/:documentIndex',
  requireAdminAuth,
  requireAdminPermission('view_verification_requests'),
  async (req: Request, res: Response) => {
    try {
      const customerId = req.params.customerId;
      const documentIndex = parseInt(req.params.documentIndex);
      const customer: any = await database.getCustomer(customerId);
      
      if (!customer) return http.notFound(res, 'NOT_FOUND', 'Customer not found', undefined, req);

      const documents = customer.verificationData?.documents;
      if (!documents) return http.notFound(res, 'NOT_FOUND', 'No documents uploaded', undefined, req);

      let documentUrl: string | undefined;

      if (documentIndex === 0) {
        // CAC certificate
        documentUrl = documents.cacCertificate;
      } else {
        // Supporting documents (1-indexed)
        const supportingDocs = documents.supportingDocs || [];
        documentUrl = supportingDocs[documentIndex - 1];
      }

      if (!documentUrl) {
        return http.notFound(res, 'NOT_FOUND', 'Document not found at index ' + documentIndex, undefined, req);
      }

      // Return the Cloudinary URL (frontend can display it directly)
      return http.ok(res, { url: documentUrl }, req);
    } catch (error) {
      console.error('Document URL error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to get document URL', undefined, req);
    }
  }
);

/**
 * GET /api/v1/admin/verification/stats
 * Get verification statistics for admin dashboard
 */
router.get(
  '/verification/stats',
  requireAdminAuth,
  requireAdminPermission('view_verification_requests'),
  async (req: Request, res: Response) => {
    try {
      const { customers } = await database.listCustomers({});
      
      const stats = {
        totalPending: customers.filter((c: any) => c.verificationStatus === 'admin_review').length,
        totalVerified: customers.filter((c: any) => c.verificationStatus === 'verified').length,
        totalRejected: customers.filter((c: any) => c.verificationStatus === 'rejected').length,
        cacPending: customers.filter((c: any) => c.verificationStatus === 'cac_pending').length,
        inactive: customers.filter((c: any) => c.verificationStatus === 'inactive').length
      };

      return http.ok(res, stats, req);
    } catch (error) {
      console.error('Verification stats error:', error);
      return http.serverError(res, 'INTERNAL_ERROR', 'Failed to load verification stats', undefined, req);
    }
  }
);

export default router;
