import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { Merchant } from '../models/Merchant';
import { logger } from '../utils/logger';

// Extend Express Request type to include merchant
declare global {
  namespace Express {
    interface Request {
      merchant?: Merchant;
    }
  }
}

/**
 * Middleware to authenticate API requests using merchant API key.
 *
 * Authentication flow:
 *  1. Extract API key from `Authorization: Bearer <key>` header.
 *  2. Load all merchants and use bcrypt.compare() to find a matching api_key hash.
 *  3. Reject if the key has expired (api_key_expires_at in the past).
 *  4. Reject if the merchant account is inactive.
 *  5. Attach the merchant object to req.merchant for downstream handlers.
 *
 * NOTE: This performs a full-table scan with a bcrypt comparison per row.
 * This is only acceptable for a small number of merchants. Add an api_key_prefix
 * indexed column for fast lookup when merchant count grows.
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract key from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid API key. Use: Authorization: Bearer YOUR_API_KEY'
      });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    const merchantRepository = AppDataSource.getRepository(Merchant);
    const allMerchants = await merchantRepository.find();

    // Find the merchant whose stored bcrypt hash matches the provided key.
    // bcrypt.compare is intentionally slow — avoid calling it in a loop for
    // large datasets. Use an api_key_prefix index column when scaling up.
    let matchedMerchant: Merchant | null = null;
    for (const candidate of allMerchants) {
      const isMatch = await bcrypt.compare(apiKey, candidate.api_key);
      if (isMatch) {
        matchedMerchant = candidate;
        break;
      }
    }

    // Timing-attack protection: if no merchant found, run one dummy bcrypt
    // comparison so the response time doesn't reveal whether the prefix exists.
    if (!matchedMerchant) {
      const dummyHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000';
      await bcrypt.compare(apiKey, dummyHash).catch(() => {});

      logger.warn('Invalid API key attempt', { request_id: req.requestId });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
      return;
    }

    // Reject expired keys
    if (matchedMerchant.api_key_expires_at && matchedMerchant.api_key_expires_at < new Date()) {
      logger.warn('Expired API key attempt', {
        merchant_id: matchedMerchant.id,
        expired_at: matchedMerchant.api_key_expires_at,
        request_id: req.requestId
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key has expired. Please rotate your key.'
      });
      return;
    }

    if (!matchedMerchant.active) {
      logger.warn('Inactive merchant attempt', {
        merchant_id: matchedMerchant.id,
        request_id: req.requestId
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'Merchant account is inactive'
      });
      return;
    }

    // Attach merchant to request for downstream use
    req.merchant = matchedMerchant;

    logger.info('API request authenticated', {
      merchant_id: matchedMerchant.id,
      merchant_name: matchedMerchant.name,
      request_id: req.requestId
    });

    next();
  } catch (error) {
    logger.error('Authentication error:', { error, request_id: req.requestId });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};
