import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  @Index()
  email: string;

  @Column({ unique: true })
  @Index()
  api_key_prefix: string;

  @Column()
  api_key_hash: string;

  @Column({ nullable: true })
  webhook_url: string;

  @Column({ nullable: true })
  webhook_secret: string;

  @Column({ default: true })
  active: boolean;

  @Column('jsonb', { nullable: true })
  settings: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
