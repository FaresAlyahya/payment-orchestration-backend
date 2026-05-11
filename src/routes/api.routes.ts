import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { WebhookController } from '../controllers/WebhookController';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { MerchantController } from '../controllers/MerchantController';
import { authenticateApiKey } from '../middleware/auth';
import { ipWhitelistMiddleware } from '../middleware/ipWhitelist';
import { paymentsLimiter, analyticsLimiter } from '../middleware/rateLimiter';
import { body } from 'express-validator';

const router = Router();
const paymentController = new PaymentController();
const webhookController = new WebhookController();
const analyticsController = new AnalyticsController();
const merchantController = new MerchantController();

// ---------------------------------------------------------------------------
// Shared middleware chain for authenticated merchant routes
// Order matters:
//  1. authenticateApiKey  — verify key, attach req.merchant
//  2. ipWhitelistMiddleware — check IP against merchant's allowed list
//  3. endpoint-specific rate limiter — keyed by merchant ID (needs req.merchant)
// ---------------------------------------------------------------------------
const merchantAuth = [authenticateApiKey, ipWhitelistMiddleware];

/**
 * Payment Routes (protected)
 */

// Create payment
router.post(
  '/payments',
  ...merchantAuth,
  paymentsLimiter,
  [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('currency').isIn(['SAR', 'USD', 'AED']).withMessage('Invalid currency'),
    body('description').optional().isString(),
    body('source').optional().isObject(),
    body('metadata').optional().isObject()
  ],
  paymentController.createPayment
);

// Get payment by ID
router.get(
  '/payments/:id',
  ...merchantAuth,
  paymentsLimiter,
  paymentController.getPayment
);

// List payments
router.get(
  '/payments',
  ...merchantAuth,
  paymentsLimiter,
  paymentController.listPayments
);

// Refund payment
router.post(
  '/payments/:id/refund',
  ...merchantAuth,
  paymentsLimiter,
  [
    body('amount').optional().isNumeric(),
    body('reason').optional().isString()
  ],
  paymentController.refundPayment
);

/**
 * Analytics Routes (protected)
 */
router.get(
  '/analytics',
  ...merchantAuth,
  analyticsLimiter,
  analyticsController.getAnalytics
);

/**
 * Merchant Management Routes (protected)
 */

// Rotate API key — returns the new plaintext key exactly once
router.post(
  '/merchants/rotate-key',
  ...merchantAuth,
  merchantController.rotateApiKey
);

/**
 * Webhook Routes (public — no API key auth, verified by HMAC signature)
 */
router.post(
  '/webhooks/moyasar',
  webhookController.handleMoyasarWebhook
);

export default router;
