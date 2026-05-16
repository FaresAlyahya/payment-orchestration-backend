import crypto from 'crypto';
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { MoyasarConnector } from '../connectors/MoyasarConnector';
import { PaymentStatus } from '../types/payment.types';
import { logger } from '../utils/logger';
import { webhookQueue } from '../services/WebhookQueue';

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

      // Webhook signature verification is mandatory — reject if not configured or missing
      const webhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;
      if (!webhookSecret) {
        logger.error('MOYASAR_WEBHOOK_SECRET is not configured — rejecting webhook');
        res.status(500).json({ error: 'Webhook verification not configured' });
        return;
      }

      if (!signature) {
        logger.warn('Moyasar webhook received without signature');
        res.status(401).json({ error: 'Missing webhook signature' });
        return;
      }

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

      // Process webhook event
      const event = req.body;
      logger.info(`Moyasar webhook received: ${event.type}`);

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

      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error('Error handling Moyasar webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  };

  private async handlePaymentPaid(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      transaction.status = PaymentStatus.PAID;
      await this.transactionRepository.save(transaction);
      logger.info(`Transaction ${transaction.id} marked as PAID`);
      await this.notifyMerchant(transaction, 'payment.paid', paymentData);
    }
  }

  private async handlePaymentFailed(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      transaction.status = PaymentStatus.FAILED;
      transaction.error_message = paymentData.message || 'Payment failed';
      await this.transactionRepository.save(transaction);
      logger.info(`Transaction ${transaction.id} marked as FAILED`);
      await this.notifyMerchant(transaction, 'payment.failed', paymentData);
    }
  }

  private async handlePaymentRefunded(paymentData: any): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { psp_transaction_id: paymentData.id }
    });

    if (transaction) {
      const refundAmount = paymentData.refunded_amount / 100;
      transaction.status =
        refundAmount >= transaction.amount
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;
      await this.transactionRepository.save(transaction);
      logger.info(`Transaction ${transaction.id} marked as REFUNDED`);
      await this.notifyMerchant(transaction, 'payment.refunded', paymentData);
    }
  }

  /**
   * POST /webhooks/paytabs
   *
   * PayTabs POSTs the payment result to PAYTABS_CALLBACK_URL after the
   * customer completes (or abandons) the hosted payment page.
   *
   * Payload fields used:
   *  tran_ref                        — PayTabs transaction reference (our psp_transaction_id)
   *  payment_result.response_status  — A=Paid, D=Declined, E=Error, V=Voided
   *  payment_result.response_message — human-readable result
   *  cart_amount / cart_currency     — for refund amount comparison
   *
   * PayTabs does not send an HMAC signature by default on the callback. We
   * verify by checking the profile_id matches our configured value, and
   * optionally re-query PayTabs to confirm status before updating the DB.
   */
  handlePayTabsWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = req.body;

      // Basic integrity check — reject if profile_id doesn't match ours
      const expectedProfileId = parseInt(process.env.PAYTABS_PROFILE_ID || '0');
      if (expectedProfileId && data.merchant_info?.profile_id !== expectedProfileId) {
        logger.warn('PayTabs webhook profile_id mismatch', {
          received: data.merchant_info?.profile_id,
          expected: expectedProfileId
        });
        res.status(401).json({ error: 'Invalid profile_id' });
        return;
      }

      const tranRef: string = data.tran_ref;
      const responseStatus: string = data.payment_result?.response_status;

      logger.info(`PayTabs webhook received: tran_ref=${tranRef} status=${responseStatus}`);

      const transaction = await this.transactionRepository.findOne({
        where: { psp_transaction_id: tranRef }
      });

      if (!transaction) {
        logger.warn(`PayTabs webhook: no transaction found for tran_ref=${tranRef}`);
        res.status(200).json({ received: true }); // Acknowledge to stop retries
        return;
      }

      if (responseStatus === 'A') {
        transaction.status = PaymentStatus.PAID;
        await this.transactionRepository.save(transaction);
        logger.info(`Transaction ${transaction.id} marked as PAID via PayTabs`);
        await this.notifyMerchant(transaction, 'payment.paid', data);
      } else if (responseStatus === 'D' || responseStatus === 'E') {
        transaction.status = PaymentStatus.FAILED;
        transaction.error_message = data.payment_result?.response_message || 'Payment failed';
        await this.transactionRepository.save(transaction);
        logger.info(`Transaction ${transaction.id} marked as FAILED via PayTabs`);
        await this.notifyMerchant(transaction, 'payment.failed', data);
      } else if (responseStatus === 'V') {
        transaction.status = PaymentStatus.VOIDED;
        await this.transactionRepository.save(transaction);
        logger.info(`Transaction ${transaction.id} marked as VOIDED via PayTabs`);
      } else {
        logger.info(`PayTabs webhook: unhandled status ${responseStatus} for tran_ref=${tranRef}`);
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error('Error handling PayTabs webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  };

  /**
   * Look up the merchant and enqueue a webhook delivery.
   * Failures are handled by WebhookQueue with retries — do not throw here.
   */
  private async notifyMerchant(
    transaction: Transaction,
    eventType: string,
    pspData: any
  ): Promise<void> {
    const merchant = await this.merchantRepository.findOne({
      where: { id: transaction.merchant_id }
    });

    if (!merchant?.webhook_url) {
      logger.info(`No webhook URL configured for merchant ${transaction.merchant_id}`);
      return;
    }

    await webhookQueue.enqueue(transaction, eventType, pspData, merchant);
  }
}
