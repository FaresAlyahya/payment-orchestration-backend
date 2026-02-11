import { Request, Response, NextFunction } from 'express';
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
 * Middleware to authenticate API requests using merchant API key
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get API key from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid API key. Use: Authorization: Bearer YOUR_API_KEY'
      });
      return;
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Find merchant by API key
    const merchantRepository = AppDataSource.getRepository(Merchant);
    const merchant = await merchantRepository.findOne({
      where: { api_key: apiKey }
    });

    if (!merchant) {
      logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
      return;
    }

    if (!merchant.active) {
      logger.warn(`Inactive merchant attempt: ${merchant.id}`);
      res.status(403).json({
        error: 'Forbidden',
        message: 'Merchant account is inactive'
      });
      return;
    }

    // Attach merchant to request object
    req.merchant = merchant;

    logger.info(`API request authenticated for merchant: ${merchant.name}`);

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
};
