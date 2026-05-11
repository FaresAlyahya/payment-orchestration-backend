import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Middleware: IP whitelist enforcement per merchant.
 *
 * Each merchant may optionally configure an `allowed_ips` JSONB array on their
 * account.  When the list is non-empty, only requests originating from those
 * IP addresses are permitted.  If the list is null or empty, all IPs are
 * allowed (backward-compatible default).
 *
 * Place this middleware AFTER authenticateApiKey so that req.merchant is set.
 *
 * Security note: req.ip honours the `trust proxy` Express setting.  Make sure
 * your deployment sets `app.set('trust proxy', 1)` if the API sits behind a
 * load balancer or reverse proxy so the real client IP is used.
 */
export const ipWhitelistMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const merchant = req.merchant;

  // Should not be reached without auth middleware, but guard defensively
  if (!merchant) {
    next();
    return;
  }

  const allowedIps: string[] | null = merchant.allowed_ips ?? null;

  // Null or empty list → allow all IPs (backward-compatible)
  if (!allowedIps || allowedIps.length === 0) {
    next();
    return;
  }

  const clientIp = req.ip || req.socket?.remoteAddress || '';

  if (allowedIps.includes(clientIp)) {
    next();
    return;
  }

  // Log only masked IP to avoid over-retaining PII in logs
  const maskedIp = clientIp.replace(/\d+$/, '***');
  logger.warn('IP whitelist rejection', {
    merchant_id: merchant.id,
    client_ip: maskedIp,
    request_id: req.requestId
  });

  res.status(403).json({
    error: 'Forbidden',
    message: 'Your IP address is not authorised to access this merchant account.'
  });
};
