import jwt, { SignOptions } from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable must be set. Add it to your .env file.')
}

// Validate JWT secret strength
function validateJwtSecret(secret: string): void {
  if (secret.length < 32) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET must be at least 32 characters long for security.')
  }
  
  // Check for common weak secrets
  const weakSecrets = ['secret', 'password', 'jwt_secret', 'your-secret-key', 'change-me', 'test', 'dev'];
  if (weakSecrets.some(weak => secret.toLowerCase().includes(weak))) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET appears to be a weak/common secret. Use a strong, randomly generated secret.')
  }
  
  // Check for sufficient entropy (mix of character types)
  const hasUpperCase = /[A-Z]/.test(secret);
  const hasLowerCase = /[a-z]/.test(secret);
  const hasNumbers = /[0-9]/.test(secret);
  const hasSpecial = /[^A-Za-z0-9]/.test(secret);
  
  const complexityScore = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecial].filter(Boolean).length;
  if (complexityScore < 3) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET lacks sufficient complexity. Use a mix of uppercase, lowercase, numbers, and special characters.')
  }
}

validateJwtSecret(JWT_SECRET);
const JWT_ISSUER = process.env.JWT_ISSUER || 'business-api'
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'business-api-clients'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRY || '24h'

export interface StandardJwtPayload {
  sub?: string
  iat?: number
  exp?: number
  iss?: string
  aud?: string
  [key: string]: any
}

export function signJwt(payload: Record<string, any>, options: SignOptions = {}) {
  const finalOptions: SignOptions = {
    expiresIn: JWT_EXPIRES_IN as any, // cast to satisfy types; value comes from env (e.g., '24h')
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    ...options,
  }
  return jwt.sign(payload, JWT_SECRET, finalOptions)
}

export function verifyJwt<T = StandardJwtPayload>(token: string): T {
  // SECURITY: Never bypass JWT signature verification, even in development
  // This prevents authentication bypass vulnerabilities
  return jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as T;
}

export const jwtConfig = {
  secretSet: !!process.env.JWT_SECRET,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  expiresIn: JWT_EXPIRES_IN,
}
