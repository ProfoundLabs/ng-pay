// Raw Monnify API response shapes.
// Key differences from Paystack/Flutterwave:
//  - Two-step auth: Basic auth → OAuth token → Bearer token on all subsequent calls
//  - Amount in major units (naira)
//  - "Reserved accounts" instead of "virtual accounts"
//  - Uses contractCode (merchant identifier) on most endpoints
//  - Status: "PAID", "PENDING", "FAILED", "OVERPAID", "PARTIALLY_PAID"

export interface MonnifyApiResponse<T> {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

export interface MonnifyTokenData {
  accessToken: string;
  expiresIn: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments (Checkout)
// ─────────────────────────────────────────────────────────────────────────────

export interface MonnifyInitPaymentData {
  transactionReference: string;
  paymentReference: string;
  merchantName: string;
  apiKey: string;
  redirectUrl: string;
  enabledPaymentMethod: string[];
  checkoutUrl: string;
}

export interface MonnifyPaymentData {
  transactionReference: string;
  paymentReference: string;
  amountPaid: number;
  totalPayable: number;
  settlementAmount: number;
  paidOn: string | null;
  paymentStatus: string;
  paymentDescription: string;
  currency: string;
  paymentMethod: string;
  product: {
    reference: string;
    type: string;
  };
  cardDetails: unknown | null;
  accountDetails: {
    accountName: string;
    accountNumber: string;
    bankCode: string;
    bankName: string;
  } | null;
  customer: {
    email: string;
    name: string;
  };
  metaData: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reserved Accounts (Virtual Accounts)
// ─────────────────────────────────────────────────────────────────────────────

export interface MonnifyReservedAccountData {
  contractCode: string;
  accountReference: string;
  accountName: string;
  currencyCode: string;
  customerEmail: string;
  customerName: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  collectionChannel: string;
  reservationReference: string;
  reservedAccountType: string;
  status: string;
  createdOn: string;
  incomeSplitConfig: unknown[];
  restrictPaymentSource: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfers / Disbursements
// ─────────────────────────────────────────────────────────────────────────────

export interface MonnifyDisbursementData {
  amount: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  destinationBankName: string;
  status: string;           // "SUCCESS" | "PENDING" | "FAILED"
  dateCreated: string;
  totalFee: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Banks
// ─────────────────────────────────────────────────────────────────────────────

export interface MonnifyBank {
  name: string;
  code: string;
  ussdTemplate: string | null;
  baseUssdCode: string | null;
  transferUssdTemplate: string | null;
}

export interface MonnifyAccountResolution {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}
