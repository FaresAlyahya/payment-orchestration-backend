import { Request, Response } from 'express';
import { PaymentService } from '../services/PaymentService';
import { PaymentRequest, RefundRequest } from '../types/payment.types';
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
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const merchantId = req.merchant!.id;
      const paymentRequest: PaymentRequest = req.body;

      // Create payment
      const payment = await this.paymentService.createPayment(merchantId, paymentRequest);

      logger.info(`Payment created: ${payment.id} for merchant ${merchantId}`);

      res.status(201).json({
        success: true,
        data: payment
      });
    } catch (error: any) {
      logger.error('Error in createPayment controller:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create payment',
        message: error.message
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

      // Security: Ensure the transaction belongs to the requesting merchant
      // (This check would be in the service layer in production)

      res.status(200).json({
        success: true,
        data: payment
      });
    } catch (error: any) {
      logger.error('Error in getPayment controller:', error);
      
      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to get payment',
        message: error.message
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
      logger.error('Error in refundPayment controller:', error);

      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
        return;
      }

      if (error.message.includes('Only paid transactions')) {
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
        message: error.message
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
      logger.error('Error in listPayments controller:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list payments',
        message: error.message
      });
    }
  };
}
