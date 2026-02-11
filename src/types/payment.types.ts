// Payment Types and Interfaces

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  AUTHORIZED = 'authorized',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  VOIDED = 'voided'
}

export enum PaymentMethod {
  CREDITCARD = 'creditcard',
  MADA = 'mada',
  APPLEPAY = 'applepay',
  STC_PAY = 'stcpay'
}

export enum PSPProvider {
  MOYASAR = 'moyasar',
  HYPERPAY = 'hyperpay',
  TAP = 'tap',
  CHECKOUT = 'checkout'
}

export enum Currency {
  SAR = 'SAR',
  USD = 'USD',
  AED = 'AED'
}

export interface PaymentRequest {
  amount: number;
  currency: Currency;
  description?: string;
  callback_url?: string;
  source?: PaymentSource;
  metadata?: Record<string, any>;
}

export interface PaymentSource {
  type: PaymentMethod;
  number?: string;
  name?: string;
  month?: string;
  year?: string;
  cvc?: string;
  token?: string;
}

export interface PaymentResponse {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  fee?: number;
  source?: {
    type: PaymentMethod;
    company?: string;
    name?: string;
    number?: string;
    gateway_id?: string;
    reference_number?: string;
    token?: string;
  };
  created_at: string;
  updated_at?: string;
  description?: string;
  metadata?: Record<string, any>;
  callback_url?: string;
}

export interface RefundRequest {
  amount?: number;
  reason?: string;
}

export interface RefundResponse {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
  created_at: string;
}

export interface WebhookPayload {
  type: string;
  data: any;
  created_at: string;
  signature?: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  conditions: RoutingCondition[];
  target_psp: PSPProvider;
  enabled: boolean;
}

export interface RoutingCondition {
  field: 'card_type' | 'amount' | 'currency' | 'success_rate';
  operator: 'equals' | 'greater_than' | 'less_than' | 'contains';
  value: string | number;
}

export interface PSPConfig {
  name: PSPProvider;
  api_key: string;
  api_url: string;
  webhook_secret?: string;
  enabled: boolean;
}

export interface Transaction {
  id: string;
  merchant_id: string;
  psp_provider: PSPProvider;
  psp_transaction_id: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  payment_method: PaymentMethod;
  card_token?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Merchant {
  id: string;
  name: string;
  email: string;
  api_key: string;
  webhook_url?: string;
  active: boolean;
  created_at: Date;
}
