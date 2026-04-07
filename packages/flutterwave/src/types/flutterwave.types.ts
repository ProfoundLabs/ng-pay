// Raw Flutterwave v3 API response shapes.
// Key differences from Paystack:
//  - Uses "tx_ref" (your ref) vs "flw_ref" (their internal ref)
//  - Status strings: "successful" not "success", "cancelled" not "abandoned"
//  - Amount is in major units (naira), NOT kobo
//  - Webhook auth uses a plain secret hash header, not HMAC

export interface FlutterwaveApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

export interface FlutterwavePaymentLinkData {
  link: string;
}

export interface FlutterwaveCustomer {
  id: number;
  name: string;
  phone_number: string | null;
  email: string;
  created_at: string;
}

export interface FlutterwaveCard {
  first_6digits: string;
  last_4digits: string;
  issuer: string;
  country: string;
  type: string;
  token: string;
  expiry: string;
}

export interface FlutterwaveVerifyData {
  id: number;
  tx_ref: string;
  flw_ref: string;
  device_fingerprint: string;
  amount: number;            // In MAJOR units (naira) — NOT kobo
  currency: string;
  charged_amount: number;
  app_fee: number;
  merchant_fee: number;
  processor_response: string;
  auth_model: string;
  ip: string;
  narration: string;
  status: string;            // "successful" | "failed" | "pending"
  payment_type: string;      // "card" | "banktransfer" | "ussd" | etc.
  created_at: string;
  account_id: number;
  card?: FlutterwaveCard;
  customer: FlutterwaveCustomer;
  meta?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Virtual Accounts
// ─────────────────────────────────────────────────────────────────────────────

export interface FlutterwaveVirtualAccountData {
  response_code: string;
  response_message: string;
  flw_ref: string;
  order_ref: string;
  account_number: string;
  account_status: string;
  frequency: number | string;
  bank_name: string;
  created_at: string;
  expiry_date: string | null;
  note: string;
  amount: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfers
// ─────────────────────────────────────────────────────────────────────────────

export interface FlutterwaveTransferData {
  id: number;
  account_number: string;
  bank_code: string;
  full_name: string;
  created_at: string;
  currency: string;
  debit_currency: string;
  amount: number;            // Major units
  fee: number;
  status: string;            // "NEW" | "PENDING" | "SUCCESSFUL" | "FAILED"
  reference: string;
  meta: unknown;
  narration: string;
  complete_message: string;
  requires_approval: number;
  is_approved: number;
  bank_name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Banks
// ─────────────────────────────────────────────────────────────────────────────

export interface FlutterwaveBank {
  id: number;
  code: string;
  name: string;
}

export interface FlutterwaveAccountResolution {
  account_number: string;
  account_name: string;
}
