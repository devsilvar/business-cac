/**
 * Centralized Configuration Module
 * 
 * Validates and exports all environment variables with proper types.
 * Fails fast at startup if required variables are missing.
 */

import dotenv from 'dotenv';
import path from 'path';

// Get the directory of this file to find .env relative to project root
// In CommonJS, __dirname is automatically available as a global
const rootDir = path.resolve(__dirname, '../..');

// Load environment variables from project root
const result = dotenv.config({ path: path.join(rootDir, '.env') });

if (result.error) {
  console.warn('[Config] Warning: Could not load .env file:', result.error.message);
}

/**
 * Environment variable validation
 */
interface ValidationRule {
  key: string;
  required: boolean;
  default?: string;
  validate?: (value: string) => boolean;
  errorMessage?: string;
}

const validationRules: ValidationRule[] = [
  // Server Configuration
  { key: 'PORT', required: false, default: '3000' },
  { key: 'NODE_ENV', required: false, default: 'development' },
  
  // Authentication & Security
  { 
    key: 'JWT_SECRET', 
    required: true,
    validate: (val) => val.length >= 32,
    errorMessage: 'JWT_SECRET must be at least 32 characters long'
  },
  { key: 'JWT_EXPIRY', required: false, default: '24h' },
  { key: 'JWT_ISSUER', required: false, default: 'business-api' },
  { key: 'JWT_AUDIENCE', required: false, default: 'business-api-clients' },
  { key: 'JWT_EXPIRES_IN', required: false, default: '24h' },
  
  // Admin Configuration
  { 
    key: 'ADMIN_EMAIL', 
    required: true,
    validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
    errorMessage: 'ADMIN_EMAIL must be a valid email address'
  },
  { 
    key: 'ADMIN_PASSWORD', 
    required: true,
    validate: (val) => val.length >= 8,
    errorMessage: 'ADMIN_PASSWORD must be at least 8 characters long'
  },
  
  // External API Configuration
  { key: 'DOCUMENTS_API_URL', required: true },
  { key: 'DOCUMENTS_AGENT_ID', required: true },
  { key: 'DOCUMENTS_API_TIMEOUT', required: false, default: '30000' },
  
  { key: 'CAC_API_BASE_URL', required: false, default: 'https://icrp.cac.gov.ng/crp_vas_name_similarity_app/api/crp/ai/bn-compliance-check/check-business-name' },
  { key: 'CAC_API_TIMEOUT', required: false, default: '30000' },
  
  { key: 'CAC_STORE_PRODUCTS', required: false, default: 'https://fakestoreapi.com/products' },
  { key: 'CAC_STORE_PRODUCTS_TOKEN', required: false, default: '' },
  { key: 'CAC_STORE_PRODUCTS_TIMEOUT', required: false, default: '10000' },
  
  // Database Configuration
  { key: 'DATABASE_TYPE', required: false, default: 'memory' },
  { key: 'DATABASE_URL', required: false },
  { key: 'USE_FIREBASE', required: false, default: 'false' },
  { key: 'MEMDB_FILE', required: false },
  
  // Logging & Debugging (no default - must be explicitly set)
  { key: 'LOG_LEVEL', required: false },
  { key: 'DEBUG_API_KEY', required: false, default: 'false' },
  
  // Rate Limiting
  { key: 'RATE_LIMIT_WINDOW_MS', required: false, default: '900000' },
  { key: 'RATE_LIMIT_MAX_REQUESTS', required: false, default: '100' },
  { key: 'RATE_LIMIT_SKIP_FAILED_REQUESTS', required: false, default: 'false' },
  
  // CORS
  { key: 'CORS_ALLOWLIST', required: false, default: '' },
  
  // Security
  { key: 'AUTH_ENABLED', required: false, default: 'false' },
  { key: 'API_KEY_HEADER', required: false, default: 'x-api-key' },
  { key: 'RELAX_JWT', required: false, default: 'false' },
  
  // Development/Testing
  { key: 'SAVE_PLAIN_KEYS', required: false, default: 'false' },
  { key: 'SAVE_PLAIN_KEYS_SQLITE', required: false, default: 'false' },
  { key: 'PLAIN_KEY_FILE', required: false },
  { key: 'SQLITE_VAULT_PASSPHRASE', required: false, default: 'dev-secret' },
  { key: 'AUTO_IMPORT_KEY', required: false, default: 'false' },
  
  // Firebase
  { key: 'FUNCTIONS_EMULATOR', required: false },
  { key: 'FIREBASE_CONFIG', required: false },
];

/**
 * Validate environment variables
 */
function validateEnvironment(): void {
  const errors: string[] = [];

  for (const rule of validationRules) {
    const value = process.env[rule.key];

    // Check if required variable is missing
    if (rule.required && !value) {
      errors.push(`Missing required environment variable: ${rule.key}`);
      continue;
    }

    // Apply default if not provided
    if (!value && rule.default !== undefined) {
      process.env[rule.key] = rule.default;
    }

    // Custom validation
    if (value && rule.validate && !rule.validate(value)) {
      errors.push(rule.errorMessage || `Invalid value for ${rule.key}`);
    }
  }

  // Fail fast if validation errors
  if (errors.length > 0) {
    console.error('❌ Environment Variable Validation Failed:');
    errors.forEach(err => console.error(`   - ${err}`));
    console.error('\n💡 Please check your .env file and ensure all required variables are set.');
    console.error('📖 See .env.example for reference.\n');
    process.exit(1);
  }

  console.log('✅ Environment variables validated successfully');
}

/**
 * Run validation
 */
validateEnvironment();

/**
 * Typed configuration object
 */
export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  
  // Authentication & Security
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiry: process.env.JWT_EXPIRY || '24h',
    expiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRY || '24h',
    issuer: process.env.JWT_ISSUER || 'business-api',
    audience: process.env.JWT_AUDIENCE || 'business-api-clients',
    relax: process.env.RELAX_JWT === '1' || process.env.RELAX_JWT === 'true',
  },
  
  // Admin
  admin: {
    email: process.env.ADMIN_EMAIL!,
    password: process.env.ADMIN_PASSWORD!,
  },
  
  // External APIs
  documentsApi: {
    baseUrl: process.env.DOCUMENTS_API_URL!,
    agentId: process.env.DOCUMENTS_AGENT_ID!,
    timeout: parseInt(process.env.DOCUMENTS_API_TIMEOUT || '30000', 10),
  },
  
  cacApi: {
    baseUrl: process.env.CAC_API_BASE_URL || 'https://icrp.cac.gov.ng/crp_vas_name_similarity_app/api/crp/ai/bn-compliance-check/check-business-name',
    timeout: parseInt(process.env.CAC_API_TIMEOUT || '30000', 10),
  },
  
  cacStore: {
    baseUrl: process.env.CAC_STORE_PRODUCTS || 'https://fakestoreapi.com/products',
    token: process.env.CAC_STORE_PRODUCTS_TOKEN || '',
    timeout: parseInt(process.env.CAC_STORE_PRODUCTS_TIMEOUT || '10000', 10),
  },
  
  // Database
  database: {
    type: process.env.DATABASE_TYPE || 'memory',
    url: process.env.DATABASE_URL,
    useFirebase: process.env.USE_FIREBASE === 'true',
    memoryFile: process.env.MEMDB_FILE || path.join('.data', 'memorydb.json'),
  },
  
  // Logging & Debugging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    debugApiKey: process.env.DEBUG_API_KEY === '1' || process.env.DEBUG_API_KEY === 'true',
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    skipFailedRequests: process.env.RATE_LIMIT_SKIP_FAILED_REQUESTS === 'true',
  },
  
  // CORS
  cors: {
    allowlist: (process.env.CORS_ALLOWLIST || '').split(',').filter(Boolean),
  },
  
  // Security
  security: {
    authEnabled: process.env.AUTH_ENABLED === 'true',
    apiKeyHeader: process.env.API_KEY_HEADER || 'x-api-key',
  },
  
  // Development/Testing
  dev: {
    savePlainKeys: process.env.SAVE_PLAIN_KEYS === '1' || process.env.SAVE_PLAIN_KEYS === 'true',
    savePlainKeysSqlite: process.env.SAVE_PLAIN_KEYS_SQLITE === '1' || process.env.SAVE_PLAIN_KEYS_SQLITE === 'true',
    plainKeyFile: process.env.PLAIN_KEY_FILE || path.join('.data', 'plain_api_keys.ndjson'),
    sqliteVaultPassphrase: process.env.SQLITE_VAULT_PASSPHRASE || 'dev-secret',
    autoImportKey: process.env.AUTO_IMPORT_KEY === '1' || process.env.AUTO_IMPORT_KEY === 'true',
  },
  
  // Firebase
  firebase: {
    emulator: process.env.FUNCTIONS_EMULATOR,
    config: process.env.FIREBASE_CONFIG,
  },
  
  // Package
  version: process.env.npm_package_version || '1.0.0',
} as const;

export default config;

/**
 * Helper function to check if we're in production
 */
export const isProduction = () => config.isProduction;

/**
 * Helper function to check if we're in development
 */
export const isDevelopment = () => config.isDevelopment;

/**
 * Helper function to get environment name
 */
export const getEnvironment = () => config.nodeEnv;
