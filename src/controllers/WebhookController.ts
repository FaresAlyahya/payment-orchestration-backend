import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { MoyasarConnector } from '../connectors/MoyasarConnector';
import { PaymentStatus } from '../types/payment.types';
import { logger } from '../utils/logger';
import axios from 'axios';

export class WebhookController {
  private transactionRepository = AppDataSource.getRepository(Transaction);
  private merchantRepository = AppDataSource.getRepository(Merchant);

  /**
   * POST /webhooks/moyasar
   * Handle webhooks from Moyasar
   */
  handleMoyasarWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const signature = req.headers['x-moyasar-signature'] as string;
      const payload = JSON.stringify(req.body);

      // Verify webhook signature for security
      const webhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;
      if (webhookSecret && signature) {
        const isValid = MoyasarConnector.verifyWebhookSignature(
          payload,
          signature,
          webhookSecret
        );

        if (!isValid) {
          logger.warn('Invalid Moyasar webhook signature');
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }

      // Process webhook event
      const event = req.body;
      logger.info(`Moyasar webhook received: ${event.type}`);

      // Handle different event types
      switch (event.type) {
        case 'payment_paid':
          await this.handlePaymentPaid(event.data);
          break;
        case 'payment_failed':
          await this.handlePaymentFailed(event.data);
          break;
        case 'payment_refunded':
          await this.handlePaymentRefunded(event.data);
          break;
        default:
          logger.info(`Unhandled webhook event type: ${event.type}`);
      }

      // Acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error('Error handling Moyasar webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  };

  /**
   * Handle payment_paid event
   */
  private async handlePaymentPaid(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      transaction.status = PaymentStatus.PAID;
      await this.transactionRepository.save(transaction);

      logger.info(`Transaction ${transaction.id} marked as PAID`);

      // Forward webhook to merchant
      await this.forwardWebhookToMerchant(transaction, 'payment.paid', paymentData);
    }
  }

  /**
   * Handle payment_failed event
   */
  private async handlePaymentFailed(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      transaction.status = PaymentStatus.FAILED;
      transaction.error_message = paymentData.message || 'Payment failed';
      await this.transactionRepository.save(transaction);

      logger.info(`Transaction ${transaction.id} marked as FAILED`);

      // Forward webhook to merchant
      await this.forwardWebhookToMerchant(transaction, 'payment.failed', paymentData);
    }
  }

  /**
   * Handle payment_refunded event
   */
  private async handlePaymentRefunded(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      // Check if full or partial refund
      const refundAmount = paymentData.refunded_amount / 100;
      if (refundAmount >= transaction.amount) {
        transaction.status = PaymentStatus.REFUNDED;
      } else {
        transaction.status = PaymentStatus.PARTIALLY_REFUNDED;
      }
      await this.transactionRepository.save(transaction);

      logger.info(`Transaction ${transaction.id} marked as REFUNDED`);

      // Forward webhook to merchant
      await this.forwardWebhookToMerchant(transaction, 'payment.refunded', paymentData);
    }
  }

  /**
   * Forward standardized webhook to merchant's webhook URL
   */
  private async forwardWebhookToMerchant(
    transaction: Transaction,
    eventType: string,
    pspData: any
  ): Promise<void> {
    try {
      const merchant = await this.merchantRepository.findOne({
        where: { id: transaction.merchant_id }
      });

      if (!merchant?.webhook_url) {
        logger.info(`No webhook URL configured for merchant ${merchant?.id}`);
        return;
      }

      // Create standardized webhook payload
      const webhookPayload = {
        event: eventType,
        transaction_id: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        created_at: transaction.created_at,
        psp_provider: transaction.psp_provider,
        metadata: transaction.metadata,
        original_data: pspData // Include original PSP data for reference
      };

      // Send webhook to merchant
      await axios.post(merchant.webhook_url, webhookPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': this.generateWebhookSignature(
            webhookPayload,
            merchant.webhook_secret || ''
          )
        },
        timeout: 10000 // 10 second timeout
      });

      logger.info(`Webhook forwarded to merchant ${merchant.id}: ${eventType}`);
    } catch (error: any) {
      logger.error(`Failed to forward webhook to merchant: ${error.message}`);
      // Don't throw - we don't want to fail the webhook processing
    }
  }

  /**
   * Generate HMAC signature for merchant webhook
   */
  private generateWebhookSignature(payload: any, secret: string): string {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }
}
