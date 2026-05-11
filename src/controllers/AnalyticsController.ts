import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Transaction } from '../models/Transaction';
import { PaymentStatus } from '../types/payment.types';
import { logger } from '../utils/logger';

export class AnalyticsController {
  /**
   * GET /api/v1/analytics
   * Returns aggregated analytics for the authenticated merchant
   */
  getAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const transactionRepository = AppDataSource.getRepository(Transaction);

      // Total transaction count for this merchant
      const totalTransactions = await transactionRepository.count({
        where: { merchant_id: merchantId }
      });

      // Total revenue: sum of amount for paid transactions only
      const revenueResult = await transactionRepository
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.amount), 0)', 'total_revenue')
        .where('t.merchant_id = :merchantId', { merchantId })
        .andWhere('t.status = :status', { status: PaymentStatus.PAID })
        .getRawOne();

      const totalRevenue = parseFloat(revenueResult?.total_revenue ?? '0');

      // Breakdown by status: count per status value
      const statusBreakdownRaw = await transactionRepository
        .createQueryBuilder('t')
        .select('t.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('t.merchant_id = :merchantId', { merchantId })
        .groupBy('t.status')
        .getRawMany();

      const statusBreakdown = statusBreakdownRaw.map((row) => ({
        status: row.status as PaymentStatus,
        count: parseInt(row.count, 10)
      }));

      // Last 30 days: date, transaction count, revenue (paid only) grouped by day
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyDataRaw = await transactionRepository
        .createQueryBuilder('t')
        .select('DATE(t.created_at)', 'date')
        .addSelect('COUNT(*)', 'transaction_count')
        .addSelect(
          `COALESCE(SUM(CASE WHEN t.status = :paidStatus THEN t.amount ELSE 0 END), 0)`,
          'revenue'
        )
        .where('t.merchant_id = :merchantId', { merchantId })
        .andWhere('t.created_at >= :thirtyDaysAgo', { thirtyDaysAgo })
        .setParameter('paidStatus', PaymentStatus.PAID)
        .groupBy('DATE(t.created_at)')
        .orderBy('date', 'ASC')
        .getRawMany();

      const last30Days = dailyDataRaw.map((row) => ({
        date: row.date,
        transaction_count: parseInt(row.transaction_count, 10),
        revenue: parseFloat(row.revenue)
      }));

      logger.info(`Analytics fetched for merchant: ${merchantId}`, {
        total_transactions: totalTransactions,
        request_id: req.requestId
      });

      res.status(200).json({
        success: true,
        data: {
          total_transactions: totalTransactions,
          total_revenue: totalRevenue,
          status_breakdown: statusBreakdown,
          last_30_days: last30Days
        }
      });
    } catch (error: any) {
      logger.error('Error in getAnalytics controller:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        request_id: req.requestId
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch analytics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}
