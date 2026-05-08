import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

export enum WebhookDeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',      // last attempt failed, will retry
  EXHAUSTED = 'exhausted' // max attempts reached, no more retries
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  transaction_id: string;

  @Column()
  @Index()
  merchant_id: string;

  @Column()
  event_type: string;

  @Column('jsonb')
  payload: Record<string, any>;

  @Column()
  webhook_url: string;

  @Column({ nullable: true })
  webhook_secret: string;

  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING
  })
  @Index()
  status: WebhookDeliveryStatus;

  @Column({ default: 0 })
  attempts: number;

  @Column({ default: 3 })
  max_attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  next_attempt_at: Date;

  @Column({ type: 'text', nullable: true })
  last_error: string;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
