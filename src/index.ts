import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import * as dotenv from 'dotenv';
import apiRoutes from './routes/api.routes';
import { logger } from './utils/logger';
import { initializeDatabase } from './config/database';
import { webhookQueue } from './services/WebhookQueue';
import { requestIdMiddleware } from './middleware/requestId';
import { globalLimiter, healthLimiter } from './middleware/rateLimiter';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

/**
 * Request ID — attach before anything else so all subsequent logs can include it
 */
app.use(requestIdMiddleware);

/**
 * Security Middleware
 */
app.use(helmet()); // Sets secure HTTP headers (XSS, HSTS, frame-options, etc.)

/**
 * CORS Configuration
 *
 * Allowed origins are driven by the ALLOWED_ORIGINS environment variable
 * (comma-separated list).  FRONTEND_URL is also accepted for backward
 * compatibility.  All other origins are rejected.
 *
 * Server-to-server requests (no Origin header) are always allowed so that
 * PSP webhooks and internal services can reach the API.
 */
const configuredOrigins = [
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : [])
];

// Always allow localhost variants for local development regardless of env config
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
];

const allowedOrigins = [...new Set([...configuredOrigins, ...devOrigins])];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests that carry no Origin header
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
      }
    },
    credentials: true
  })
);

/**
 * Global Rate Limiting — 100 requests / 15 min per IP
 * Applied to all /api/* routes.  Per-endpoint, per-merchant limits are
 * applied at the route level in api.routes.ts (after authentication).
 */
app.use('/api', globalLimiter);

/**
 * Body Parsing Middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * HTTP Request Logging
 */
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

/**
 * Health Check Endpoint
 * Separate rate limiter (100 req/min) to protect against health-check floods.
 */
app.get('/health', healthLimiter, (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

/**
 * API Routes
 */
app.use(`/api/${API_VERSION}`, apiRoutes);

/**
 * Root endpoint
 */
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    name: 'Payment Orchestration Platform API',
    version: API_VERSION,
    description: 'Unified payment processing for Saudi market',
    documentation: `/api/${API_VERSION}/docs`,
    health: '/health'
  });
});

/**
 * 404 Handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString(),
    request_id: req.requestId
  });
});

/**
 * Global Error Handler
 */
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    request_id: req.requestId
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    request_id: req.requestId
  });
});

/**
 * Start Server
 */
const startServer = async (): Promise<void> => {
  try {
    // Initialize database
    await initializeDatabase();

    // Re-queue any webhook deliveries left pending from a previous run
    await webhookQueue.processOrphanedDeliveries();

    // Start listening
    app.listen(PORT, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║  Payment Orchestration Platform API                      ║
║  Environment: ${process.env.NODE_ENV?.padEnd(43)}║
║  Port: ${PORT.toString().padEnd(50)}║
║  API Version: ${API_VERSION.padEnd(46)}║
║  Database: Connected ✅                                   ║
╚═══════════════════════════════════════════════════════════╝
      `);
      logger.info(`Server running on http://localhost:${PORT}`);
      logger.info(`API available at http://localhost:${PORT}/api/${API_VERSION}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();

export default app;
