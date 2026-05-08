import crypto from 'crypto';
import axios from 'axios';
import { AppDataSource } from '../config/database';
import { WebhookDelivery, WebhookDeliveryStatus } from '../models/WebhookDelivery';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { logger } from '../utils/logger';

// Delay before each attempt: attempt 1 = immediate, 2 = 60s, 3 = 5min
const RETRY_DELAYS_MS = [0, 60_000, 300_000];

export class WebhookQueue {
  private get repository() {
    return AppDataSource.getRepository(WebhookDelivery);
  }

  /**
   * Enqueue a webhook delivery. The first attempt fires immediately.
   */
  async enqueue(
    transaction: Transaction,
    eventType: string,
    pspData: any,
    merchant: Merchant
  ): Promise<void> {
    if (!merchant.webhook_url) return;

    const payload = {
      event: eventType,
      transaction_id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      created_at: transaction.created_at,
      psp_provider: transaction.psp_provider,
      metadata: transaction.metadata,
      original_data: pspData
    };

    const delivery = this.repository.create({
      transaction_id: transaction.id,
      merchant_id: merchant.id,
      event_type: eventType,
      payload,
      webhook_url: merchant.webhook_url,
      webhook_secret: merchant.webhook_secret,
      status: WebhookDeliveryStatus.PENDING,
      next_attempt_at: new Date()
    });

    await this.repository.save(delivery);

    this.scheduleAttempt(delivery.id, 0);
  }

  /**
   * On server startup, re-queue any deliveries that were in-progress
   * when the process last exited. This prevents permanent loss of
   * pending or failed-but-retryable deliveries across restarts.
   */
  async processOrphanedDeliveries(): Promise<void> {
    const orphaned = await this.repository.find({
      where: [
        { status: WebhookDeliveryStatus.PENDING },
        { status: WebhookDeliveryStatus.FAILED }
      ]
    });

    if (orphaned.length === 0) return;

    logger.info(`WebhookQueue: re-scheduling ${orphaned.length} orphaned delivery(ies)`);

    for (const delivery of orphaned) {
      if (delivery.attempts >= delivery.max_attempts) {
        delivery.status = WebhookDeliveryStatus.EXHAUSTED;
        await this.repository.save(delivery);
        continue;
      }
      const delayMs = delivery.next_attempt_at
        ? Math.max(0, delivery.next_attempt_at.getTime() - Date.now())
        : 0;
      this.scheduleAttempt(delivery.id, delayMs);
    }
  }

  private scheduleAttempt(deliveryId: string, delayMs: number): void {
    setTimeout(() => this.attempt(deliveryId), delayMs);
  }

  private async attempt(deliveryId: string): Promise<void> {
    // Always re-fetch so we work with the latest persisted state.
    // This also prevents double-delivery if two processes somehow
    // schedule the same delivery.
    const delivery = await this.repository.findOne({ where: { id: deliveryId } });

    if (
      !delivery ||
      delivery.status === WebhookDeliveryStatus.DELIVERED ||
      delivery.status === WebhookDeliveryStatus.EXHAUSTED
    ) {
      return;
    }

    delivery.attempts += 1;

    try {
      const signature = this.sign(delivery.payload, delivery.webhook_secret || '');

      await axios.post(delivery.webhook_url, delivery.payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature
        },
        timeout: 10_000
      });

      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.delivered_at = new Date();
      await this.repository.save(delivery);

      logger.info(
        `WebhookQueue: delivered ${delivery.event_type} to merchant ${delivery.merchant_id}` +
        ` (attempt ${delivery.attempts})`
      );
    } catch (error: any) {
      delivery.last_error = error.message;

      if (delivery.attempts >= delivery.max_attempts) {
        delivery.status = WebhookDeliveryStatus.EXHAUSTED;
        await this.repository.save(delivery);

        logger.error(
          `WebhookQueue: exhausted all ${delivery.max_attempts} attempts for delivery ${delivery.id}`,
          {
            merchant_id: delivery.merchant_id,
            event_type: delivery.event_type,
            last_error: delivery.last_error
          }
        );
      } else {
        const delayMs = RETRY_DELAYS_MS[delivery.attempts] ?? 300_000;
        delivery.status = WebhookDeliveryStatus.FAILED;
        delivery.next_attempt_at = new Date(Date.now() + delayMs);
        await this.repository.save(delivery);

        logger.warn(
          `WebhookQueue: delivery ${delivery.id} failed (attempt ${delivery.attempts}),` +
          ` retrying in ${delayMs / 1000}s`,
          { last_error: delivery.last_error }
        );

        this.scheduleAttempt(delivery.id, delayMs);
      }
    }
  }

  private sign(payload: Record<string, any>, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }
}

export const webhookQueue = new WebhookQueue();
