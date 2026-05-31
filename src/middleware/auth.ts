import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/database';
import { Merchant } from '../models/Merchant';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      merchant?: Merchant;
    }
  }
}

/**
 * Extract the plaintext API key from the request.
 * Checks (in order):
 *   1. Authorization: Bearer <key>
 *   2. x-api-key: <key>
 */
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.substring(7).trim();
    if (key) return key;
  }

  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }

  return null;
}

/**
 * Authenticate incoming requests by comparing the provided plaintext API key
 * against the bcrypt hash stored in merchants.api_key.
 *
 * IMPORTANT — bcrypt rules:
 *  - NEVER compare the plaintext key directly to the stored value (strings differ)
 *  - NEVER hash the incoming key and compare strings (salted hashes are unique)
 *  - ALWAYS use bcrypt.compare(plaintext, hash) which handles the salt internally
 *
 * Flow:
 *  1. Extract plaintext key from Authorization: Bearer or x-api-key header
 *  2. Load all active merchants from DB
 *  3. bcrypt.compare(incomingKey, merchant.api_key) for each until a match
 *  4. Reject if key expired or merchant inactive
 *  5. Reject if request IP not in allowed_ips (when list is set)
 *  6. Attach matched merchant to req.merchant
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = extractApiKey(req);

    // --- DEBUG: key reception ---
    logger.info('[auth] Incoming key check', {
      key_received: !!apiKey,
      key_length: apiKey?.length ?? 0,
      key_prefix: apiKey ? apiKey.substring(0, 12) + '...' : 'NONE',
      source: req.headers.authorization ? 'Authorization header' : 'x-api-key header',
      request_id: req.requestId
    });

    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing API key. Send via Authorization: Bearer <key> or x-api-key header.'
      });
      return;
    }

    // Load only active merchants to skip inactive ones early
    const merchantRepository = AppDataSource.getRepository(Merchant);
    const activeMerchants = await merchantRepository.find({
      where: { active: true }
    });

    // --- DEBUG: merchant count ---
    logger.info('[auth] Active merchants loaded', {
      count: activeMerchants.length,
      request_id: req.requestId
    });

    if (activeMerchants.length === 0) {
      logger.warn('[auth] No active merchants in database', { request_id: req.requestId });
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
      return;
    }

    // Find the merchant whose stored bcrypt hash matches the incoming plaintext key.
    // bcrypt.compare handles the salt automatically — do not pre-hash the key.
    let matchedMerchant: Merchant | null = null;

    for (const candidate of activeMerchants) {
      let isMatch = false;
      const hashPrefix = candidate.api_key?.substring(0, 7) ?? 'MISSING';

      try {
        // Validate that the stored value looks like a bcrypt hash before comparing
        if (!candidate.api_key || !candidate.api_key.startsWith('$2')) {
          logger.warn('[auth] Merchant has non-bcrypt api_key value — skipping', {
            merchant_id: candidate.id,
            hash_prefix: hashPrefix,
            request_id: req.requestId
          });
          continue;
        }

        isMatch = await bcrypt.compare(apiKey, candidate.api_key);
      } catch (bcryptErr: any) {
        logger.error('[auth] bcrypt.compare error', {
          merchant_id: candidate.id,
          hash_prefix: hashPrefix,
          error: bcryptErr.message,
          request_id: req.requestId
        });
        continue;
      }

      // --- DEBUG: per-candidate compare result ---
      logger.info('[auth] bcrypt.compare result', {
        merchant_id: candidate.id,
        hash_prefix: hashPrefix,   // e.g. "$2b$12$" — confirms cost factor
        matched: isMatch,
        request_id: req.requestId
      });

      if (isMatch) {
        matchedMerchant = candidate;
        break;
      }
    }

    // Timing-attack guard: always do one dummy compare when no match found
    if (!matchedMerchant) {
      const dummyHash = '$2b$12$invalidhashfortimingprotectiononly000000000000000000000';
      await bcrypt.compare(apiKey, dummyHash).catch(() => {});

      logger.warn('[auth] No matching merchant — returning 401', {
        active_merchants_checked: activeMerchants.length,
        request_id: req.requestId
      });
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
      return;
    }

    // Reject expired keys
    if (matchedMerchant.api_key_expires_at && matchedMerchant.api_key_expires_at < new Date()) {
      logger.warn('[auth] Expired API key', {
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

    // IP whitelist — only enforced when allowed_ips is a non-empty array
    const allowedIps: string[] | null = matchedMerchant.allowed_ips ?? null;
    if (allowedIps && allowedIps.length > 0) {
      const clientIp = req.ip || req.socket?.remoteAddress || '';
      if (!allowedIps.includes(clientIp)) {
        logger.warn('[auth] IP not in whitelist', {
          merchant_id: matchedMerchant.id,
          client_ip: clientIp.replace(/\d+$/, '***'),
          request_id: req.requestId
        });
        res.status(403).json({ error: 'Forbidden', message: 'IP address not authorised.' });
        return;
      }
    }

    req.merchant = matchedMerchant;

    logger.info('[auth] Authenticated successfully', {
      merchant_id: matchedMerchant.id,
      merchant_name: matchedMerchant.name,
      request_id: req.requestId
    });

    next();
  } catch (error) {
    logger.error('[auth] Unexpected authentication error', {
      error,
      request_id: req.requestId
    });
    res.status(500).json({ error: 'Internal Server Error', message: 'Authentication failed' });
  }
};
