import {
  HttpClient,
  NgPayError,
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
  type AccountDetails,
  type WebhookEvent,
  type WebhookEventType,
  type PaymentStatus,
  type PaymentChannel,
  type TransferStatus,
  type Currency,
} from '@ng-pay/core';
import type {
  FlutterwaveApiResponse,
  FlutterwavePaymentLinkData,
  FlutterwaveVerifyData,
  FlutterwaveVirtualAccountData,
  FlutterwaveTransferData,
  FlutterwaveBank,
  FlutterwaveAccountResolution,
} from './types/flutterwave.types.js';

export interface FlutterwaveConfig {
  secretKey: string;
  encryptionKey?: string;  // Required for direct charge (not needed for redirect flow)
  timeoutMs?: number;
  maxRetries?: number;
}

export class FlutterwaveProvider implements NgPayProvider {
  public readonly name = 'flutterwave';
  private readonly http: HttpClient;
  private readonly secretKey: string;

  constructor(config: FlutterwaveConfig) {
    if (!config.secretKey) {
      throw new ValidationError({
        provider: 'flutterwave',
        message: 'Flutterwave secret key is required',
        field: 'secretKey',
      });
    }

    if (!config.secretKey.startsWith('FLWSECK') && !config.secretKey.startsWith('FLWSECK_TEST')) {
      throw new ValidationError({
        provider: 'flutterwave',
        message: 'Invalid Flutterwave secret key. Key must start with FLWSECK or FLWSECK_TEST',
        field: 'secretKey',
      });
    }

    this.secretKey = config.secretKey;
    this.http = new HttpClient({
      baseUrl: 'https://api.flutterwave.com/v3',
      provider: 'flutterwave',
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
        provider: 'flutterwave',
        message: 'Amount must be greater than 0',
        field: 'amount',
      });
    }

    // IMPORTANT: Flutterwave takes amount in MAJOR units (naira), not kobo
    const amountInMajor = params.amount.amount / 100;
    const txRef = params.reference ?? generateReference('flw');

    const response = await this.http.post<FlutterwaveApiResponse<FlutterwavePaymentLinkData>>(
      '/payments',
      {
        tx_ref: txRef,
        amount: amountInMajor,
        currency: params.amount.currency,
        redirect_url: params.callbackUrl ?? 'https://example.com/callback',
        customer: {
          email: params.customer.email,
          name: params.customer.name,
          phonenumber: params.customer.phone,
        },
        meta: params.metadata,
        payment_options: params.channels?.map(this.channelToFlw).join(','),
        customizations: {
          title: params.description ?? 'Payment',
        },
      }
    );

    this.assertSuccess(response.data, 'initializePayment');

    return {
      provider: this.name,
      reference: txRef,
      authorizationUrl: response.data.data.link,
      status: 'pending',
      raw: response.data,
    };
  }

  async verifyPayment(reference: string): Promise<VerificationResponse> {
    if (!reference) {
      throw new ValidationError({
        provider: 'flutterwave',
        message: 'Reference (tx_ref) is required',
        field: 'reference',
      });
    }

    // Flutterwave verify requires the transaction ID (numeric), not tx_ref.
    // We search by tx_ref first to get the ID.
    const searchResponse = await this.http.get<FlutterwaveApiResponse<{ data: FlutterwaveVerifyData[] }>>(
      '/transactions',
      { tx_ref: reference }
    );

    this.assertSuccess(searchResponse.data, 'verifyPayment:search');

    const transactions = (searchResponse.data.data as unknown as { data: FlutterwaveVerifyData[] }).data;
    const tx = transactions?.[0];

    if (!tx) {
      throw new NgPayError({
        provider: this.name,
        code: 'PAYMENT_NOT_FOUND',
        message: `No transaction found with tx_ref: ${reference}`,
        raw: searchResponse.data,
      });
    }

    // Verify by ID for authoritative status
    const verifyResponse = await this.http.get<FlutterwaveApiResponse<FlutterwaveVerifyData>>(
      `/transactions/${tx.id}/verify`
    );

    this.assertSuccess(verifyResponse.data, 'verifyPayment:verify');

    const data = verifyResponse.data.data;

    return {
      provider: this.name,
      reference: data.tx_ref,
      status: this.normalizePaymentStatus(data.status),
      // Flutterwave returns major units — convert to kobo for consistency
      amount: { amount: Math.round(data.amount * 100), currency: data.currency as Currency },
      customer: {
        email: data.customer.email,
        name: data.customer.name || undefined,
        phone: data.customer.phone_number ?? undefined,
      },
      channel: this.normalizeChannel(data.payment_type),
      paidAt: parseDate(data.created_at),
      gatewayResponse: data.processor_response,
      fees: { amount: Math.round(data.app_fee * 100), currency: data.currency as Currency },
      raw: verifyResponse.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Virtual Accounts
  // ─────────────────────────────────────────────────────────────────────────

  async createVirtualAccount(params: VirtualAccountParams): Promise<VirtualAccount> {
    const reference = params.reference ?? generateReference('flw-va');

    const response = await this.http.post<FlutterwaveApiResponse<FlutterwaveVirtualAccountData>>(
      '/virtual-account-numbers',
      {
        email: params.customer.email,
        is_permanent: !params.expiresAt,
        bvn: (params.metadata?.['bvn'] as string) ?? undefined, // Required for permanent accounts
        tx_ref: reference,
        amount: params.expiresAt
          ? (params.metadata?.['amount'] as number) ?? undefined
          : undefined,
        frequency: params.expiresAt ? 1 : undefined,
        narration: params.description ?? params.customer.name,
      }
    );

    this.assertSuccess(response.data, 'createVirtualAccount');

    const data = response.data.data;

    return {
      provider: this.name,
      accountNumber: data.account_number,
      accountName: data.note ?? params.customer.name ?? params.customer.email,
      bankName: data.bank_name,
      bankCode: '',  // Flutterwave doesn't return bank code in this response
      reference: data.order_ref,
      expiresAt: parseDate(data.expiry_date ?? undefined),
      raw: response.data,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transfers
  // Flutterwave doesn't have a "recipient" concept — you transfer directly.
  // We store the account details in recipientCode as a JSON string.
  // ─────────────────────────────────────────────────────────────────────────

  async createTransferRecipient(params: TransferRecipientParams): Promise<TransferRecipient> {
    // Flutterwave resolves bank name from code — look it up
    const banks = await this.getBanks();
    const bank = banks.find((b) => b.code === params.bankCode);

    // Encode account details as a portable recipient code
    const recipientCode = Buffer.from(
      JSON.stringify({
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        name: params.name,
        currency: params.currency ?? 'NGN',
      })
    ).toString('base64');

    return {
      provider: this.name,
      recipientCode,
      name: params.name,
      accountNumber: params.accountNumber,
      bankCode: params.bankCode,
      bankName: bank?.name ?? params.bankCode,
      currency: params.currency ?? 'NGN',
      raw: { encoded: recipientCode },
    };
  }

  async initiateTransfer(params: TransferParams): Promise<TransferResponse> {
    const details = this.decodeRecipientCode(params.recipientCode);
    const reference = params.reference ?? generateReference('flw-trf');

    const response = await this.http.post<FlutterwaveApiResponse<FlutterwaveTransferData>>(
      '/transfers',
      {
        account_bank: details.bank_code,
        account_number: details.account_number,
        amount: params.amount.amount / 100,  // major units
        currency: params.amount.currency ?? 'NGN',
        narration: params.description ?? 'Transfer',
        reference,
        meta: params.metadata,
        debit_currency: params.amount.currency ?? 'NGN',
      }
    );

    this.assertSuccess(response.data, 'initiateTransfer');

    return this.normalizeTransferResponse(response.data.data);
  }

  async verifyTransfer(reference: string): Promise<TransferResponse> {
    const response = await this.http.get<FlutterwaveApiResponse<FlutterwaveTransferData>>(
      `/transfers`,
      { reference }
    );

    this.assertSuccess(response.data, 'verifyTransfer');

    // Response is paginated — get first match
    const transfers = (response.data.data as unknown as FlutterwaveTransferData[]);
    const transfer = transfers?.[0];

    if (!transfer) {
      throw new NgPayError({
        provider: this.name,
        code: 'PAYMENT_NOT_FOUND',
        message: `No transfer found with reference: ${reference}`,
        raw: response.data,
      });
    }

    return this.normalizeTransferResponse(transfer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Banks & Account Resolution
  // ─────────────────────────────────────────────────────────────────────────

  async getBanks(country = 'NG'): Promise<Bank[]> {
    const response = await this.http.get<FlutterwaveApiResponse<FlutterwaveBank[]>>(
      `/banks/${country}`
    );

    this.assertSuccess(response.data, 'getBanks');

    return response.data.data.map((b) => ({
      id: String(b.id),
      name: b.name,
      code: b.code,
      slug: b.name.toLowerCase().replace(/\s+/g, '-'),
      country,
      currency: 'NGN' as Currency,
      active: true,
    }));
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<AccountDetails> {
    const response = await this.http.post<FlutterwaveApiResponse<FlutterwaveAccountResolution>>(
      '/accounts/resolve',
      { account_number: accountNumber, account_bank: bankCode }
    );

    this.assertSuccess(response.data, 'resolveAccount');

    const data = response.data.data;

    return {
      accountNumber: data.account_number,
      accountName: data.account_name,
      bankCode,
      bankName: '',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Webhooks
  // Flutterwave uses a plain secret hash header — NOT HMAC.
  // The header "verif-hash" must equal your webhook secret exactly.
  // ─────────────────────────────────────────────────────────────────────────

  verifyWebhook(payload: unknown, signature: string): boolean {
    // Timing-safe string comparison to prevent timing attacks
    return timingSafeEqual(signature, this.secretKey);
  }

  parseWebhookEvent(payload: unknown): WebhookEvent {
    if (typeof payload !== 'object' || payload === null) {
      throw new ValidationError({
        provider: 'flutterwave',
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
      // Flutterwave uses tx_ref as the reference in webhooks
      reference: (data?.['tx_ref'] as string) ?? (data?.['reference'] as string) ?? undefined,
      data,
      raw: payload,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private assertSuccess<T>(response: FlutterwaveApiResponse<T>, operation: string): void {
    if (response.status !== 'success') {
      throw new NgPayError({
        provider: this.name,
        code: 'PROVIDER_ERROR',
        message: response.message ?? `Flutterwave ${operation} failed`,
        raw: response,
      });
    }
  }

  private normalizePaymentStatus(status: string): PaymentStatus {
    // Flutterwave uses "successful" not "success"
    const map: Record<string, PaymentStatus> = {
      successful: 'success',
      success: 'success',
      failed: 'failed',
      pending: 'pending',
      cancelled: 'abandoned',
      processing: 'processing',
      reversed: 'reversed',
    };
    return map[status.toLowerCase()] ?? 'pending';
  }

  private normalizeTransferStatus(status: string): TransferStatus {
    const map: Record<string, TransferStatus> = {
      successful: 'success',
      success: 'success',
      new: 'pending',
      pending: 'pending',
      failed: 'failed',
      processing: 'processing',
      reversed: 'reversed',
    };
    return map[status.toLowerCase()] ?? 'pending';
  }

  private normalizeChannel(paymentType: string): PaymentChannel | undefined {
    const map: Record<string, PaymentChannel> = {
      card: 'card',
      banktransfer: 'bank_transfer',
      account: 'bank',
      ussd: 'ussd',
      mpesa: 'mobile_money',
      mobilemoneyrwanda: 'mobile_money',
      mobilemoneyzambia: 'mobile_money',
      qr: 'qr',
    };
    return map[paymentType.toLowerCase()];
  }

  private channelToFlw(channel: PaymentChannel): string {
    const map: Record<PaymentChannel, string> = {
      card: 'card',
      bank_transfer: 'banktransfer',
      bank: 'account',
      ussd: 'ussd',
      mobile_money: 'mpesa',
      qr: 'qr',
      eft: 'eft',
    };
    return map[channel] ?? channel;
  }

  private normalizeTransferResponse(data: FlutterwaveTransferData): TransferResponse {
    return {
      provider: this.name,
      reference: data.reference,
      transferCode: String(data.id),
      status: this.normalizeTransferStatus(data.status),
      amount: { amount: Math.round(data.amount * 100), currency: data.currency as Currency },
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

  private normalizeEventType(event: string): WebhookEventType {
    // Flutterwave event names: "charge.completed", "transfer.completed"
    const map: Record<string, WebhookEventType> = {
      'charge.completed': 'charge.success',
      'transfer.completed': 'transfer.success',
      'charge.failed': 'charge.failed',
      'transfer.failed': 'transfer.failed',
      'subscription.activated': 'subscription.create',
      'subscription.cancelled': 'subscription.disable',
    };
    return map[event] ?? 'unknown';
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
