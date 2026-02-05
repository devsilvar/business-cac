// Load and validate configuration FIRST
import config from './config/index.js';

import express from "express";
import type { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import routes from "./routes/index.js";
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { initializeAdminUser } from "./middleware/admin.middleware.js";

// Import enterprise middleware
import { requestContextMiddleware, responseLoggingMiddleware } from "./middleware/logging.middleware.js";
import { securityHeaders, corsConfig, enforceHTTPS } from "./middleware/security.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { usageLogger } from './middleware/usageLogger.middleware.js';

// Import monitoring and health
import { healthService } from "./services/health.service.js";

// Import timeout middleware
import { apiTimeout } from "./middleware/timeout.middleware.js";

// Import Paystack webhook
import { registerPaystackWebhook } from "./routes/webhooks/paystack.webhook.js";

// Create an Express application instance
const app: Application = express();

// --- Core Middlewares ---

// Security headers first (banking-grade security)
if (config.isProduction) {
  app.use(helmet());
}
app.use(securityHeaders);

// Structured request logging (no PII)
if (config.logging.level) {
  const pinoHttpMiddleware: any = (pinoHttp as any)?.default ?? (pinoHttp as any);
  app.use(pinoHttpMiddleware({
    redact: ['req.headers.authorization'],
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed'
  }));
}

// CORS configuration for banking clients
app.use(corsConfig);

// HTTPS enforcement (skip in development)
app.use(enforceHTTPS);

// Request context tracking (request ID, correlation ID)
app.use(requestContextMiddleware);

// Global request timeout (60 seconds)
app.use(apiTimeout);

// --- Paystack Webhook (MUST be before general JSON parser) ---
// Paystack requires raw body for signature verification
app.use('/api/v1/webhooks/paystack', express.raw({ type: 'application/json' }), (req: Request, res: Response, next: NextFunction) => {
  // Store raw body for signature verification, then parse JSON
  (req as any).rawBody = req.body.toString();
  try {
    req.body = JSON.parse((req as any).rawBody);
  } catch (e) {
    // Let the webhook handler deal with parse errors
  }
  next();
});
registerPaystackWebhook(app as any);

// Parse JSON data from request bodies with error handling
app.use(express.json({ 
  limit: '10mb',
  // Custom error handling for malformed JSON
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf.toString());
    } catch (err) {
      // Let express.json handle it, but we'll catch it in error middleware
      return;
    }
  }
}));

// Parse URL-encoded data
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Handle JSON parsing errors from express.json()
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.error('JSON parsing error:', {
      requestId: req.requestId,
      error: err.message,
      body: req.body,
      url: req.originalUrl,
      method: req.method,
    });
    
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Invalid JSON in request body",
        requestId: req.requestId,
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
  next(err);
});

// Response logging (only in development or debug mode for performance)
if (config.isDevelopment || config.logging.level === 'debug') {
  app.use(responseLoggingMiddleware);
}

// --- Security and Rate Limiting ---

// Basic rate limiting (additional endpoint-specific limits in routes)

app.use("/api", (req, res, next) => {
  // Apply rate limiting only to API routes
  // Individual routes have more specific rate limiting
  next();
});


// --- Health Check Routes (before API routing) ---
app.get("/health", (req: Request, res: Response) => {
  const healthCheck = {
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  };
  return res.status(200).json(healthCheck);
});

app.get("/api/v1/health", (req: Request, res: Response) => {
  const healthCheck = {
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  };
  return res.status(200).json(healthCheck);
});


// --- Initialize Admin User (on startup) ---
initializeAdminUser().catch(console.error);


// --- API Routes ---
// Attach usage logger ONLY for BUSINESS API calls that customers pay for
// 
// TRACKED (Billable Business Operations):
//   - /business/name-search (name search API)
//   - /business/name-registration (name registration API)
//   - /business/company-registration (company registration API)
//   - /business/status/* (status check API)
//   - /business/cac-store-products (CAC products API)
//
// NOT TRACKED (Customer Portal & Admin):
//   - /customer/* (login, signup, API keys, profile, usage dashboard)
//   - /admin/* (admin dashboard, monitoring, system management)
//   - /health, /docs (public utility endpoints)
//
// Apply usage logger to all routes (it will filter for customerId internally)
app.use("/api/v1", routes);




// --- Boot-time migration: sync any portal keys into DB for admin visibility & stable auth ---
import { CustomerService } from './services/customer.service.js';
(async () => {
  try {
    const result = await CustomerService.syncPortalKeysToDatabase();
    if (result.migrated > 0) {
      if (process.env.LOG_LEVEL === 'info' || process.env.NODE_ENV === 'development') {
        console.log(`[STARTUP] Migrated ${result.migrated} portal API keys into database (skipped: ${result.skipped}).`);
      }
    } else {
      if (process.env.LOG_LEVEL === 'info' || process.env.NODE_ENV === 'development') {
        console.log('[STARTUP] No portal API keys needed migration.');
      }
    }
  } catch (e) {
    console.error('[startup] Portal key migration failed:', e);
  }
})();


// --- Documentation Routes ---
import swaggerUi from 'swagger-ui-express';

app.get("/api/v1/openapi.json", (req: Request, res: Response) => {
  res.sendFile('./src/docs/openapi.json', { root: process.cwd() }, (err) => {
    if (err) {
      console.error('Error serving OpenAPI spec:', err);
      res.status(404).json({ success: false, error: { code: "FILE_NOT_FOUND", message: "OpenAPI specification not found", requestId: req.requestId }, timestamp: new Date().toISOString(), requestId: req.requestId });
    }
  });
});

// Serve Dev/Debug OpenAPI (full spec)
app.get("/api/v1/openapi.dev.json", (req: Request, res: Response) => {
  res.sendFile('./src/docs/openapi.dev.json', { root: process.cwd() }, (err) => {
    if (err) {
      console.error('Error serving Dev OpenAPI spec:', err);
      res.status(404).json({ success: false, error: { code: "FILE_NOT_FOUND", message: "Dev OpenAPI specification not found", requestId: req.requestId }, timestamp: new Date().toISOString(), requestId: req.requestId });
    }
  });
});

// Swagger UI at /docs/api with multi-doc dropdown (public + dev)
app.use('/docs/api', swaggerUi.serve, swaggerUi.setup(undefined, {
  swaggerOptions: {
    urls: [
      { url: '/api/v1/openapi.json', name: 'Public API' },
      { url: '/api/v1/openapi.dev.json', name: 'Dev/Debug API' }
    ]
  },
  customSiteTitle: 'Business API Docs'
}));

// --- Error Handling (must be last) ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- 404 Handler for unknown routes ---
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route ${req.originalUrl} not found`,
      requestId: req.requestId,
    },
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

export default app;
