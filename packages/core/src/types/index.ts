// ─────────────────────────────────────────────────────────────────────────────
// Money & Currency
// ─────────────────────────────────────────────────────────────────────────────

export type Currency = 'NGN' | 'GHS' | 'KES' | 'ZAR' | 'USD';

/**
 * All monetary amounts are stored in the smallest unit (kobo for NGN, pesewas for GHS).
 * Never use floats for money.
 */
export interface Money {
  /** Amount in smallest currency unit (e.g. kobo for NGN) */
  amount: number;
  currency: Currency;
}

export function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function fromKobo(kobo: number): number {
  return kobo / 100;
}

export function formatMoney(money: Money): string {
  const major = money.amount / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: 2,
  }).format(major);
}

// ─────────────────────────────────────────────────────────────────────────────
// Banks
// ─────────────────────────────────────────────────────────────────────────────

export interface Bank {
  id: string;
  name: string;
  code: string;          // CBN bank code e.g. "058"
  slug: string;          // e.g. "guaranty-trust-bank"
  ussd?: string;         // USSD shortcode if available
  country: string;       // ISO 3166-1 alpha-2
  currency: Currency;
  active: boolean;
}

export interface AccountDetails {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'reversed'
  | 'queued';

export type PaymentChannel =
  | 'card'
  | 'bank'
  | 'ussd'
  | 'qr'
  | 'mobile_money'
  | 'bank_transfer'
  | 'eft';

export interface CustomerInfo {
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentParams {
  amount: Money;
  customer: CustomerInfo;
  reference?: string;          // Auto-generated if not provided
  description?: string;
  channels?: PaymentChannel[];
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  provider: string;
  reference: string;
  accessCode?: string;          // Provider-specific auth code
  authorizationUrl: string;     // Redirect user here
  status: PaymentStatus;
  raw: unknown;                 // Original provider response — for debugging
}

export interface VerificationResponse {
  provider: string;
  reference: string;
  status: PaymentStatus;
  amount: Money;
  customer: CustomerInfo;
  channel?: PaymentChannel;
  paidAt?: Date;
  gatewayResponse?: string;
  fees?: Money;
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Accounts (NUBAN)
// ─────────────────────────────────────────────────────────────────────────────

export interface VirtualAccountParams {
  customer: CustomerInfo;
  reference?: string;
  description?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface VirtualAccount {
  provider: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankCode: string;
  reference: string;
  expiresAt?: Date;
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfers (Payouts)
// ─────────────────────────────────────────────────────────────────────────────

export type TransferStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'reversed'
  | 'otp';

export interface TransferRecipientParams {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: Currency;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferRecipient {
  provider: string;
  recipientCode: string;         // Provider-specific handle for the recipient
  name: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  currency: Currency;
  raw: unknown;
}

export interface TransferParams {
  amount: Money;
  recipientCode: string;         // From createTransferRecipient()
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferResponse {
  provider: string;
  reference: string;
  transferCode: string;
  status: TransferStatus;
  amount: Money;
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'charge.success'
  | 'charge.failed'
  | 'transfer.success'
  | 'transfer.failed'
  | 'transfer.reversed'
  | 'paymentrequest.success'
  | 'subscription.create'
  | 'subscription.disable'
  | 'unknown';

export interface WebhookEvent<T = unknown> {
  provider: string;
  event: WebhookEventType;
  reference?: string;
  data: T;
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Interface — every adapter implements this
// ─────────────────────────────────────────────────────────────────────────────

export interface NgPayProvider {
  readonly name: string;

  // Payments
  initializePayment(params: PaymentParams): Promise<PaymentResponse>;
  verifyPayment(reference: string): Promise<VerificationResponse>;

  // Virtual accounts
  createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount>;

  // Transfers
  createTransferRecipient(params: TransferRecipientParams): Promise<TransferRecipient>;
  initiateTransfer(params: TransferParams): Promise<TransferResponse>;
  verifyTransfer(reference: string): Promise<TransferResponse>;

  // Utilities
  getBanks(country?: string): Promise<Bank[]>;
  resolveAccount(accountNumber: string, bankCode: string): Promise<AccountDetails>;

  // Webhooks
  verifyWebhook(payload: unknown, signature: string): boolean;
  parseWebhookEvent(payload: unknown): WebhookEvent;
}
