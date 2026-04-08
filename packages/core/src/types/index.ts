// ─────────────────────────────────────────────────────────────────────────────
// Money & Currency
// ─────────────────────────────────────────────────────────────────────────────

export type Currency = 'NGN' | 'GHS' | 'KES' | 'ZAR' | 'USD';

export interface Money {
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
  code: string;
  slug: string;
  ussd?: string;
  country: string;
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
  reference?: string;
  description?: string;
  channels?: PaymentChannel[];
  callbackUrl?: string;
  /**
   * Paystack: split code (SPL_xxxxxxxx) for revenue sharing.
   * Ignored by Flutterwave and Monnify.
   */
  splitCode?: string;
  /**
   * Flutterwave: subaccount split configs for marketplace payments.
   * Ignored by Paystack and Monnify.
   */
  subaccounts?: Array<{
    id: string;
    shareRatio?: number;
    sharePercentage?: number;
  }>;
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  provider: string;
  reference: string;
  /**
   * Redirect URL for hosted checkout — redirect your user here.
   * Present on all providers in redirect flow.
   */
  authorizationUrl: string;
  /**
   * Paystack: access code for inline/embedded checkout.
   * Pass to PaystackPop.setup({ key, email, amount, accessCode }) in the browser.
   */
  accessCode?: string;
  /**
   * Flutterwave: use this as the public_key parameter for inline checkout.
   * Pass to FlutterwaveCheckout() in the browser.
   */
  flwRef?: string;
  /**
   * Monnify: transaction reference for their inline SDK.
   * Pass to MonnifySDK.initialize({ transactionReference }) in the browser.
   */
  transactionReference?: string;
  status: PaymentStatus;
  raw: unknown;
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
  /**
   * Provider-internal transaction reference.
   * Paystack: authorization_code
   * Flutterwave: flw_ref
   * Monnify: transactionReference
   */
  providerReference?: string;
  /**
   * Card authorization code for recurring/tokenized charges.
   * Only present for card payments on Paystack.
   */
  authorizationCode?: string;
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
  /**
   * Paystack: split code (SPL_xxxxxxxx) for revenue sharing on this account.
   * Ignored by Flutterwave and Monnify.
   */
  splitCode?: string;
  /**
   * Monnify: income split configuration for marketplace/agency scenarios.
   * Ignored by Paystack and Flutterwave.
   */
  incomeSplitConfig?: Array<{
    subAccountCode: string;
    feePercentage?: number;
    splitPercentage?: number;
    feeBearer?: boolean;
  }>;
  /**
   * Monnify: restrict payments to specific source accounts.
   * Ignored by Paystack and Flutterwave.
   */
  restrictPaymentSource?: boolean;
  allowedPaymentSources?: Array<{ accountNumber: string; bankCode: string }>;
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
  /** Required for mobile money recipients (M-Pesa etc.) */
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferRecipient {
  provider: string;
  recipientCode: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  currency: Currency;
  raw: unknown;
}

export interface TransferParams {
  amount: Money;
  recipientCode: string;
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
  | 'refund.processed'
  | 'refund.failed'
  | 'charge.dispute.create'
  | 'charge.dispute.resolve'
  | 'invoice.create'
  | 'invoice.update'
  | 'invoice.payment_failed'
  | 'unknown';

export interface WebhookEvent<T = unknown> {
  provider: string;
  event: WebhookEventType;
  reference?: string;
  data: T;
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface NgPayProvider {
  readonly name: string;

  initializePayment(params: PaymentParams): Promise<PaymentResponse>;
  verifyPayment(reference: string): Promise<VerificationResponse>;

  createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount>;

  createTransferRecipient(params: TransferRecipientParams): Promise<TransferRecipient>;
  initiateTransfer(params: TransferParams): Promise<TransferResponse>;
  verifyTransfer(reference: string): Promise<TransferResponse>;

  getBanks(country?: string): Promise<Bank[]>;
  resolveAccount(accountNumber: string, bankCode: string): Promise<AccountDetails>;

  verifyWebhook(payload: unknown, signature: string): boolean;
  parseWebhookEvent(payload: unknown): WebhookEvent;
}
