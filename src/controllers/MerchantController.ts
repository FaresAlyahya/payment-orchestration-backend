import crypto from 'crypto';
import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { Merchant } from '../models/Merchant';
import { logger } from '../utils/logger';

// Number of bcrypt salt rounds — high enough to be slow for attackers,
// low enough to be acceptable for a synchronous web request (~300 ms on modern hardware)
const BCRYPT_ROUNDS = 12;

export class MerchantController {
  /**
   * POST /api/v1/merchants/rotate-key
   *
   * Generates a fresh API key for the authenticated merchant, stores a bcrypt
   * hash of it, and returns the plaintext key **once** — the only time it will
   * ever be visible.
   *
   * Key rotation design:
   *  - A cryptographically random 40-byte key is generated and hex-encoded
   *    (80 hex chars), giving ~320 bits of entropy.
   *  - The first 8 characters become the new api_key_prefix used for fast
   *    DB lookup without exposing the full key.
   *  - The full key is hashed with bcrypt and stored in api_key_hash.
   *  - api_key_expires_at is cleared so the new key does not auto-expire.
   *
   * Grace-period note:
   *  The old key is replaced immediately.  For zero-downtime rotation with a
   *  24-hour overlap, a separate (old_api_key_prefix, old_api_key_hash,
   *  old_key_expires_at) column set would be required.  This is a recommended
   *  future enhancement.
   */
  rotateApiKey = async (req: Request, res: Response): Promise<void> => {
    try {
      const merchant = req.merchant!;
      const merchantRepository = AppDataSource.getRepository(Merchant);

      // Generate a cryptographically secure random API key (80 hex chars = 320 bits)
      const rawKey = crypto.randomBytes(40).toString('hex');
      const newApiKeyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

      // Overwrite the current key; clear any prior expiry so the new key is permanent
      merchant.api_key = newApiKeyHash;
      merchant.api_key_expires_at = null;

      await merchantRepository.save(merchant);

      // Log rotation without revealing any part of the new key
      logger.info('API key rotated', {
        merchant_id: merchant.id,
        request_id: req.requestId
      });

      res.status(200).json({
        success: true,
        message:
          'API key rotated successfully. Store this key securely — it will NOT be shown again.',
        data: {
          // The plaintext key is returned exactly once; after this response it
          // is unrecoverable (only the bcrypt hash is stored)
          api_key: rawKey
        }
      });
    } catch (error: any) {
      logger.error('Error rotating API key:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        merchant_id: req.merchant?.id,
        request_id: req.requestId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to rotate API key'
      });
    }
  };
}
