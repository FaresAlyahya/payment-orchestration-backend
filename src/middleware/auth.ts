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
 *  2. Use the first 8 characters (prefix) as an index lookup to find the merchant.
 *     This avoids a full-table scan while never exposing the full key in the DB.
 *  3. Use bcrypt.compare() to verify the full key against the stored hash.
 *  4. Reject if the key has expired (api_key_expires_at in the past).
 *  5. Reject if the merchant account is inactive.
 *  6. Attach the merchant object to req.merchant for downstream handlers.
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

    // Fast prefix-based lookup — avoids scanning the full api_key_hash column
    const apiKeyPrefix = apiKey.substring(0, 8);
    const merchantRepository = AppDataSource.getRepository(Merchant);
    const merchant = await merchantRepository.findOne({
      where: { api_key_prefix: apiKeyPrefix }
    });

    // Always run bcrypt.compare even when merchant is null (constant-time guard
    // prevents prefix-based enumeration via timing differences)
    const dummyHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000';
    const isValidKey = merchant
      ? await bcrypt.compare(apiKey, merchant.api_key_hash)
      : await bcrypt.compare(apiKey, dummyHash).then(() => false);

    if (!merchant || !isValidKey) {
      logger.warn('Invalid API key attempt', { request_id: req.requestId });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
      return;
    }

    // Reject expired keys (api_key_expires_at is set during key rotation)
    if (merchant.api_key_expires_at && merchant.api_key_expires_at < new Date()) {
      logger.warn('Expired API key attempt', {
        merchant_id: merchant.id,
        expired_at: merchant.api_key_expires_at,
        request_id: req.requestId
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key has expired. Please rotate your key.'
      });
      return;
    }

    if (!merchant.active) {
      logger.warn('Inactive merchant attempt', {
        merchant_id: merchant.id,
        request_id: req.requestId
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'Merchant account is inactive'
      });
      return;
    }

    // Attach merchant to request for downstream use
    req.merchant = merchant;

    logger.info('API request authenticated', {
      merchant_id: merchant.id,
      merchant_name: merchant.name,
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
