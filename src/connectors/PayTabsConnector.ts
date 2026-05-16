import axios, { AxiosInstance } from 'axios';
import {
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  PaymentStatus,
  PaymentMethod,
  PSPProvider,
  Currency
} from '../types/payment.types';
import { logger } from '../utils/logger';

/**
 * PayTabs Payment Gateway Connector — Hosted Payment Page flow
 * Docs: https://site.paytabs.com/en/pt2-documentation/
 *
 * Flow:
 *  1. POST /payment/request  → PayTabs returns a redirect_url (hosted page)
 *  2. Client opens redirect_url and completes payment on PayTabs' page
 *  3. PayTabs POSTs the result to our PAYTABS_CALLBACK_URL (webhook)
 *  4. We update the transaction status from the webhook
 *
 * Authentication: Server Key in the `authorization` header.
 */
export class PayTabsConnector {
  private client: AxiosInstance;
  private profileId: number;

  constructor(
    serverKey: string,
    profileId: number,
    baseURL: string = 'https://secure.paytabs.sa'
  ) {
    this.profileId = profileId;

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        authorization: serverKey
      }
    });

    this.client.interceptors.request.use(
      (config) => {
        logger.info(`PayTabs API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('PayTabs API Request Error:', { message: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info(`PayTabs API Response: ${response.status}`);
        return response;
      },
      (error) => {
        logger.error('PayTabs API Response Error:', {
          status: error.response?.status,
          response_code: error.response?.data?.payment_result?.response_code,
          response_message: error.response?.data?.payment_result?.response_message,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Request a hosted payment page from PayTabs.
   *
   * Returns a PaymentResponse where `payment_url` is the URL the client must
   * open to complete payment. Status is PENDING until PayTabs sends a webhook.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const cartId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const payload: Record<string, any> = {
        profile_id: this.profileId,
        tran_type: 'sale',
        tran_class: 'ecom',
        cart_id: cartId,
        cart_currency: request.currency,
        cart_amount: request.amount,
        cart_description: request.description || 'Payment',
        // callback: where PayTabs POSTs the payment result (our webhook endpoint)
        callback: process.env.PAYTABS_CALLBACK_URL || '',
        // return: where PayTabs redirects the customer after they finish
        return: process.env.PAYTABS_RETURN_URL || request.callback_url || ''
      };

      if (request.metadata) {
        payload.cart_extra = request.metadata;
      }

      const response = await this.client.post('/payment/request', payload);
      const data = response.data;

      logger.info('PayTabs hosted page created', {
        tran_ref: data.tran_ref,
        cart_id: cartId
      });

      return {
        id: data.tran_ref,
        status: PaymentStatus.PENDING,
        amount: request.amount,
        currency: request.currency,
        description: request.description,
        metadata: request.metadata,
        callback_url: request.callback_url,
        created_at: new Date().toISOString(),
        // The client must redirect to this URL to complete payment
        payment_url: data.redirect_url
      };
    } catch (error: any) {
      logger.error('PayTabs createPayment error:', {
        status: error.response?.status,
        response_code: error.response?.data?.payment_result?.response_code,
        response_message: error.response?.data?.payment_result?.response_message,
        message: error.message
      });
      throw this.handleError(error);
    }
  }

  /**
   * Query payment status by PayTabs transaction reference (tran_ref)
   */
  async getPayment(tranRef: string): Promise<PaymentResponse> {
    try {
      const response = await this.client.post('/payment/query', {
        profile_id: this.profileId,
        tran_ref: tranRef
      });
      return this.mapPayTabsResponse(response.data);
    } catch (error: any) {
      logger.error('PayTabs getPayment error:', {
        status: error.response?.status,
        message: error.message
      });
      throw this.handleError(error);
    }
  }

  /**
   * Refund a payment (full or partial).
   *
   * PayTabs refund is a new transaction of type "refund" referencing the
   * original tran_ref.
   */
  async refundPayment(tranRef: string, refundRequest?: RefundRequest): Promise<RefundResponse> {
    try {
      const original = await this.getPayment(tranRef);
      const refundAmount = refundRequest?.amount ?? original.amount;

      const payload: Record<string, any> = {
        profile_id: this.profileId,
        tran_type: 'refund',
        tran_class: 'ecom',
        tran_ref: tranRef,
        cart_id: `refund_${tranRef}_${Date.now()}`,
        cart_currency: original.currency,
        cart_amount: refundAmount,
        cart_description: refundRequest?.reason || 'Refund'
      };

      const response = await this.client.post('/payment/request', payload);
      const data = response.data;

      return {
        id: data.tran_ref,
        payment_id: tranRef,
        amount: refundAmount,
        status: data.payment_result?.response_status === 'A' ? 'refunded' : 'failed',
        created_at: new Date().toISOString()
      };
    } catch (error: any) {
      logger.error('PayTabs refundPayment error:', {
        status: error.response?.status,
        message: error.message
      });
      throw this.handleError(error);
    }
  }

  getProviderName(): PSPProvider {
    return PSPProvider.PAYTABS;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mapPayTabsResponse(data: any): PaymentResponse {
    const rawPan: string | undefined = data.payment_info?.payment_description;
    const lastFour = rawPan ? rawPan.replace(/\D/g, '').slice(-4) : undefined;

    return {
      id: data.tran_ref,
      status: this.mapStatus(data.payment_result?.response_status),
      amount: parseFloat(data.cart_amount ?? '0'),
      currency: (data.cart_currency as Currency) || Currency.SAR,
      source: {
        type: this.mapCardScheme(data.payment_info?.card_scheme),
        company: data.payment_info?.card_type,
        number: lastFour ? `****${lastFour}` : undefined
      },
      created_at: new Date().toISOString(),
      description: data.cart_description,
      metadata: data.cart_extra
    };
  }

  /**
   * PayTabs response_status codes:
   *  A = Authorized / Paid
   *  P = Pending (customer hasn't paid yet)
   *  H = On Hold / Authorized (capture pending)
   *  V = Voided
   *  E = Error
   *  D = Declined
   */
  private mapStatus(responseStatus: string | undefined): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      A: PaymentStatus.PAID,
      P: PaymentStatus.PENDING,
      H: PaymentStatus.AUTHORIZED,
      V: PaymentStatus.VOIDED,
      E: PaymentStatus.FAILED,
      D: PaymentStatus.FAILED
    };
    return map[responseStatus ?? ''] ?? PaymentStatus.FAILED;
  }

  private mapCardScheme(scheme: string | undefined): PaymentMethod {
    const s = (scheme || '').toLowerCase();
    if (s.includes('mada')) return PaymentMethod.MADA;
    return PaymentMethod.CREDITCARD;
  }

  private handleError(error: any): Error {
    const msg =
      error.response?.data?.payment_result?.response_message ||
      error.response?.data?.message ||
      error.message ||
      'PayTabs API error';
    logger.error(`PayTabs Error: ${msg}`);
    return new Error(`PayTabs Error: ${msg}`);
  }
}
