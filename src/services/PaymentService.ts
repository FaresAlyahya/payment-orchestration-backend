import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { MoyasarConnector } from '../connectors/MoyasarConnector';
import {
  PaymentRequest,
  PaymentResponse,
  RefundRequest,
  RefundResponse,
  PSPProvider,
  PaymentStatus,
  PaymentMethod
} from '../types/payment.types';
import { logger } from '../utils/logger';

export class PaymentService {
  private transactionRepository = AppDataSource.getRepository(Transaction);
  private moyasarConnector: MoyasarConnector;

  constructor() {
    // Initialize Moyasar connector
    const moyasarApiKey = process.env.MOYASAR_API_KEY || '';
    const moyasarApiUrl = process.env.MOYASAR_API_URL || 'https://api.moyasar.com/v1';
    
    this.moyasarConnector = new MoyasarConnector(moyasarApiKey, moyasarApiUrl);
  }

  /**
   * Create a new payment through the orchestration platform
   */
  async createPayment(merchantId: string, request: PaymentRequest): Promise<PaymentResponse> {
    try {
      // Step 1: Determine which PSP to use (routing logic)
      const selectedPSP = await this.selectPSP(request);
      
      logger.info(`Creating payment via ${selectedPSP} for merchant ${merchantId}`);

      // Step 2: Get the appropriate PSP connector
      const connector = this.getPSPConnector(selectedPSP);

      // Step 3: Create payment with the selected PSP
      const pspResponse = await connector.createPayment(request);

      // Step 4: Save transaction to database
      const transaction = this.transactionRepository.create({
        merchant_id: merchantId,
        psp_provider: selectedPSP,
        psp_transaction_id: pspResponse.id,
        amount: request.amount,
        currency: request.currency,
        status: pspResponse.status,
payment_method: (request.source?.type as PaymentMethod) || PaymentMethod.CREDITCARD,        card_token: pspResponse.source?.token,
        card_brand: pspResponse.source?.company,
        card_last_four: pspResponse.source?.number?.slice(-4),
        description: request.description,
        metadata: request.metadata,
        callback_url: request.callback_url
      });

      await this.transactionRepository.save(transaction);

      logger.info(`Payment created successfully: ${transaction.id}`);

      return {
        ...pspResponse,
        id: transaction.id // Return our internal transaction ID
      };
    } catch (error: any) {
      logger.error('Error creating payment:', error);
      throw new Error(`Failed to create payment: ${error.message}`);
    }
  }

  /**
   * Get payment status by our internal transaction ID
   */
  async getPayment(transactionId: string): Promise<PaymentResponse> {
    try {
      const transaction = await this.transactionRepository.findOne({
        where: { id: transactionId }
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      // Get latest status from PSP
      const connector = this.getPSPConnector(transaction.psp_provider);
      const pspResponse = await connector.getPayment(transaction.psp_transaction_id);

      // Update transaction status if changed
      if (pspResponse.status !== transaction.status) {
        transaction.status = pspResponse.status;
        await this.transactionRepository.save(transaction);
      }

      return {
        ...pspResponse,
        id: transaction.id
      };
    } catch (error: any) {
      logger.error('Error getting payment:', error);
      throw new Error(`Failed to get payment: ${error.message}`);
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    transactionId: string,
    refundRequest?: RefundRequest
  ): Promise<RefundResponse> {
    try {
      const transaction = await this.transactionRepository.findOne({
        where: { id: transactionId }
      });

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      if (transaction.status !== PaymentStatus.PAID) {
        throw new Error('Only paid transactions can be refunded');
      }

      // Process refund with PSP
      const connector = this.getPSPConnector(transaction.psp_provider);
      const refundResponse = await connector.refundPayment(
        transaction.psp_transaction_id,
        refundRequest
      );

      // Update transaction status
      const refundAmount = refundRequest?.amount || transaction.amount;
      if (refundAmount >= transaction.amount) {
        transaction.status = PaymentStatus.REFUNDED;
      } else {
        transaction.status = PaymentStatus.PARTIALLY_REFUNDED;
      }
      await this.transactionRepository.save(transaction);

      logger.info(`Payment refunded: ${transactionId}`);

      return refundResponse;
    } catch (error: any) {
      logger.error('Error refunding payment:', error);
      throw new Error(`Failed to refund payment: ${error.message}`);
    }
  }

  /**
   * Smart routing logic to select the best PSP
   * This is a simplified version - you can enhance it based on your routing rules
   */
  private async selectPSP(request: PaymentRequest): Promise<PSPProvider> {
    // For MVP, we'll use Moyasar as default
    // In production, you would:
    // 1. Check routing rules from database
    // 2. Consider card type (Mada vs international)
    // 3. Check PSP success rates
    // 4. Consider fees
    // 5. Implement failover logic

    // Simple example: Route Mada cards to Moyasar
    if (request.source?.type === 'mada') {
      return PSPProvider.MOYASAR;
    }

    // Default to Moyasar
    return PSPProvider.MOYASAR;
  }

  /**
   * Get the appropriate PSP connector based on provider
   */
  private getPSPConnector(provider: PSPProvider): MoyasarConnector {
    switch (provider) {
      case PSPProvider.MOYASAR:
        return this.moyasarConnector;
      // Add other PSPs here as you integrate them
      // case PSPProvider.HYPERPAY:
      //   return this.hyperpayConnector;
      // case PSPProvider.TAP:
      //   return this.tapConnector;
      default:
        throw new Error(`Unsupported PSP provider: ${provider}`);
    }
  }

  /**
   * Get transactions for a merchant with filters
   */
  async getTransactions(
    merchantId: string,
    filters?: {
      status?: PaymentStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<Transaction[]> {
    const query = this.transactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.merchant_id = :merchantId', { merchantId });

    if (filters?.status) {
      query.andWhere('transaction.status = :status', { status: filters.status });
    }

    query
      .orderBy('transaction.created_at', 'DESC')
      .limit(filters?.limit || 50)
      .offset(filters?.offset || 0);

    return await query.getMany();
  }
}
