import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { WebhookController } from '../controllers/WebhookController';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { MerchantController } from '../controllers/MerchantController';
import { RoutingController } from '../controllers/RoutingController';
import { authenticateApiKey } from '../middleware/auth';
import { ipWhitelistMiddleware } from '../middleware/ipWhitelist';
import { paymentsLimiter, analyticsLimiter } from '../middleware/rateLimiter';
import { body } from 'express-validator';

const router = Router();
const paymentController = new PaymentController();
const webhookController = new WebhookController();
const analyticsController = new AnalyticsController();
const merchantController = new MerchantController();
const routingController = new RoutingController();

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

// White-label direct charge (own form / paylib.js / mysr.js token)
router.post(
  '/payments/charge',
  ...merchantAuth,
  paymentsLimiter,
  [
    body('amount').isNumeric().withMessage('amount is required'),
    body('currency').isIn(['SAR', 'USD', 'AED']).withMessage('Invalid currency'),
    body('psp').isIn(['moyasar', 'paytabs']).withMessage('psp is required: moyasar or paytabs'),
    body('token').notEmpty().withMessage('token is required (from paylib.js or mysr.js)'),
    body('description').optional().isString(),
    body('customer').optional().isObject(),
    body('metadata').optional().isObject()
  ],
  paymentController.chargePayment
);

// Create payment (smart routing — token optional, may return redirect for hosted page)
router.post(
  '/payments',
  ...merchantAuth,
  paymentsLimiter,
  [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('currency').isIn(['SAR', 'USD', 'AED']).withMessage('Invalid currency'),
    body('psp').optional().isIn(['moyasar', 'paytabs']).withMessage('Invalid PSP — use moyasar or paytabs'),
    body('description').optional().isString(),
    body('source').optional().isObject(),
    body('source.type').optional().isString(),
    body('source.token').optional().isString(),
    body('callback_url').optional().isURL().withMessage('callback_url must be a valid URL'),
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
 * Routing Rules (protected)
 */
router.get('/routing-rules', ...merchantAuth, routingController.listRules);
router.post('/routing-rules', ...merchantAuth, routingController.createRule);
router.post('/routing-rules/simulate', ...merchantAuth, routingController.simulateRouting);
router.put('/routing-rules/:id', ...merchantAuth, routingController.updateRule);
router.delete('/routing-rules/:id', ...merchantAuth, routingController.deleteRule);

/**
 * Webhook Routes (public — no API key auth, verified per-PSP)
 */
router.post('/webhooks/moyasar', webhookController.handleMoyasarWebhook);
router.post('/webhooks/paytabs', webhookController.handlePayTabsWebhook);

export default router;
