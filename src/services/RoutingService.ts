import { AppDataSource } from '../config/database';
import { RoutingRule } from '../models/RoutingRule';
import { PaymentRequest, PSPProvider } from '../types/payment.types';
import { logger } from '../utils/logger';

type Condition = RoutingRule['conditions'][number];

export class RoutingService {
  private ruleRepository = AppDataSource.getRepository(RoutingRule);

  /**
   * Determine which PSP to use for this payment request.
   *
   * Priority:
   *  1. Explicit `psp` field in the request (merchant override)
   *  2. Enabled DB routing rules, evaluated in descending priority order
   *  3. DEFAULT_PSP env var (fallback, defaults to 'moyasar')
   */
  async selectPSP(request: PaymentRequest): Promise<PSPProvider> {
    if (request.psp) {
      logger.info(`[routing] explicit override → ${request.psp}`);
      return request.psp;
    }

    const rules = await this.ruleRepository.find({
      where: { enabled: true },
      order: { priority: 'DESC' }
    });

    for (const rule of rules) {
      if (this.matches(rule.conditions, request)) {
        logger.info(`[routing] rule matched: "${rule.name}" → ${rule.target_psp}`);
        return rule.target_psp;
      }
    }

    const fallback = (process.env.DEFAULT_PSP as PSPProvider) || PSPProvider.MOYASAR;
    logger.info(`[routing] no rule matched — fallback: ${fallback}`);
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Rule evaluation
  // ---------------------------------------------------------------------------

  private matches(conditions: Condition[], req: PaymentRequest): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(c => this.evalCondition(c, req));
  }

  private evalCondition(c: Condition, req: PaymentRequest): boolean {
    let actual: string | number | boolean | undefined;

    switch (c.field) {
      case 'currency':
        actual = req.currency;
        break;
      case 'amount':
        actual = req.amount;
        break;
      case 'has_token':
        actual = !!req.source?.token;
        break;
      case 'payment_method':
        actual = req.source?.type ?? '';
        break;
      default:
        return true;
    }

    const v = c.value;
    switch (c.operator) {
      case 'equals':          return actual === v || String(actual) === String(v);
      case 'not_equals':      return actual !== v && String(actual) !== String(v);
      case 'greater_than':    return Number(actual) > Number(v);
      case 'less_than':       return Number(actual) < Number(v);
      case 'greater_than_or_equal': return Number(actual) >= Number(v);
      case 'less_than_or_equal':    return Number(actual) <= Number(v);
      default:                return true;
    }
  }
}
