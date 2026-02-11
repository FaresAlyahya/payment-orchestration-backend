import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { WebhookController } from '../controllers/WebhookController';
import { authenticateApiKey } from '../middleware/auth';
import { body } from 'express-validator';

const router = Router();
const paymentController = new PaymentController();
const webhookController = new WebhookController();

/**
 * Payment Routes (Protected with API Key)
 */

// Create payment
router.post(
  '/payments',
  authenticateApiKey,
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
  authenticateApiKey,
  paymentController.getPayment
);

// List payments
router.get(
  '/payments',
  authenticateApiKey,
  paymentController.listPayments
);

// Refund payment
router.post(
  '/payments/:id/refund',
  authenticateApiKey,
  [
    body('amount').optional().isNumeric(),
    body('reason').optional().isString()
  ],
  paymentController.refundPayment
);

/**
 * Webhook Routes (Public - no auth, verified by signature)
 */

// Moyasar webhook
router.post(
  '/webhooks/moyasar',
  webhookController.handleMoyasarWebhook
);

export default router;
