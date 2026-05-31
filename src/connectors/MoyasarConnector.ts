import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import {
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  PaymentStatus,
  PSPProvider
} from '../types/payment.types';
import { logger } from '../utils/logger';

/**
 * Moyasar Payment Gateway Connector
 * Official API Docs: https://docs.moyasar.com/
 *
 * Token flow (unified checkout — recommended):
 *  Frontend includes Moyasar JS SDK and renders its own card form.
 *  The SDK tokenises the card client-side and returns a source token.
 *  Frontend sends { source: { type: "creditcard", token: "TOKEN" } } to backend.
 *  Backend charges the token via this connector — no card data touches our server.
 *
 *  Frontend setup:
 *    <script src="https://cdn.moyasar.com/mpf/1.14.1/moyasar.js"></script>
 *    Moyasar.init({
 *      element: '.mysr-form',
 *      amount: 10000,           // in halalas
 *      currency: 'SAR',
 *      description: 'Payment',
 *      publishable_api_key: 'YOUR_PUBLISHABLE_KEY',
 *      callback_url: 'https://your-backend.com/api/v1/payments',
 *    });
 *    // On success, Moyasar calls callback_url with ?token=TOKEN
 *    // Extract the token and POST it as source.token to our /payments endpoint
 */
export class MoyasarConnector {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string = 'https://api.moyasar.com/v1') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;

    // Create Axios instance with authentication
    this.client = axios.create({
      baseURL: this.baseURL,
      auth: {
        username: this.apiKey,
        password: '' // Moyasar uses Basic Auth with API key as username
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.info(`Moyasar API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Moyasar API Request Error:', { message: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info(`Moyasar API Response: ${response.status}`);
        return response;
      },
      (error) => {
        // Only log safe error metadata — never log raw response bodies which
        // may contain card data echoed back in validation error messages.
        logger.error('Moyasar API Response Error:', {
          status: error.response?.status,
          error_type: error.response?.data?.type,
          error_message: error.response?.data?.message,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Create a new payment
   * @param request Payment request details
   * @returns Payment response from Moyasar
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      const payload = this.buildPaymentPayload(request);
      
      const response = await this.client.post('/payments', payload);
      
      return this.mapMoyasarResponse(response.data);
    } catch (error: any) {
      // Do NOT log the request payload — it may contain card/token data
      logger.error('Moyasar createPayment error:', {
        status: error.response?.status,
        error_type: error.response?.data?.type,
        error_message: error.response?.data?.message,
        // Log field-level validation errors if present (no card data in these)
        errors: error.response?.data?.errors
          ? JSON.stringify(error.response.data.errors)
          : undefined,
        message: error.message
      });
      throw this.handleError(error);
    }
  }

  /**
   * Get payment status by ID
   * @param paymentId Moyasar payment ID
   * @returns Payment details
   */
  async getPayment(paymentId: string): Promise<PaymentResponse> {
    try {
      const response = await this.client.get(`/payments/${paymentId}`);
      
      return this.mapMoyasarResponse(response.data);
    } catch (error: any) {
      logger.error('Moyasar getPayment error:', {
        message: error.message,
        status: error.response?.status
      });
      throw this.handleError(error);
    }
  }

  /**
   * Refund a payment (full or partial)
   * @param paymentId Moyasar payment ID
   * @param refundRequest Refund details
   * @returns Refund response
   */
  async refundPayment(paymentId: string, refundRequest?: RefundRequest): Promise<RefundResponse> {
    try {
      const payload: any = {};
      
      if (refundRequest?.amount) {
        payload.amount = Math.round(refundRequest.amount * 100); // Convert to halalas
      }
      
      if (refundRequest?.reason) {
        payload.description = refundRequest.reason;
      }

      const response = await this.client.post(`/payments/${paymentId}/refund`, payload);
      
      return {
        id: response.data.id,
        payment_id: paymentId,
        amount: response.data.amount / 100, // Convert from halalas
        status: response.data.status,
        created_at: response.data.created_at
      };
    } catch (error: any) {
      logger.error('Moyasar refundPayment error:', {
        message: error.message,
        status: error.response?.status
      });
      throw this.handleError(error);
    }
  }

  /**
   * Void/Cancel a payment (only for authorized but not captured payments)
   * @param paymentId Moyasar payment ID
   */
  async voidPayment(paymentId: string): Promise<void> {
    try {
      await this.client.post(`/payments/${paymentId}/void`);
    } catch (error: any) {
      logger.error('Moyasar voidPayment error:', {
        message: error.message,
        status: error.response?.status
      });
      throw this.handleError(error);
    }
  }

  /**
   * Build Moyasar API payload from our unified format
   */
  private buildPaymentPayload(request: PaymentRequest): any {
    // callback_url is required by Moyasar — fall back to env var if not in the request
    const callbackUrl =
      request.callback_url ||
      process.env.MOYASAR_CALLBACK_URL ||
      `${process.env.FRONTEND_URL || 'https://flowpay-test.lovable.app'}/payment-result`;

    const payload: any = {
      amount: Math.round(request.amount * 100), // Convert to halalas (SAR smallest unit)
      currency: request.currency,
      description: request.description || 'Payment',
      callback_url: callbackUrl
    };

    // Add payment source (card details or token)
    if (request.source) {
      if (request.source.token) {
        // Pass source.type and token through as-is — Moyasar accepts:
        //   type:'token'      for saved card tokens (mToken)
        //   type:'creditcard' for checkout form tokens (mysr.js)
        payload.source = {
          type: request.source.type,
          token: request.source.token
        };
      } else if (request.source.number) {
        // Use card details directly
        // Moyasar requires month and year as strings ("12", "2027")
        payload.source = {
          type: request.source.type,
          name: request.source.name,
          number: request.source.number,
          month: String(request.source.month),
          year: String(request.source.year),
          cvc: String(request.source.cvc)
        };
      }
    }

    // Add metadata
    if (request.metadata) {
      payload.metadata = request.metadata;
    }

    return payload;
  }

  /**
   * Map Moyasar response to our unified format.
   *
   * Security note: Moyasar returns a masked card number (e.g. "XXXX XXXX XXXX 1234").
   * We store only the last-four digits and card brand — never the full or partially
   * masked number — to minimise sensitive data surface in our DB and logs.
   */
  private mapMoyasarResponse(moyasarPayment: any): PaymentResponse {
    const rawNumber: string | undefined = moyasarPayment.source?.number;
    // Extract only the last 4 digits from whatever masked format Moyasar returns
    const lastFour = rawNumber ? rawNumber.replace(/\D/g, '').slice(-4) : undefined;

    return {
      id: moyasarPayment.id,
      status: this.mapStatus(moyasarPayment.status),
      amount: moyasarPayment.amount / 100, // Convert from halalas to SAR
      currency: moyasarPayment.currency,
      fee: moyasarPayment.fee ? moyasarPayment.fee / 100 : undefined,
      source: moyasarPayment.source
        ? {
            type: moyasarPayment.source.type,
            company: moyasarPayment.source.company,
            // Only expose last-four — never the full or masked card number
            number: lastFour ? `****${lastFour}` : undefined,
            gateway_id: moyasarPayment.source.gateway_id,
            reference_number: moyasarPayment.source.reference_number,
            token: moyasarPayment.source.token
          }
        : undefined,
      created_at: moyasarPayment.created_at,
      updated_at: moyasarPayment.updated_at,
      description: moyasarPayment.description,
      metadata: moyasarPayment.metadata,
      callback_url: moyasarPayment.callback_url
    };
  }

  /**
   * Map Moyasar payment status to our unified status
   */
  private mapStatus(moyasarStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'initiated': PaymentStatus.PENDING,
      'pending': PaymentStatus.PENDING,
      'processing': PaymentStatus.PROCESSING,
      'authorized': PaymentStatus.AUTHORIZED,
      'paid': PaymentStatus.PAID,
      'failed': PaymentStatus.FAILED,
      'refunded': PaymentStatus.REFUNDED,
      'partially_refunded': PaymentStatus.PARTIALLY_REFUNDED,
      'voided': PaymentStatus.VOIDED
    };

    return statusMap[moyasarStatus] || PaymentStatus.FAILED;
  }

  /**
   * Handle and format errors from Moyasar API
   */
  private handleError(error: any): Error {
    if (error.response?.data) {
      const moyasarError = error.response.data;
      const errorMessage = moyasarError.message || moyasarError.error || 'Unknown Moyasar error';
      const errorType = moyasarError.type || 'moyasar_error';
      
      logger.error(`Moyasar Error [${errorType}]: ${errorMessage}`);
      
      return new Error(`Moyasar Error: ${errorMessage}`);
    }
    
    return new Error(error.message || 'Moyasar API error');
  }

  /**
   * Verify webhook signature (for security)
   * @param payload Webhook payload
   * @param signature Signature from Moyasar
   * @param secret Your webhook secret
   */
  static verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const calculatedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(calculatedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  }

  /**
   * Get PSP provider name
   */
  getProviderName(): PSPProvider {
    return PSPProvider.MOYASAR;
  }
}