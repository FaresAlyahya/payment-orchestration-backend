import { DataSource } from 'typeorm';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { RoutingRule } from '../models/RoutingRule';
import { WebhookDelivery } from '../models/WebhookDelivery';
import * as dotenv from 'dotenv';

dotenv.config();

// Support both a full DATABASE_URL (AWS App Runner / cloud providers) and
// individual DB_* variables (docker-compose / local dev).
//
// AWS RDS SSL notes:
//  - DB_SSL=true  → enforce SSL with full certificate verification (recommended
//                   for production RDS; requires the RDS CA bundle to be trusted)
//  - DB_SSL=false → disable SSL (local / docker-compose only)
//  - default in production → SSL enabled, rejectUnauthorized: false
//    (works with RDS without bundling the CA cert; acceptable when the
//     connection stays inside a private VPC)
const isProduction = process.env.NODE_ENV === 'production';

const sslConfig = (() => {
  if (process.env.DB_SSL === 'false') return false;
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: true };
  if (isProduction) return { rejectUnauthorized: false }; // default for managed DB
  return false;
})();

const dataSourceOptions = process.env.DATABASE_URL
  ? { url: process.env.DATABASE_URL, ssl: sslConfig }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'payment_orchestration',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: sslConfig
    };

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...dataSourceOptions,
  // Allow explicit override via DB_SYNCHRONIZE=true for first-time Railway deploys
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || !isProduction,
  logging: !isProduction,
  entities: [Transaction, Merchant, RoutingRule, WebhookDelivery],
  migrations: [isProduction ? 'dist/migrations/**/*.js' : 'src/migrations/**/*.ts'],
  subscribers: []
});

export const initializeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connection established successfully');
  } catch (error) {
    console.error('❌ Error during database initialization:', error);
    throw error;
  }
};
