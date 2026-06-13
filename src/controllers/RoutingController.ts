import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { RoutingRule } from '../models/RoutingRule';
import { PSPProvider } from '../types/payment.types';
import { RoutingService } from '../services/RoutingService';
import { logger } from '../utils/logger';

export class RoutingController {
  private ruleRepository = AppDataSource.getRepository(RoutingRule);
  private routingService = new RoutingService();

  /** GET /routing-rules — list all rules ordered by priority */
  listRules = async (req: Request, res: Response): Promise<void> => {
    const rules = await this.ruleRepository.find({
      order: { priority: 'DESC' }
    });
    res.json({ success: true, data: rules });
  };

  /** POST /routing-rules — create a new rule */
  createRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, priority = 0, conditions = [], target_psp, enabled = true } = req.body;

      if (!name || !target_psp) {
        res.status(400).json({ success: false, message: 'name and target_psp are required' });
        return;
      }

      if (!Object.values(PSPProvider).includes(target_psp)) {
        res.status(400).json({
          success: false,
          message: `Invalid target_psp. Valid values: ${Object.values(PSPProvider).join(', ')}`
        });
        return;
      }

      const rule = this.ruleRepository.create({ name, priority, conditions, target_psp, enabled });
      await this.ruleRepository.save(rule);

      logger.info(`[routing] rule created: "${name}" → ${target_psp} (priority ${priority})`);
      res.status(201).json({ success: true, data: rule });
    } catch (error: any) {
      logger.error('[routing] createRule error:', { message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** PUT /routing-rules/:id — update a rule */
  updateRule = async (req: Request, res: Response): Promise<void> => {
    try {
      const rule = await this.ruleRepository.findOne({ where: { id: req.params.id } });
      if (!rule) {
        res.status(404).json({ success: false, message: 'Rule not found' });
        return;
      }

      const { name, priority, conditions, target_psp, enabled } = req.body;
      if (name !== undefined) rule.name = name;
      if (priority !== undefined) rule.priority = priority;
      if (conditions !== undefined) rule.conditions = conditions;
      if (target_psp !== undefined) rule.target_psp = target_psp;
      if (enabled !== undefined) rule.enabled = enabled;

      await this.ruleRepository.save(rule);
      res.json({ success: true, data: rule });
    } catch (error: any) {
      logger.error('[routing] updateRule error:', { message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /** DELETE /routing-rules/:id */
  deleteRule = async (req: Request, res: Response): Promise<void> => {
    const rule = await this.ruleRepository.findOne({ where: { id: req.params.id } });
    if (!rule) {
      res.status(404).json({ success: false, message: 'Rule not found' });
      return;
    }
    await this.ruleRepository.remove(rule);
    logger.info(`[routing] rule deleted: ${req.params.id}`);
    res.json({ success: true, message: 'Rule deleted' });
  };

  /**
   * POST /routing-rules/simulate — dry-run the routing engine against a
   * sample payment request without creating a transaction.
   */
  simulateRouting = async (req: Request, res: Response): Promise<void> => {
    try {
      const selectedPSP = await this.routingService.selectPSP(req.body);
      res.json({
        success: true,
        data: {
          selected_psp: selectedPSP,
          input: req.body
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
