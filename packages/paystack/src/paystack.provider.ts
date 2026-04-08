import { createHmac } from 'crypto';
import {
  HttpClient,
  NgPayError,
  AuthenticationError,
  ValidationError,
  WebhookSignatureError,
  generateReference,
  parseDate,
  type NgPayProvider,
  type PaymentParams,
  type PaymentResponse,
  type VerificationResponse,
  type VirtualAccountParams,
  type VirtualAccount,
  type TransferRecipientParams,
  type TransferRecipient,
  type TransferParams,
  type TransferResponse,
  type Bank,
  type PaymentChannel,
  type AccountDetails,
  type WebhookEvent,
  type WebhookEventType,
  type PaymentStatus,
  type TransferStatus,
  type Currency,
} from '@ng-pay/core';
import type {
  PaystackApiResponse,
  PaystackInitializeData,
  PaystackVerifyData,
  PaystackDedicatedAccount,
  PaystackTransferRecipientData,
  PaystackTransferData,
  PaystackBank,
  PaystackAccountResolution,
} from './types/paystack.types.js';

/**
 * Banks Paystack supports for dedicated NUBAN virtual accounts.
 * Check your Paystack dashboard to confirm which are active on your account.
 */
export type PaystackPreferredBank =
  | 'wema-bank'      // Wema Bank — most widely available
  | 'titan-paystack' // Titan Trust Bank
  | 'sterling-bank'; // Sterling Bank

export interface PaystackConfig {
  secretKey: string;
  /**
   * Default bank for dedicated virtual accounts (NUBAN).
   * Can be overridden per-call via VirtualAccountParams.metadata.preferredBank.
   * Defaults to 'wema-bank'.
   */
  preferredBank?: PaystackPreferredBank;
  timeoutMs?: number;
  maxRetries?: number;
}

export class PaystackProvider implements NgPayProvider {
  public readonly name = 'paystack';
  private readonly http: HttpClient;
  private readonly secretKey: string;
  private readonly preferredBank: PaystackPreferredBank;

  constructor(config: PaystackConfig) {
    if (!config.secretKey) {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Paystack secret key is required',
        field: 'secretKey',
      });
    }

    if (!config.secretKey.startsWith('sk_')) {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Invalid Paystack secret key format. Key must start with sk_live_ or sk_test_',
        field: 'secretKey',
      });
    }

    this.secretKey = config.secretKey;
    this.preferredBank = config.preferredBank ?? 'wema-bank';
    this.http = new HttpClient({
      baseUrl: 'https://api.paystack.co',
      provider: 'paystack',
      auth: { type: 'bearer', token: config.secretKey },
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────

  async initializePayment(params: PaymentParams): Promise<PaymentResponse> {
    if (params.amount.amount <= 0) {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Amount must be greater than 0',
        field: 'amount',
      });
    }

    const reference = params.reference ?? generateReference('pstk');

    const response = await this.http.post<PaystackApiResponse<PaystackInitializeData>>(
      '/transaction/initialize',
      {
        email: params.customer.email,
        amount: params.amount.amount, // Paystack expects kobo
        currency: params.amount.currency,
        reference,
        callback_url: params.callbackUrl,
        metadata: {
          ...params.metadata,
          customer_name: params.customer.name,
          customer_phone: params.customer.phone,
        },
        channels: params.channels,
      }
    );

    this.assertSuccess(response.data, 'initializePayment');

    const data = response.data.data;

    return {
      provider: this.name,
      reference: data.reference,
      accessCode: data.access_code,
      authorizationUrl: data.authorization_url,
      status: 'pending',
      raw: response.data,
    };
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    if (!reference) {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Reference is required',
        field: 'reference',
      });
    }

    const response = await this.http.get<PaystackApiResponse<PaystackVerifyData>>(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );

    this.assertSuccess(response.data, 'verifyPayment');

    const data = response.data.data;

    return {
      provider: this.name,
      reference: data.reference,
      status: this.normalizePaymentStatus(data.status),
      amount: { amount: data.amount, currency: data.currency as Currency },
      customer: {
        email: data.customer.email,
        name: [data.customer.first_name, data.customer.last_name]
          .filter(Boolean)
          .join(' ') || undefined,
        phone: data.customer.phone ?? undefined,
      },
      channel: data.channel as PaymentChannel,
      paidAt: parseDate(data.paid_at ?? undefined),
      gatewayResponse: data.gateway_response,
      fees: data.fees ? { amount: data.fees, currency: data.currency as Currency } : undefined,
      raw: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Virtual Accounts (Dedicated NUBAN)
  // ─────────────────────────────────────────────────────────────────────────

  async createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount> {
    // Step 1: create or fetch the Paystack customer
    const customerCode = await this.ensureCustomer(params.customer.email, {
      first_name: params.customer.name?.split(' ')[0],
      last_name: params.customer.name?.split(' ').slice(1).join(' '),
      phone: params.customer.phone,
    });

    // Step 2: create dedicated account
    // Bank can be overridden per-call via metadata.preferredBank, or falls back
    // to the instance-level config (default: 'wema-bank').
    const preferredBank = (params.metadata?.['preferredBank'] as PaystackPreferredBank | undefined)
      ?? this.preferredBank;

    const response = await this.http.post<PaystackApiResponse<PaystackDedicatedAccount>>(
      '/dedicated_account',
      {
        customer: customerCode,
        preferred_bank: preferredBank,
        metadata: params.metadata,
      }
    );

    this.assertSuccess(response.data, 'createVirtualAccount');

    const data = response.data.data;

    return {
      provider: this.name,
      accountNumber: data.account_number,
      accountName: data.account_name,
      bankName: data.bank.name,
      // Note: Paystack's dedicated_account response returns a numeric bank ID,
      // not the CBN bank code. We prefix with 'pstk:' to make this obvious
      // and prevent it being used directly as a CBN code downstream.
      bankCode: `pstk:${data.bank.id}`,
      reference: params.reference ?? generateReference('va'),
      raw: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transfers (Payouts)
  // ─────────────────────────────────────────────────────────────────────────

  async createTransferRecipient(params: TransferRecipientParams): Promise<TransferRecipient> {
    const response = await this.http.post<PaystackApiResponse<PaystackTransferRecipientData>>(
      '/transferrecipient',
      {
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: params.currency ?? 'NGN',
        description: params.description,
        metadata: params.metadata,
      }
    );

    this.assertSuccess(response.data, 'createTransferRecipient');

    const data = response.data.data;

    return {
      provider: this.name,
      recipientCode: data.recipient_code,
      name: data.name,
      accountNumber: data.details.account_number,
      bankCode: data.details.bank_code,
      bankName: data.details.bank_name,
      currency: data.currency as Currency,
      raw: response.data,
    };
  }

  async initiateTransfer(params: TransferParams): Promise<TransferResponse> {
    const reference = params.reference ?? generateReference('trf');

    const response = await this.http.post<PaystackApiResponse<PaystackTransferData>>(
      '/transfer',
      {
        source: 'balance',
        amount: params.amount.amount,
        recipient: params.recipientCode,
        reference,
        reason: params.description,
        currency: params.amount.currency ?? 'NGN',
      }
    );

    this.assertSuccess(response.data, 'initiateTransfer');

    return this.normalizeTransferResponse(response.data.data);
  }

  async verifyTransfer(reference: string): Promise<TransferResponse> {
    const response = await this.http.get<PaystackApiResponse<PaystackTransferData>>(
      `/transfer/verify/${encodeURIComponent(reference)}`
    );

    this.assertSuccess(response.data, 'verifyTransfer');

    return this.normalizeTransferResponse(response.data.data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Banks & Account Resolution
  // ─────────────────────────────────────────────────────────────────────────

  async getBanks(country = 'nigeria'): Promise<Bank[]> {
    const response = await this.http.get<PaystackApiResponse<PaystackBank[]>>(
      '/bank',
      { country, use_cursor: false, perPage: 100 }
    );

    this.assertSuccess(response.data, 'getBanks');

    return response.data.data
      .filter((b: PaystackBank) => b.active && !b.is_deleted)
      .map((b: PaystackBank) => ({
        id: String(b.id),
        name: b.name,
        code: b.code,
        slug: b.slug,
        country: b.country,
        currency: b.currency as Currency,
        active: b.active,
        ussd: b.ussd,
      }));
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<AccountDetails> {
    const response = await this.http.get<PaystackApiResponse<PaystackAccountResolution>>(
      '/bank/resolve',
      { account_number: accountNumber, bank_code: bankCode }
    );

    this.assertSuccess(response.data, 'resolveAccount');

    const data = response.data.data;

    return {
      accountNumber: data.account_number,
      accountName: data.account_name,
      bankCode,
      bankName: '', // Paystack doesn't return bank name here; caller can enrich via getBanks()
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Webhooks
  // ─────────────────────────────────────────────────────────────────────────

  verifyWebhook(payload: unknown, signature: string): boolean {
    if (typeof payload !== 'string') {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Webhook payload must be a raw string (Buffer.toString())',
        field: 'payload',
      });
    }

    const expected = createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(expected, signature);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    if (typeof payload !== 'object' || payload === null) {
      throw new ValidationError({
        provider: 'paystack',
        message: 'Webhook payload must be a parsed JSON object',
        field: 'payload',
      });
    }

    const raw = payload as Record<string, unknown>;
    const event = (raw['event'] as string) ?? 'unknown';
    const data = raw['data'] as Record<string, unknown>;

    return {
      provider: this.name,
      event: this.normalizeEventType(event),
      reference: (data?.['reference'] as string) ?? undefined,
      data,
      raw: payload,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async ensureCustomer(
    email: string,
    meta: { first_name?: string; last_name?: string; phone?: string }
  ): Promise<string> {
    // Try to create — if exists Paystack returns the existing customer
    const response = await this.http.post<PaystackApiResponse<{ customer_code: string }>>(
      '/customer',
      { email, ...meta }
    );

    this.assertSuccess(response.data, 'ensureCustomer');
    return response.data.data.customer_code;
  }

  private assertSuccess<T>(response: PaystackApiResponse<T>, operation: string): void {
    if (!response.status) {
      throw new NgPayError({
        provider: this.name,
        code: 'PROVIDER_ERROR',
        message: response.message ?? `Paystack ${operation} failed`,
        raw: response,
      });
    }
  }

  private normalizePaymentStatus(status: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      success: 'success',
      failed: 'failed',
      abandoned: 'abandoned',
      pending: 'pending',
      processing: 'processing',
      reversed: 'reversed',
      queued: 'queued',
    };
    return map[status] ?? 'pending';
  }

  private normalizeTransferStatus(status: string): TransferStatus {
    const map: Record<string, TransferStatus> = {
      success: 'success',
      failed: 'failed',
      pending: 'pending',
      processing: 'processing',
      reversed: 'reversed',
      otp: 'otp',
    };
    return map[status] ?? 'pending';
  }

  private normalizeTransferResponse(data: PaystackTransferData): TransferResponse {
    return {
      provider: this.name,
      reference: data.reference,
      transferCode: data.transfer_code,
      status: this.normalizeTransferStatus(data.status),
      amount: { amount: data.amount, currency: data.currency as Currency },
      raw: data,
    };
  }

  private normalizeEventType(event: string): WebhookEventType {
    const validEvents: WebhookEventType[] = [
      'charge.success',
      'charge.failed',
      'transfer.success',
      'transfer.failed',
      'transfer.reversed',
      'paymentrequest.success',
      'subscription.create',
      'subscription.disable',
    ];
    return validEvents.includes(event as WebhookEventType)
      ? (event as WebhookEventType)
      : 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing-safe string comparison (prevent timing attacks on webhook verification)
// ─────────────────────────────────────────────────────────────────────────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
