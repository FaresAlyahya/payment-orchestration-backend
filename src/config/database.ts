import { DataSource } from 'typeorm';
import { Transaction } from '../models/Transaction';
import { Merchant } from '../models/Merchant';
import { RoutingRule } from '../models/RoutingRule';
import { WebhookDelivery } from '../models/WebhookDelivery';
import * as dotenv from 'dotenv';

dotenv.config();

// Support both a full DATABASE_URL and individual DB_* variables so the app
// works with docker-compose (which sets individual vars) and cloud providers
// (which typically set DATABASE_URL).
const dataSourceOptions = process.env.DATABASE_URL
  ? {
      url: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'payment_orchestration',
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: false
    };

const isProduction = process.env.NODE_ENV === 'production';

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
