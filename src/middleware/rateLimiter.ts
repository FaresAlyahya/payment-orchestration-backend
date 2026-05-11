import rateLimit, { Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';
import { Request } from 'express';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Redis client (optional — rate limiting falls back to in-memory if unavailable)
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      // Don't buffer commands while disconnected — avoids memory bloat
      enableOfflineQueue: false,
      // Fail fast on initial connection errors rather than retrying forever
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });

    redisClient.on('error', (err: Error) => {
      logger.warn('Redis rate-limit client error — falling back to in-memory store', {
        message: err.message
      });
      redisClient = null; // Disable Redis store on persistent errors
    });
  } catch (err: any) {
    logger.warn('Failed to create Redis client — rate limiting will use in-memory store', {
      message: err.message
    });
    redisClient = null;
  }
}

/**
 * Build a RedisStore using ioredis, or return undefined so that
 * express-rate-limit falls back to its built-in MemoryStore.
 *
 * rate-limit-redis v4 expects a `sendCommand` callback whose signature
 * matches the ioredis `call` method.
 */
function buildStore(): RedisStore | undefined {
  if (!redisClient) return undefined;

  return new RedisStore({
    // Forward raw Redis commands from express-rate-limit to ioredis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: (...args: string[]): any => redisClient!.call(...(args as [string, ...string[]]))
  });
}

// ---------------------------------------------------------------------------
// Shared rate-limiter options
// ---------------------------------------------------------------------------

const baseOptions: Partial<Options> = {
  // Use standardised RateLimit-* headers (RFC 6585) and include Retry-After
  standardHeaders: true,
  legacyHeaders: false,
  // Include Retry-After header on 429 responses
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: 'Too Many Requests',
      message: options.message,
      retryAfter: res.getHeader('Retry-After')
    });
  }
};

// ---------------------------------------------------------------------------
// Global rate limiter  — 100 requests / 15 min per IP
// Applied at the /api prefix in index.ts before any auth.
// ---------------------------------------------------------------------------
export const globalLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again in 15 minutes.',
  store: buildStore()
});

// ---------------------------------------------------------------------------
// /payments — 10 requests / min per authenticated merchant
// Must be placed AFTER authenticateApiKey so req.merchant is populated.
// ---------------------------------------------------------------------------
export const paymentsLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: 10,
  message: 'Payment rate limit exceeded (10 requests/min). Please slow down.',
  // Key by merchant ID when available, fall back to IP for unauthenticated hits
  keyGenerator: (req: Request) => req.merchant?.id || req.ip || 'unknown',
  store: buildStore()
});

// ---------------------------------------------------------------------------
// /analytics — 30 requests / min per authenticated merchant
// Must be placed AFTER authenticateApiKey so req.merchant is populated.
// ---------------------------------------------------------------------------
export const analyticsLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: 30,
  message: 'Analytics rate limit exceeded (30 requests/min). Please slow down.',
  keyGenerator: (req: Request) => req.merchant?.id || req.ip || 'unknown',
  store: buildStore()
});

// ---------------------------------------------------------------------------
// /health — 100 requests / min per IP
// ---------------------------------------------------------------------------
export const healthLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: 100,
  message: 'Health check rate limit exceeded (100 requests/min).',
  store: buildStore()
});
