import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { PaymentStatus, PaymentMethod, PSPProvider, Currency } from '../types/payment.types';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  merchant_id: string;

  @Column({
    type: 'enum',
    enum: PSPProvider
  })
  psp_provider: PSPProvider;

  @Column({ nullable: true })
  @Index()
  psp_transaction_id: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: Currency,
    default: Currency.SAR
  })
  currency: Currency;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING
  })
  @Index()
  status: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentMethod
  })
  payment_method: PaymentMethod;

  @Column({ nullable: true })
  card_token: string;

  @Column({ nullable: true })
  card_brand: string;

  @Column({ nullable: true })
  card_last_four: string;

  @Column('text', { nullable: true })
  description: string;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  fee: number;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any>;

  @Column('text', { nullable: true })
  callback_url: string;

  @Column('text', { nullable: true })
  error_message: string;

  @Column('text', { nullable: true })
  psp_reference_number: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
