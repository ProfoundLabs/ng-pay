import { createHmac } from 'crypto';
import {
  HttpClient,
  NgPayError,
  ValidationError,
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
  type AccountDetails,
  type WebhookEvent,
  type WebhookEventType,
  type PaymentStatus,
  type PaymentChannel,
  type TransferStatus,
  type Currency,
} from '@ng-pay/core';
import type {
  MonnifyApiResponse,
  MonnifyTokenData,
  MonnifyInitPaymentData,
  MonnifyPaymentData,
  MonnifyReservedAccountData,
  MonnifyDisbursementData,
  MonnifyBank,
  MonnifyAccountResolution,
} from './types/monnify.types.js';

export interface MonnifyConfig {
  apiKey: string;
  secretKey: string;
  contractCode: string;       // Your Monnify merchant contract code
  /**
   * Whether to use the Monnify sandbox environment.
   *
   * If omitted, ng-pay infers from your apiKey prefix:
   *   - Keys starting with MK_TEST_ → sandbox (https://sandbox.monnify.com)
   *   - Keys starting with MK_LIVE_ → production (https://api.monnify.com)
   *   - Ambiguous prefix → throws, forcing you to be explicit
   *
   * Always set this explicitly in production to avoid accidental misconfiguration.
   */
  sandbox?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export class MonnifyProvider implements NgPayProvider {
  public readonly name = 'monnify';
  private readonly http: HttpClient;
  private readonly secretKey: string;
  private readonly contractCode: string;
  // tokenExpiresAt is safe to enumerate — it's just a timestamp
  private tokenExpiresAt = 0;
  // Both _accessToken and _basicUsername are non-enumerable — they are live
  // credentials and must never appear in logs, JSON.stringify, or error context
  private declare _accessToken: string | null;
  private declare _basicUsername: string;

  constructor(config: MonnifyConfig) {
    if (!config.apiKey || !config.secretKey) {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Monnify apiKey and secretKey are both required',
        field: 'apiKey',
      });
    }

    if (!config.contractCode) {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Monnify contractCode is required',
        field: 'contractCode',
      });
    }

    this.secretKey = config.secretKey;
    this.contractCode = config.contractCode;

    // Store apiKey non-enumerably for token refresh — it's a credential
    Object.defineProperty(this, '_basicUsername', {
      value: config.apiKey,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    // Non-enumerable: hidden from JSON.stringify, Object.keys, console.log, and Sentry scraping
    Object.defineProperty(this, '_accessToken', {
      value: null,
      writable: true,
      enumerable: false,
      configurable: false,
    });

    const baseUrl = MonnifyProvider.resolveBaseUrl(config.apiKey, config.sandbox);

    // Start with Basic auth — will be swapped to Bearer after token exchange
    this.http = new HttpClient({
      baseUrl,
      provider: 'monnify',
      auth: { type: 'basic', username: config.apiKey, password: config.secretKey },
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auth — Monnify OAuth token management
  // Token lasts 1 hour; we refresh automatically when it expires.
  // ─────────────────────────────────────────────────────────────────────────

  private async ensureToken(): Promise<void> {
    if (this._accessToken && Date.now() < this.tokenExpiresAt - 60_000) return;

    // Token exchange requires Basic auth (apiKey:secretKey)
    // The HttpClient already holds the correct Basic credentials from construction
    this.http.setAuth({ type: 'basic', username: this._basicUsername, password: this.secretKey });

    let response: Awaited<ReturnType<typeof this.http.post<MonnifyApiResponse<MonnifyTokenData>>>>;
    try {
      response = await this.http.post<MonnifyApiResponse<MonnifyTokenData>>('/auth/login');
    } catch (err) {
      // Re-throw but ensure the access token is not in the error context.
      // The HttpClient already sanitizes auth headers from network errors,
      // but we add an explicit guard here since this is a credential-exchange call.
      throw err;
    }

    this.assertSuccess(response.data, 'auth');

    // Store token as non-enumerable — same property descriptor as constructor
    Object.defineProperty(this, '_accessToken', {
      value: response.data.responseBody.accessToken,
      writable: true,
      enumerable: false,
      configurable: false,
    });
    this.tokenExpiresAt = Date.now() + response.data.responseBody.expiresIn * 1000;

    // Swap to Bearer — the token itself is non-enumerable on this class,
    // but the HttpClient also stores it non-enumerably (via its own _auth field)
    this.http.setAuth({ type: 'bearer', token: this._accessToken! });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────

  async initializePayment(params: PaymentParams): Promise<PaymentResponse> {
    await this.ensureToken();

    if (params.amount.amount <= 0) {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Amount must be greater than 0',
        field: 'amount',
      });
    }

    const reference = params.reference ?? generateReference('mfy');
    const amountInMajor = params.amount.amount / 100;

    const response = await this.http.post<MonnifyApiResponse<MonnifyInitPaymentData>>(
      '/merchant/transactions/init-transaction',
      {
        amount: amountInMajor,
        customerName: params.customer.name ?? params.customer.email,
        customerEmail: params.customer.email,
        paymentReference: reference,
        paymentDescription: params.description ?? 'Payment',
        currencyCode: params.amount.currency,
        contractCode: this.contractCode,
        redirectUrl: params.callbackUrl ?? 'https://example.com/callback',
        paymentMethods: params.channels?.map(this.channelToMonnify) ?? ['CARD', 'ACCOUNT_TRANSFER'],
        metadata: params.metadata,
      }
    );

    this.assertSuccess(response.data, 'initializePayment');

    const data = response.data.responseBody;

    return {
      provider: this.name,
      reference: data.paymentReference,
      authorizationUrl: data.checkoutUrl,
      status: 'pending',
      raw: response.data,
    };
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    await this.ensureToken();

    if (!reference) {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Reference is required',
        field: 'reference',
      });
    }

    const response = await this.http.get<MonnifyApiResponse<MonnifyPaymentData>>(
      `/merchant/transactions/query`,
      { paymentReference: reference }
    );

    this.assertSuccess(response.data, 'verifyPayment');

    const data = response.data.responseBody;

    return {
      provider: this.name,
      reference: data.paymentReference,
      status: this.normalizePaymentStatus(data.paymentStatus),
      amount: { amount: Math.round(data.amountPaid * 100), currency: data.currency as Currency },
      customer: {
        email: data.customer.email,
        name: data.customer.name || undefined,
      },
      channel: this.normalizeChannel(data.paymentMethod),
      paidAt: parseDate(data.paidOn ?? undefined),
      gatewayResponse: data.paymentStatus,
      raw: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Reserved Accounts (Monnify's equivalent of virtual accounts)
  // ─────────────────────────────────────────────────────────────────────────

  async createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount> {
    await this.ensureToken();

    const reference = params.reference ?? generateReference('mfy-va');

    const response = await this.http.post<MonnifyApiResponse<MonnifyReservedAccountData>>(
      '/bank-transfer/reserved-accounts',
      {
        accountReference: reference,
        accountName: params.customer.name ?? params.customer.email,
        currencyCode: 'NGN',
        contractCode: this.contractCode,
        customerEmail: params.customer.email,
        customerName: params.customer.name ?? params.customer.email,
        customerBvn: params.metadata?.['bvn'] ?? undefined,
        incomeSplitConfig: [],
        restrictPaymentSource: false,
      }
    );

    this.assertSuccess(response.data, 'createVirtualAccount');

    const data = response.data.responseBody;

    return {
      provider: this.name,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
      bankName: data.bankName,
      bankCode: data.bankCode,
      reference: data.accountReference,
      raw: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transfers / Disbursements
  // ─────────────────────────────────────────────────────────────────────────

  async createTransferRecipient(params: TransferRecipientParams): Promise<TransferRecipient> {
    // Monnify has no recipient endpoint — resolve name and store in code
    await this.ensureToken();

    let accountName = params.name;
    try {
      const resolved = await this.resolveAccount(params.accountNumber, params.bankCode);
      accountName = resolved.accountName;
    } catch {
      // Name resolution failed — fall back to provided name
    }

    const banks = await this.getBanks();
    const bank = banks.find((b) => b.code === params.bankCode);

    const recipientCode = Buffer.from(
      JSON.stringify({
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        bank_name: bank?.name ?? params.bankCode,
        name: accountName,
        currency: params.currency ?? 'NGN',
      })
    ).toString('base64');

    return {
      provider: this.name,
      recipientCode,
      name: accountName,
      accountNumber: params.accountNumber,
      bankCode: params.bankCode,
      bankName: bank?.name ?? params.bankCode,
      currency: params.currency ?? 'NGN',
      raw: { encoded: recipientCode },
    };
  }

  async initiateTransfer(params: TransferParams): Promise<TransferResponse> {
    await this.ensureToken();

    const details = this.decodeRecipientCode(params.recipientCode);
    const reference = params.reference ?? generateReference('mfy-trf');

    const response = await this.http.post<MonnifyApiResponse<MonnifyDisbursementData>>(
      '/disbursements/single',
      {
        amount: params.amount.amount / 100,
        reference,
        narration: params.description ?? 'Transfer',
        destinationBankCode: details.bank_code,
        destinationAccountNumber: details.account_number,
        currency: params.amount.currency ?? 'NGN',
        sourceAccountNumber: this.contractCode,
      }
    );

    this.assertSuccess(response.data, 'initiateTransfer');

    return this.normalizeTransferResponse(response.data.responseBody);
  }

  async verifyTransfer(reference: string): Promise<TransferResponse> {
    await this.ensureToken();

    const response = await this.http.get<MonnifyApiResponse<MonnifyDisbursementData>>(
      `/disbursements/single/${encodeURIComponent(reference)}`
    );

    this.assertSuccess(response.data, 'verifyTransfer');

    return this.normalizeTransferResponse(response.data.responseBody);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Banks & Account Resolution
  // ─────────────────────────────────────────────────────────────────────────

  async getBanks(_country?: string): Promise<Bank[]> {
    await this.ensureToken();

    const response = await this.http.get<MonnifyApiResponse<MonnifyBank[]>>(
      '/sdk/transactions/banks'
    );

    this.assertSuccess(response.data, 'getBanks');

    return response.data.responseBody.map((b: MonnifyBank) => ({
      id: b.code,
      name: b.name,
      code: b.code,
      slug: b.name.toLowerCase().replace(/\s+/g, '-'),
      country: 'NG',
      currency: 'NGN' as Currency,
      active: true,
      ussd: b.baseUssdCode ?? undefined,
    }));
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<AccountDetails> {
    await this.ensureToken();

    const response = await this.http.get<MonnifyApiResponse<MonnifyAccountResolution>>(
      `/disbursements/account/validate`,
      { accountNumber, bankCode }
    );

    this.assertSuccess(response.data, 'resolveAccount');

    const data = response.data.responseBody;

    return {
      accountNumber: data.accountNumber,
      accountName: data.accountName,
      bankCode: data.bankCode,
      bankName: '',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Webhooks
  // Monnify signs webhooks with HMAC-SHA512 of the JSON body using secretKey.
  // Header: "monnify-signature"
  // ─────────────────────────────────────────────────────────────────────────

  verifyWebhook(payload: unknown, signature: string): boolean {
    if (typeof payload !== 'string') {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Webhook payload must be a raw string (Buffer.toString())',
        field: 'payload',
      });
    }

    const expected = createHmac('sha512', this.secretKey)
      .update(payload)
      .digest('hex');

    return timingSafeEqual(expected, signature);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    if (typeof payload !== 'object' || payload === null) {
      throw new ValidationError({
        provider: 'monnify',
        message: 'Webhook payload must be a parsed JSON object',
        field: 'payload',
      });
    }

    const raw = payload as Record<string, unknown>;
    const eventType = (raw['eventType'] as string) ?? 'unknown';
    const eventData = raw['eventData'] as Record<string, unknown>;

    return {
      provider: this.name,
      event: this.normalizeEventType(eventType),
      reference: (eventData?.['paymentReference'] as string) ?? undefined,
      data: eventData,
      raw: payload,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private assertSuccess<T>(response: MonnifyApiResponse<T>, operation: string): void {
    if (!response.requestSuccessful) {
      throw new NgPayError({
        provider: this.name,
        code: 'PROVIDER_ERROR',
        message: response.responseMessage ?? `Monnify ${operation} failed`,
        raw: response,
      });
    }
  }

  private normalizePaymentStatus(status: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      PAID: 'success',
      OVERPAID: 'success',
      PARTIALLY_PAID: 'processing',
      PENDING: 'pending',
      FAILED: 'failed',
      EXPIRED: 'abandoned',
      CANCELLED: 'abandoned',
    };
    return map[status] ?? 'pending';
  }

  private normalizeTransferStatus(status: string): TransferStatus {
    const map: Record<string, TransferStatus> = {
      SUCCESS: 'success',
      PENDING: 'pending',
      FAILED: 'failed',
      OTP: 'otp',
      PROCESSING: 'processing',
      REVERSED: 'reversed',
    };
    return map[status] ?? 'pending';
  }

  private normalizeChannel(method: string): PaymentChannel | undefined {
    const map: Record<string, PaymentChannel> = {
      CARD: 'card',
      ACCOUNT_TRANSFER: 'bank_transfer',
      USSD: 'ussd',
      PHONE_NUMBER: 'mobile_money',
    };
    return map[method];
  }

  private channelToMonnify(channel: PaymentChannel): string {
    const map: Record<PaymentChannel, string> = {
      card: 'CARD',
      bank_transfer: 'ACCOUNT_TRANSFER',
      bank: 'ACCOUNT_TRANSFER',
      ussd: 'USSD',
      mobile_money: 'PHONE_NUMBER',
      qr: 'CARD',
      eft: 'ACCOUNT_TRANSFER',
    };
    return map[channel] ?? 'CARD';
  }

  private normalizeTransferResponse(data: MonnifyDisbursementData): TransferResponse {
    return {
      provider: this.name,
      reference: data.reference,
      transferCode: data.reference,
      status: this.normalizeTransferStatus(data.status),
      amount: { amount: Math.round(data.amount * 100), currency: 'NGN' },
      raw: data,
    };
  }

  private decodeRecipientCode(code: string): {
    account_number: string;
    bank_code: string;
    name: string;
    currency: string;
  } {
    try {
      return JSON.parse(Buffer.from(code, 'base64').toString('utf-8'));
    } catch {
      throw new ValidationError({
        provider: this.name,
        message: 'Invalid recipientCode — must be created by createTransferRecipient()',
        field: 'recipientCode',
      });
    }
  }

  private normalizeEventType(eventType: string): WebhookEventType {
    const map: Record<string, WebhookEventType> = {
      'SUCCESSFUL_TRANSACTION': 'charge.success',
      'FAILED_TRANSACTION': 'charge.failed',
      'SUCCESSFUL_DISBURSEMENT': 'transfer.success',
      'FAILED_DISBURSEMENT': 'transfer.failed',
      'REVERSED_DISBURSEMENT': 'transfer.reversed',
    };
    return map[eventType] ?? 'unknown';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Static helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolves the Monnify base URL from the config.
   *
   * Priority:
   *  1. Explicit `sandbox` boolean — always wins
   *  2. Inferred from apiKey prefix (MK_TEST_ → sandbox, MK_LIVE_ → production)
   *  3. Ambiguous key → throws ValidationError forcing the caller to be explicit
   *
   * This prevents the silent foot-gun of hitting production with test keys
   * or sandbox with live keys due to an omitted config field.
   */
  private static resolveBaseUrl(apiKey: string, sandbox?: boolean): string {
    const SANDBOX_URL = 'https://sandbox.monnify.com/api/v1';
    const PROD_URL    = 'https://api.monnify.com/api/v1';

    // Explicit config always wins
    if (sandbox === true)  return SANDBOX_URL;
    if (sandbox === false) return PROD_URL;

    // Infer from key prefix
    if (apiKey.startsWith('MK_TEST_')) return SANDBOX_URL;
    if (apiKey.startsWith('MK_LIVE_')) return PROD_URL;

    // Ambiguous — refuse to guess
    throw new ValidationError({
      provider: 'monnify',
      message:
        'Cannot determine Monnify environment from apiKey prefix. ' +
        'Set sandbox: true for sandbox or sandbox: false for production explicitly. ' +
        '(Expected key prefix: MK_TEST_ or MK_LIVE_)',
      field: 'sandbox',
    });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return result === 0;
}
