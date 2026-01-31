/**
 * Admin-related TypeScript type definitions
 */

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  role: 'super_admin' | 'admin' | 'support';
  permissions: string[];
  lastLogin?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export interface AdminJWTPayload {
  adminId: string;
  email: string;
  role: string;
  permissions: string[];
}

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface BusinessOverview {
  totalCustomers: number;
  activeSubscriptions: number;
  monthlyRevenue: number;
  apiRequestsToday: number;
  apiRequestsThisMonth: number;
  errorRate: number;
  systemHealth: 'healthy' | 'warning' | 'critical';
  recentSignups: number;
  churnRate: number;
  popularEndpoints: Array<{
    endpoint: string;
    requests: number;
    percentage: number;
  }>;
  recentErrors: Array<{
    endpoint: string;
    error: string;
    timestamp: Date;
    count: number;
  }>;
}

export interface SystemStatus {
  status: 'healthy' | 'warning' | 'critical';
  uptime: number;
  memory: NodeJS.MemoryUsage;
  timestamp: string;
  version: string;
  environment: string;
  services: {
    database: 'connected' | 'disconnected' | 'unknown';
    documentsApi: 'connected' | 'disconnected' | 'unknown';
    paystack: 'connected' | 'disconnected' | 'unknown';
  };
}

// Extend Express Request type for admin context
declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        role: string;
        permissions: string[];
      };
    }
  }
}