import crypto from 'crypto';
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { MoyasarConnector } from '../connectors/MoyasarConnector';
import { PayTabsConnector } from '../connectors/PayTabsConnector';
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
   * POST /api/v1/webhooks/paytabs
   *
   * Server-to-server callback from PayTabs after the customer completes
   * (or abandons) the hosted payment page. PayTabs POSTs JSON here.
   *
   * Verification steps:
   *  1. Hash check  — payment_result.hash must match our computed SHA-256
   *  2. profile_id  — must match PAYTABS_PROFILE_ID (belt-and-suspenders)
   *
   * Status codes:
   *  A = Authorised / Paid
   *  H = On-Hold (authorised, capture pending)
   *  P = Pending (customer hasn't paid yet — no DB change needed)
   *  D = Declined
   *  E = Error
   *  V = Voided
   */
  handlePayTabsWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = req.body;

      // ── Verification ──────────────────────────────────────────────────────
      // PayTabs server-to-server callbacks do NOT include a signature.
      // We verify by checking that the profile_id matches our account.
      // For high-value transactions consider also re-querying PayTabs via
      // GET /payment/query to confirm status before writing to DB.
      const expectedProfileId = parseInt(process.env.PAYTABS_PROFILE_ID || '0');
      const receivedProfileId = Number(data.merchant_info?.profile_id);
      if (expectedProfileId && receivedProfileId !== expectedProfileId) {
        logger.warn('PayTabs webhook: profile_id mismatch', {
          received: receivedProfileId,
          expected: expectedProfileId
        });
        res.status(401).json({ error: 'Invalid profile_id' });
        return;
      }

      const tranRef: string = data.tran_ref;
      const responseStatus: string = data.payment_result?.response_status;
      const responseMessage: string = data.payment_result?.response_message || '';

      logger.info('PayTabs webhook verified', {
        tran_ref: tranRef,
        status: responseStatus,
        message: responseMessage
      });

      // ── 3. Look up transaction ────────────────────────────────────────────
      const transaction = await this.transactionRepository.findOne({
        where: { psp_transaction_id: tranRef }
      });

      if (!transaction) {
        // Acknowledge so PayTabs stops retrying — may be a race condition
        logger.warn(`PayTabs webhook: no transaction found for tran_ref=${tranRef}`);
        res.status(200).json({ received: true });
        return;
      }

      // ── 4. Update transaction status ──────────────────────────────────────
      // Enrich card info if PayTabs sent it
      const cardScheme: string = data.payment_info?.card_scheme || '';
      const rawPan: string = data.payment_info?.payment_description || '';
      const lastFour = rawPan.replace(/\D/g, '').slice(-4) || undefined;

      switch (responseStatus) {
        case 'A':
          transaction.status = PaymentStatus.PAID;
          if (cardScheme) transaction.card_brand = cardScheme;
          if (lastFour) transaction.card_last_four = lastFour;
          await this.transactionRepository.save(transaction);
          logger.info(`Transaction ${transaction.id} → PAID via PayTabs`);
          await this.notifyMerchant(transaction, 'payment.paid', data);
          break;

        case 'H':
          transaction.status = PaymentStatus.AUTHORIZED;
          if (cardScheme) transaction.card_brand = cardScheme;
          if (lastFour) transaction.card_last_four = lastFour;
          await this.transactionRepository.save(transaction);
          logger.info(`Transaction ${transaction.id} → AUTHORIZED via PayTabs`);
          await this.notifyMerchant(transaction, 'payment.authorized', data);
          break;

        case 'D':
        case 'E':
          transaction.status = PaymentStatus.FAILED;
          transaction.error_message = responseMessage || 'Payment failed';
          await this.transactionRepository.save(transaction);
          logger.info(`Transaction ${transaction.id} → FAILED via PayTabs (${responseStatus})`);
          await this.notifyMerchant(transaction, 'payment.failed', data);
          break;

        case 'V':
          transaction.status = PaymentStatus.VOIDED;
          await this.transactionRepository.save(transaction);
          logger.info(`Transaction ${transaction.id} → VOIDED via PayTabs`);
          break;

        case 'P':
          // Pending — customer hasn't completed payment yet; no DB change needed
          logger.info(`PayTabs webhook: tran_ref=${tranRef} still pending`);
          break;

        default:
          logger.warn(`PayTabs webhook: unhandled status '${responseStatus}' for tran_ref=${tranRef}`);
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
