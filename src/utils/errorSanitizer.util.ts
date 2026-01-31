/**
 * Error Sanitization Utility
 * 
 * Maps internal error messages to user-friendly, secure messages for frontend display.
 * Prevents exposing sensitive information like AWS credentials, internal paths, database details, etc.
 */

export interface SanitizedError {
  code: string;
  message: string;
  userMessage: string;
  isOperational: boolean;
}

/**
 * Error patterns that should be sanitized
 * These patterns match common error messages that expose sensitive information
 */
const ERROR_PATTERNS = {
  // Network and AWS errors
  AWS_ERROR: /aws|amazon|s3|ec2|rds|dynamodb|cloudfront/i,
  NETWORK_ERROR: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH|socket hang up/i,
  DNS_ERROR: /getaddrinfo|EAI_AGAIN/i,
  SSL_ERROR: /certificate|ssl|tls|https/i,
  
  // Database errors
  DATABASE_ERROR: /database|sql|postgres|mysql|mongodb|firestore|transaction failed/i,
  CONSTRAINT_ERROR: /constraint|unique|foreign key|duplicate key/i,
  
  // API and external service errors
  EXTERNAL_API_ERROR: /api|endpoint|service unavailable|gateway|upstream/i,
  TIMEOUT_ERROR: /timeout|timed out|deadline exceeded/i,
  
  // Authentication and authorization
  TOKEN_ERROR: /jwt|token|bearer|authorization/i,
  CREDENTIALS_ERROR: /credentials|password|secret|key/i,
  
  // System errors
  MEMORY_ERROR: /memory|heap|stack overflow/i,
  FILE_SYSTEM_ERROR: /ENOENT|EACCES|permission denied|file not found/i,
  
  // Configuration errors
  CONFIG_ERROR: /environment|env|configuration|missing required/i,
};

/**
 * User-friendly error messages by error code
 */
const ERROR_MESSAGES: Record<string, { message: string; userMessage: string }> = {
  // Wallet errors
  INSUFFICIENT_BALANCE: {
    message: 'Insufficient wallet balance',
    userMessage: 'Your wallet balance is insufficient for this transaction. Please top up your wallet and try again.',
  },
  WALLET_NOT_FOUND: {
    message: 'Wallet not found',
    userMessage: 'We couldn\'t find your wallet. Please contact support if this issue persists.',
  },
  DUPLICATE_TRANSACTION: {
    message: 'Duplicate transaction detected',
    userMessage: 'This transaction has already been processed. Please check your transaction history.',
  },
  TRANSACTION_FAILED: {
    message: 'Transaction failed',
    userMessage: 'Your transaction could not be completed. Please try again or contact support.',
  },
  TRANSACTION_NOT_FOUND: {
    message: 'Transaction not found',
    userMessage: 'We couldn\'t find this transaction. Please verify the transaction ID and try again.',
  },
  INVALID_AMOUNT: {
    message: 'Invalid transaction amount',
    userMessage: 'The transaction amount is invalid. Please check the amount and try again.',
  },

  // Payment errors
  PAYMENT_FAILED: {
    message: 'Payment failed',
    userMessage: 'Your payment could not be processed. Please check your payment details and try again.',
  },
  PAYMENT_VERIFICATION_FAILED: {
    message: 'Payment verification failed',
    userMessage: 'We couldn\'t verify your payment. Please contact support with your payment reference.',
  },
  PAYSTACK_ERROR: {
    message: 'Payment service error',
    userMessage: 'There was an issue with the payment service. Please try again later.',
  },

  // Authentication errors
  INVALID_CREDENTIALS: {
    message: 'Invalid credentials',
    userMessage: 'The email or password you entered is incorrect. Please try again.',
  },
  UNAUTHORIZED: {
    message: 'Unauthorized access',
    userMessage: 'You are not authorized to access this resource. Please log in and try again.',
  },
  TOKEN_EXPIRED: {
    message: 'Token expired',
    userMessage: 'Your session has expired. Please log in again to continue.',
  },
  INVALID_TOKEN: {
    message: 'Invalid token',
    userMessage: 'Your session is invalid. Please log in again.',
  },
  MISSING_TOKEN: {
    message: 'Missing authentication token',
    userMessage: 'Authentication required. Please log in to continue.',
  },
  INVALID_API_KEY: {
    message: 'Invalid API key',
    userMessage: 'Your API key is invalid or has been revoked. Please check your API credentials.',
  },

  // Validation errors
  VALIDATION_ERROR: {
    message: 'Validation failed',
    userMessage: 'Some of the information you provided is invalid. Please check your input and try again.',
  },
  MISSING_FIELD: {
    message: 'Required field missing',
    userMessage: 'Please fill in all required fields and try again.',
  },
  INVALID_FORMAT: {
    message: 'Invalid format',
    userMessage: 'The format of the data you provided is incorrect. Please check and try again.',
  },
  INVALID_EMAIL: {
    message: 'Invalid email format',
    userMessage: 'Please enter a valid email address.',
  },

  // Resource errors
  NOT_FOUND: {
    message: 'Resource not found',
    userMessage: 'The requested resource could not be found. Please check and try again.',
  },
  CUSTOMER_NOT_FOUND: {
    message: 'Customer not found',
    userMessage: 'We couldn\'t find your account. Please contact support.',
  },
  CONFLICT: {
    message: 'Resource conflict',
    userMessage: 'This resource already exists. Please use a different identifier.',
  },
  EMAIL_EXISTS: {
    message: 'Email already exists',
    userMessage: 'An account with this email already exists. Please use a different email or log in.',
  },
  ADMIN_EXISTS: {
    message: 'Admin already exists',
    userMessage: 'An admin with this email already exists.',
  },

  // Rate limiting
  RATE_LIMIT_EXCEEDED: {
    message: 'Rate limit exceeded',
    userMessage: 'You have made too many requests. Please wait a moment and try again.',
  },
  TOO_MANY_REQUESTS: {
    message: 'Too many requests',
    userMessage: 'You are making requests too quickly. Please slow down and try again.',
  },

  // External service errors
  EXTERNAL_SERVICE_ERROR: {
    message: 'External service error',
    userMessage: 'We are experiencing issues with an external service. Please try again later.',
  },
  SERVICE_TIMEOUT: {
    message: 'Service timeout',
    userMessage: 'The service took too long to respond. Please try again.',
  },
  SERVICE_UNAVAILABLE: {
    message: 'Service unavailable',
    userMessage: 'The service is temporarily unavailable. Please try again later.',
  },
  VERIFICATION_SERVICE_ERROR: {
    message: 'Verification service error',
    userMessage: 'The verification service is currently unavailable. Please try again later.',
  },

  // Network errors
  NETWORK_ERROR: {
    message: 'Network error',
    userMessage: 'A network error occurred. Please check your connection and try again.',
  },
  CONNECTION_ERROR: {
    message: 'Connection error',
    userMessage: 'Could not connect to the service. Please check your internet connection and try again.',
  },

  // Server errors
  INTERNAL_ERROR: {
    message: 'Internal server error',
    userMessage: 'Something went wrong on our end. We\'re working to fix it. Please try again later.',
  },
  DATABASE_ERROR: {
    message: 'Database error',
    userMessage: 'We are experiencing database issues. Please try again later.',
  },
  CONFIGURATION_ERROR: {
    message: 'Configuration error',
    userMessage: 'The service is not properly configured. Please contact support.',
  },

  // CAC/Documents API errors
  CAC_API_ERROR: {
    message: 'CAC API error',
    userMessage: 'The company registration service is currently unavailable. Please try again later.',
  },
  DOCUMENTS_API_ERROR: {
    message: 'Documents API error',
    userMessage: 'The verification service is currently unavailable. Please try again later.',
  },
  INVALID_DOCUMENT: {
    message: 'Invalid document',
    userMessage: 'The document you provided is invalid or cannot be verified. Please check and try again.',
  },

  // QoreID errors
  QOREID_ERROR: {
    message: 'QoreID service error',
    userMessage: 'The identity verification service is currently unavailable. Please try again later.',
  },
  QOREID_NOT_CONFIGURED: {
    message: 'QoreID not configured',
    userMessage: 'The identity verification service is not available at this time.',
  },

  // Additional specific errors
  API_KEY_NOT_FOUND: {
    message: 'API key not found',
    userMessage: 'The API key could not be found. Please check your credentials.',
  },
  CUSTOMER_EXISTS: {
    message: 'Customer already exists',
    userMessage: 'An account with this email already exists. Please use a different email or log in.',
  },
  INVALID_TRANSACTION_STATUS: {
    message: 'Invalid transaction status',
    userMessage: 'This transaction cannot be processed in its current state.',
  },
  DUPLICATE_REFUND: {
    message: 'Transaction already refunded',
    userMessage: 'This transaction has already been refunded.',
  },
  INVALID_TRANSACTION: {
    message: 'Invalid transaction type',
    userMessage: 'This operation cannot be performed on this transaction type.',
  },
  UPDATE_FAILED: {
    message: 'Update failed',
    userMessage: 'We couldn\'t update the information. Please try again.',
  },
};

/**
 * Sanitize an error message by mapping it to a user-friendly message
 */
export function sanitizeError(
  error: Error | any,
  isDevelopment: boolean = false
): SanitizedError {
  const errorMessage = error?.message || 'Unknown error';
  const errorName = error?.name || 'Error';
  const statusCode = error?.statusCode || 500;

  // Check if it's a custom error class with a specific code
  let errorCode = 'INTERNAL_ERROR';
  let isOperational = false;

  // Handle specific error types
  if (errorName === 'InsufficientBalanceError') {
    errorCode = 'INSUFFICIENT_BALANCE';
    isOperational = true;
  } else if (errorName === 'WalletNotFoundError') {
    errorCode = 'WALLET_NOT_FOUND';
    isOperational = true;
  } else if (errorName === 'DuplicateTransactionError') {
    errorCode = 'DUPLICATE_TRANSACTION';
    isOperational = true;
  } else if (errorName === 'PaystackServiceError') {
    errorCode = 'PAYSTACK_ERROR';
    isOperational = true;
  } else if (errorName === 'ValidationError' || errorName === 'ApiError') {
    errorCode = error.code || 'VALIDATION_ERROR';
    isOperational = true;
  } else if (errorName === 'TimeoutError') {
    errorCode = 'SERVICE_TIMEOUT';
    isOperational = true;
  } else if (errorName === 'ExternalApiError') {
    errorCode = 'EXTERNAL_SERVICE_ERROR';
    isOperational = true;
  } else if (errorName === 'TransactionNotFoundError') {
    errorCode = 'TRANSACTION_NOT_FOUND';
    isOperational = true;
  } else if (errorName === 'CustomerNotFoundError') {
    errorCode = 'CUSTOMER_NOT_FOUND';
    isOperational = true;
  } else if (errorName === 'CustomerExistsError') {
    errorCode = 'CUSTOMER_EXISTS';
    isOperational = true;
  } else if (errorName === 'ApiKeyNotFoundError') {
    errorCode = 'API_KEY_NOT_FOUND';
    isOperational = true;
  } else if (errorName === 'InvalidTransactionStatusError') {
    errorCode = 'INVALID_TRANSACTION_STATUS';
    isOperational = true;
  } else if (errorName === 'InvalidTransactionError') {
    errorCode = 'INVALID_TRANSACTION';
    isOperational = true;
  } else if (errorName === 'DuplicateRefundError') {
    errorCode = 'DUPLICATE_REFUND';
    isOperational = true;
  } else if (errorName === 'UpdateFailedError') {
    errorCode = 'UPDATE_FAILED';
    isOperational = true;
  } else if (errorName === 'QoreIdServiceError') {
    errorCode = 'QOREID_ERROR';
    isOperational = true;
  } else if (errorName === 'QoreIdNotConfiguredError') {
    errorCode = 'QOREID_NOT_CONFIGURED';
    isOperational = true;
  } else if (errorName === 'QoreIdAuthError') {
    errorCode = 'QOREID_ERROR';
    isOperational = true;
  } else if (errorMessage.includes('not found')) {
    errorCode = determineNotFoundType(errorMessage);
    isOperational = true;
  } else if (errorMessage.includes('already exists')) {
    errorCode = determineConflictType(errorMessage);
    isOperational = true;
  } else {
    // Pattern matching for sensitive errors
    errorCode = detectErrorPattern(errorMessage);
    isOperational = errorCode !== 'INTERNAL_ERROR';
  }

  // Get the sanitized messages
  const sanitized = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.INTERNAL_ERROR;

  return {
    code: errorCode,
    message: isDevelopment ? errorMessage : sanitized.message,
    userMessage: sanitized.userMessage,
    isOperational,
  };
}

/**
 * Determine specific "not found" error type
 */
function determineNotFoundType(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('customer')) return 'CUSTOMER_NOT_FOUND';
  if (lowerMessage.includes('wallet')) return 'WALLET_NOT_FOUND';
  if (lowerMessage.includes('transaction')) return 'TRANSACTION_NOT_FOUND';
  
  return 'NOT_FOUND';
}

/**
 * Determine specific "conflict" error type
 */
function determineConflictType(message: string): string {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('email')) return 'EMAIL_EXISTS';
  if (lowerMessage.includes('admin')) return 'ADMIN_EXISTS';
  if (lowerMessage.includes('transaction') || lowerMessage.includes('reference')) {
    return 'DUPLICATE_TRANSACTION';
  }
  
  return 'CONFLICT';
}

/**
 * Detect error pattern from message
 */
function detectErrorPattern(message: string): string {
  if (ERROR_PATTERNS.AWS_ERROR.test(message)) return 'NETWORK_ERROR';
  if (ERROR_PATTERNS.NETWORK_ERROR.test(message)) return 'NETWORK_ERROR';
  if (ERROR_PATTERNS.DNS_ERROR.test(message)) return 'NETWORK_ERROR';
  if (ERROR_PATTERNS.SSL_ERROR.test(message)) return 'NETWORK_ERROR';
  if (ERROR_PATTERNS.DATABASE_ERROR.test(message)) return 'DATABASE_ERROR';
  if (ERROR_PATTERNS.CONSTRAINT_ERROR.test(message)) return 'CONFLICT';
  if (ERROR_PATTERNS.TIMEOUT_ERROR.test(message)) return 'SERVICE_TIMEOUT';
  if (ERROR_PATTERNS.EXTERNAL_API_ERROR.test(message)) return 'EXTERNAL_SERVICE_ERROR';
  if (ERROR_PATTERNS.TOKEN_ERROR.test(message)) return 'INVALID_TOKEN';
  if (ERROR_PATTERNS.CREDENTIALS_ERROR.test(message)) return 'INVALID_CREDENTIALS';
  if (ERROR_PATTERNS.MEMORY_ERROR.test(message)) return 'INTERNAL_ERROR';
  if (ERROR_PATTERNS.FILE_SYSTEM_ERROR.test(message)) return 'INTERNAL_ERROR';
  if (ERROR_PATTERNS.CONFIG_ERROR.test(message)) return 'CONFIGURATION_ERROR';
  
  return 'INTERNAL_ERROR';
}

/**
 * Check if error contains sensitive information
 */
export function containsSensitiveInfo(message: string): boolean {
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /api[_-]?key/i,
    /token/i,
    /credentials/i,
    /aws/i,
    /amazon/i,
    /\/home\//i,
    /\/var\//i,
    /\/usr\//i,
    /C:\\/i,
    /stack trace/i,
    /at\s+\w+\./i, // Stack trace lines
  ];

  return sensitivePatterns.some(pattern => pattern.test(message));
}

/**
 * Sanitize error details object
 */
export function sanitizeErrorDetails(details: any, isDevelopment: boolean): any {
  if (!details) return undefined;
  
  // In production, only return sanitized details
  if (!isDevelopment) {
    // Remove sensitive fields
    const { originalError, stack, ...safeDetails } = details;
    return Object.keys(safeDetails).length > 0 ? safeDetails : undefined;
  }
  
  return details;
}
