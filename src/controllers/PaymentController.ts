import { Request, Response } from 'express';
import { PaymentService } from '../services/PaymentService';
import { PaymentRequest, RefundRequest, PaymentMethod } from '../types/payment.types';
import { logger } from '../utils/logger';
import { validationResult } from 'express-validator';

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * POST /api/v1/payments
   * Create a new payment
   */
  createPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      // Log incoming request shape (never log token/card values)
      logger.info('[payments] incoming request', {
        has_auth: !!req.headers.authorization,
        has_api_key: !!req.headers['x-api-key'],
        body_keys: Object.keys(req.body || {}),
        psp: req.body?.psp,
        currency: req.body?.currency,
        amount: req.body?.amount,
        source_type: req.body?.source?.type,
        has_token: !!req.body?.source?.token,
        callback_url: req.body?.callback_url || 'MISSING',
        request_id: req.requestId
      });

      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn('[payments] validation failed', {
          errors: errors.array(),
          request_id: req.requestId
        });
        res.status(400).json({
          success: false,
          message: 'Data validation failed',
          errors: errors.array()
        });
        return;
      }

      const merchantId = req.merchant!.id;
      const paymentRequest: PaymentRequest = req.body;

      // Create payment
      const payment = await this.paymentService.createPayment(merchantId, paymentRequest);

      logger.info(`Payment created: ${payment.id} for merchant ${merchantId}`, {
        railway_id: payment.id,
        status: payment.status,
        has_payment_url: !!payment.payment_url
      });

      res.status(201).json({
        success: true,
        data: {
          ...payment,
          // Explicit alias so the frontend always knows which ID to use for
          // subsequent GET /payments/{id} calls — even after a 3DS redirect
          railway_payment_id: payment.id
        }
      });
    } catch (error: any) {
      logger.error('Error in createPayment controller:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      res.status(500).json({
        success: false,
        error: 'Failed to create payment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * POST /api/v1/payments/charge
   * White-label direct charge — token from paylib.js (PayTabs) or mysr.js (Moyasar)
   * is sent server-to-server to the PSP. No hosted page redirect.
   *
   * Response always includes:
   *   railway_payment_id  — use this for status polling
   *   status              — paid | failed | pending
   *   verification_url    — present only when PSP requires 3DS; open in iframe/modal
   */
  chargePayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
        return;
      }

      const merchantId = req.merchant!.id;
      const { amount, currency, description, psp, token, customer, metadata } = req.body;

      logger.info('[charge] incoming request', {
        psp,
        currency,
        amount,
        has_token: !!token,
        has_customer: !!customer,
        request_id: req.requestId
      });

      const paymentRequest: PaymentRequest = {
        amount,
        currency,
        description: description || 'Payment',
        psp,
        source: {
          type: PaymentMethod.TOKEN,
          token
        },
        metadata: { ...metadata, customer }
      };

      const payment = await this.paymentService.createPayment(merchantId, paymentRequest);

      logger.info('[charge] payment result', {
        railway_id: payment.id,
        status: payment.status,
        has_verification_url: !!payment.payment_url,
        request_id: req.requestId
      });

      res.status(201).json({
        success: true,
        data: {
          railway_payment_id: payment.id,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          // null when no 3DS needed; open in iframe/modal when present
          verification_url: payment.payment_url ?? null
        }
      });
    } catch (error: any) {
      logger.error('[charge] error:', { message: error.message, request_id: req.requestId });
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Charge failed'
      });
    }
  };

  /**
   * GET /api/v1/payments/:id
   * Get payment status
   */
  getPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const payment = await this.paymentService.getPayment(id);

      res.status(200).json({
        success: true,
        data: payment
      });
    } catch (error: any) {
      logger.error('Error in getPayment controller:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to get payment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * POST /api/v1/payments/:id/refund
   * Refund a payment
   */
  refundPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const refundRequest: RefundRequest = req.body;

      const refund = await this.paymentService.refundPayment(id, refundRequest);

      logger.info(`Payment refunded: ${id}`);

      res.status(200).json({
        success: true,
        data: refund
      });
    } catch (error: any) {
      logger.error('Error in refundPayment controller:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
        return;
      }

      if (error instanceof Error && error.message.includes('Only paid transactions')) {
        res.status(400).json({
          success: false,
          error: 'Invalid payment status for refund',
          message: error.message
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to refund payment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * GET /api/v1/payments
   * List all payments for merchant
   */
  listPayments = async (req: Request, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { status, limit, offset } = req.query;

      const transactions = await this.paymentService.getTransactions(merchantId, {
        status: status as any,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined
      });

      res.status(200).json({
        success: true,
        data: transactions,
        count: transactions.length
      });
    } catch (error: any) {
      logger.error('Error in listPayments controller:', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      res.status(500).json({
        success: false,
        error: 'Failed to list payments',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}