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
        logger.error('Moyasar API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info(`Moyasar API Response: ${response.status}`);
        return response;
      },
      (error) => {
        logger.error('Moyasar API Response Error:', error.response?.data || error.message);
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
      logger.error('Moyasar createPayment error:', error);
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
      logger.error('Moyasar getPayment error:', error);
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
      logger.error('Moyasar refundPayment error:', error);
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
      logger.error('Moyasar voidPayment error:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Build Moyasar API payload from our unified format
   */
  private buildPaymentPayload(request: PaymentRequest): any {
    const payload: any = {
      amount: Math.round(request.amount * 100), // Convert to halalas (SAR smallest unit)
      currency: request.currency,
      description: request.description || 'Payment',
      callback_url: request.callback_url
    };

    // Add payment source (card details or token)
    if (request.source) {
      if (request.source.token) {
        // Use saved card token
        payload.source = {
          type: 'token',
          token: request.source.token
        };
      } else if (request.source.number) {
        // Use card details directly
        payload.source = {
          type: request.source.type,
          name: request.source.name,
          number: request.source.number,
          month: request.source.month,
          year: request.source.year,
          cvc: request.source.cvc
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
   * Map Moyasar response to our unified format
   */
  private mapMoyasarResponse(moyasarPayment: any): PaymentResponse {
    return {
      id: moyasarPayment.id,
      status: this.mapStatus(moyasarPayment.status),
      amount: moyasarPayment.amount / 100, // Convert from halalas to SAR
      currency: moyasarPayment.currency,
      fee: moyasarPayment.fee ? moyasarPayment.fee / 100 : undefined,
      source: moyasarPayment.source ? {
        type: moyasarPayment.source.type,
        company: moyasarPayment.source.company,
        name: moyasarPayment.source.name,
        number: moyasarPayment.source.number,
        gateway_id: moyasarPayment.source.gateway_id,
        reference_number: moyasarPayment.source.reference_number,
        token: moyasarPayment.source.token
      } : undefined,
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
    if (error.response) {
      const moyasarError = error.response.data;
      const errorMessage = moyasarError.message || moyasarError.error || 'Unknown Moyasar error';
      const errorType = moyasarError.type || 'moyasar_error';
      
      logger.error(`Moyasar Error [${errorType}]: ${errorMessage}`);
      
      return new Error(`Moyasar Error: ${errorMessage}`);
    }
    
    return error;
  }

  /**
   * Verify webhook signature (for security)
   * @param payload Webhook payload
   * @param signature Signature from Moyasar
   * @param secret Your webhook secret
   */
  static verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const calculatedSignature = hmac.digest('hex');
    
    return calculatedSignature === signature;
  }

  /**
   * Get PSP provider name
   */
  getProviderName(): PSPProvider {
    return PSPProvider.MOYASAR;
  }
}
