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

  /**
   * Optional expiry for the current API key (UTC).  Null means the key never
   * expires.  Set by the key-rotation endpoint to enforce periodic rotation
   * policies.  The auth middleware rejects keys whose expiry is in the past.
   */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  api_key_expires_at: Date | null;

  @Column({ nullable: true })
  webhook_url: string;

  @Column({ nullable: true })
  webhook_secret: string;

  @Column({ default: true })
  active: boolean;

  /**
   * Optional IP whitelist (JSONB string array).  When non-empty, only
   * requests from listed IPs are accepted for this merchant.  Null / empty
   * means all IPs are allowed (backward-compatible default).
   */
  @Column('jsonb', { nullable: true, default: null })
  allowed_ips: string[] | null;

  @Column('jsonb', { nullable: true })
  settings: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
