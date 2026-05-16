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
 * PayTabs Payment Gateway Connector
 * Docs: https://site.paytabs.com/en/pt2-documentation/
 *
 * Authentication: Server Key passed as `authorization` header.
 * Region base URL for Saudi Arabia: https://secure.paytabs.sa
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
        // PayTabs authenticates via the authorization header (not Basic Auth)
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
        // Only log safe error metadata — never log raw bodies that may echo card data
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
   * Create a new payment (server-to-server sale transaction)
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const payload = this.buildPaymentPayload(request);
      const response = await this.client.post('/payment/request', payload);
      return this.mapPayTabsResponse(response.data);
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
   * Query payment status by PayTabs transaction reference
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
   * Refund a payment (full or partial)
   *
   * PayTabs refund requires the original tran_ref and the same cart_id and
   * currency as the original transaction.
   */
  async refundPayment(tranRef: string, refundRequest?: RefundRequest): Promise<RefundResponse> {
    try {
      // Query the original transaction to get cart details required for refund
      const original = await this.getPayment(tranRef);

      const refundAmount = refundRequest?.amount ?? original.amount;

      const payload: Record<string, any> = {
        profile_id: this.profileId,
        tran_type: 'refund',
        tran_class: 'ecom',
        tran_ref: tranRef,
        cart_id: `refund_${tranRef}`,
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

  /**
   * Build PayTabs server-to-server payment payload from the unified format.
   *
   * PayTabs requires customer_details even for card payments. We populate
   * them with sensible defaults when the merchant doesn't supply them, since
   * our unified PaymentRequest doesn't carry billing address fields.
   */
  private buildPaymentPayload(request: PaymentRequest): Record<string, any> {
    const cartId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payload: Record<string, any> = {
      profile_id: this.profileId,
      tran_type: 'sale',
      tran_class: 'ecom',
      cart_id: cartId,
      cart_currency: request.currency,
      cart_amount: request.amount,
      cart_description: request.description || 'Payment',
      // PayTabs requires a callback/return URL
      callback: request.callback_url || '',
      return: request.callback_url || ''
    };

    if (request.source && request.source.number) {
      // Server-to-server direct card charge
      // PayTabs requires month as MM string and year as YY (last 2 digits)
      const year = String(request.source.year);
      const shortYear = year.length === 4 ? year.slice(-2) : year;

      payload.payment_info = {
        card_details: {
          pan: request.source.number,
          expiry_month: String(request.source.month).padStart(2, '0'),
          expiry_year: shortYear,
          cvv: String(request.source.cvc),
          cardholder_name: request.source.name || 'Card Holder'
        }
      };

      // Minimal customer_details required by PayTabs even for server-to-server
      payload.customer_details = {
        name: request.source.name || 'Card Holder',
        email: 'customer@placeholder.com',
        phone: '0500000000',
        street1: 'Riyadh',
        city: 'Riyadh',
        state: 'Riyadh',
        country: 'SA',
        zip: '12345'
      };
    }

    if (request.metadata) {
      payload.cart_extra = request.metadata;
    }

    return payload;
  }

  /**
   * Map PayTabs response to the unified PaymentResponse format.
   *
   * PayTabs response_status codes:
   *  A = Authorized / Paid
   *  P = Pending
   *  H = On Hold
   *  V = Voided
   *  E = Error
   *  D = Declined
   */
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
      metadata: data.cart_extra,
      callback_url: data.return_url
    };
  }

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
