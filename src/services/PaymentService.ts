import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { MoyasarConnector } from '../connectors/MoyasarConnector';
import { PayTabsConnector } from '../connectors/PayTabsConnector';
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
  private payTabsConnector: PayTabsConnector;

  constructor() {
    this.moyasarConnector = new MoyasarConnector(
      process.env.MOYASAR_API_KEY || '',
      process.env.MOYASAR_API_URL || 'https://api.moyasar.com/v1'
    );

    this.payTabsConnector = new PayTabsConnector(
      process.env.PAYTABS_SERVER_KEY || '',
      parseInt(process.env.PAYTABS_PROFILE_ID || '0'),
      process.env.PAYTABS_API_URL || 'https://secure.paytabs.sa'
    );
  }

  /**
   * Create a new payment through the orchestration platform
   */
  async createPayment(merchantId: string, request: PaymentRequest): Promise<PaymentResponse> {
    const selectedPSP = await this.selectPSP(request);
    const connector = this.getPSPConnector(selectedPSP);

    // Pre-save a PENDING record before calling the PSP.
    // This guarantees a local record exists even if the PSP call succeeds
    // but the subsequent DB update fails — enabling reconciliation either way.
    const transaction = this.transactionRepository.create({
      merchant_id: merchantId,
      psp_provider: selectedPSP,
      amount: request.amount,
      currency: request.currency,
      status: PaymentStatus.PENDING,
      payment_method: (request.source?.type as PaymentMethod) || PaymentMethod.CREDITCARD,
      description: request.description,
      metadata: request.metadata,
      callback_url: request.callback_url
    });
    await this.transactionRepository.save(transaction);

    logger.info(`Creating payment via ${selectedPSP} for merchant ${merchantId} [txn: ${transaction.id}]`);

    // Call the PSP — this cannot be wrapped in a DB transaction because
    // external HTTP calls can't be rolled back.
    let pspResponse: PaymentResponse;
    try {
      pspResponse = await connector.createPayment(request);
    } catch (pspError: any) {
      // PSP rejected the payment — mark our record FAILED and surface the error.
      transaction.status = PaymentStatus.FAILED;
      transaction.error_message = pspError.response?.data?.message || pspError.message;
      await this.transactionRepository.save(transaction);

      throw new Error(transaction.error_message || 'Failed to create payment');
    }

    // Update the pre-created record with the PSP result.
    try {
      transaction.psp_transaction_id = pspResponse.id;
      transaction.status = pspResponse.status;
      transaction.card_brand = pspResponse.source?.company;
      transaction.card_last_four = pspResponse.source?.number?.slice(-4);
      await this.transactionRepository.save(transaction);
    } catch (dbError: any) {
      // The payment went through at the PSP but we couldn't persist the result.
      // The PENDING record (id: transaction.id) + PSP id below are sufficient
      // for automated or manual reconciliation.
      logger.error('CRITICAL: PSP payment created but DB update failed — reconciliation required', {
        internal_transaction_id: transaction.id,
        psp_transaction_id: pspResponse.id,
        psp_provider: selectedPSP,
        merchant_id: merchantId,
        error: dbError.message
      });
      // Still return success — the payment did go through at the PSP.
    }

    logger.info(`Payment created: internal=${transaction.id} psp=${pspResponse.id}`);
    return { ...pspResponse, id: transaction.id };
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
      logger.error('Error getting payment:', {
        message: error.message
      });
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
      logger.error('Error refunding payment:', {
        message: error.message,
        status: error.response?.status
      });
      throw new Error(
        error.response?.data?.message || 
        error.message || 
        'Failed to refund payment'
      );
    }
  }

  /**
   * Select which PSP to route this payment through.
   *
   * Priority:
   *  1. Explicit `psp` field in the request — merchant forces a specific provider
   *  2. Card-type rules (Mada → Moyasar)
   *  3. Default fallback (Moyasar)
   */
  private async selectPSP(request: PaymentRequest): Promise<PSPProvider> {
    // 1. Honour explicit PSP override
    if (request.psp) {
      logger.info(`PSP override requested: ${request.psp}`);
      return request.psp;
    }

    // 2. Card-type routing rules
    if (request.source?.type === 'mada') {
      return PSPProvider.MOYASAR;
    }

    // 3. Default
    return PSPProvider.MOYASAR;
  }

  /**
   * Get the appropriate PSP connector based on provider
   */
  private getPSPConnector(provider: PSPProvider): MoyasarConnector | PayTabsConnector {
    switch (provider) {
      case PSPProvider.MOYASAR:
        return this.moyasarConnector;
      case PSPProvider.PAYTABS:
        return this.payTabsConnector;
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