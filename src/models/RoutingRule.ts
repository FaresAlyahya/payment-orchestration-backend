import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PSPProvider } from '../types/payment.types';

@Entity('routing_rules')
export class RoutingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ default: 0 })
  priority: number;

  @Column('jsonb')
  conditions: Array<{
    field: string;
    operator: string;
    value: string | number;
  }>;

  @Column({
    type: 'enum',
    enum: PSPProvider
  })
  target_psp: PSPProvider;

  @Column({ default: true })
  enabled: boolean;

  @Column({ nullable: true })
  merchant_id: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
