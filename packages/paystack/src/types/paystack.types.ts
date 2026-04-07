// Raw Paystack API response shapes — typed so the adapter has full safety.
// These mirror the Paystack API docs exactly.

export interface PaystackApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackCustomer {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  customer_code: string;
  phone: string | null;
  metadata: unknown;
  risk_action: string;
  international_format_phone: string | null;
}

export interface PaystackAuthorization {
  authorization_code: string;
  bin: string;
  last4: string;
  exp_month: string;
  exp_year: string;
  channel: string;
  card_type: string;
  bank: string;
  country_code: string;
  brand: string;
  reusable: boolean;
  signature: string;
  account_name: string | null;
}

export interface PaystackVerifyData {
  id: number;
  domain: string;
  status: string;
  reference: string;
  amount: number;
  message: string | null;
  gateway_response: string;
  paid_at: string | null;
  created_at: string;
  channel: string;
  currency: string;
  ip_address: string;
  metadata: unknown;
  fees: number | null;
  customer: PaystackCustomer;
  authorization: PaystackAuthorization;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedicated Virtual Accounts
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackDedicatedAccount {
  bank: {
    name: string;
    id: number;
    slug: string;
  };
  account_name: string;
  account_number: string;
  assigned: boolean;
  currency: string;
  metadata: unknown;
  active: boolean;
  id: number;
  created_at: string;
  updated_at: string;
  assignment: {
    integration: number;
    assignee_id: number;
    assignee_type: string;
    expired: boolean;
    account_type: string;
    assigned_at: string;
  };
  customer: PaystackCustomer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfers
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackTransferRecipientDetails {
  authorization_code: string | null;
  account_number: string;
  account_name: string;
  bank_code: string;
  bank_name: string;
}

export interface PaystackTransferRecipientData {
  active: boolean;
  createdAt: string;
  currency: string;
  description: string;
  domain: string;
  email: string | null;
  id: number;
  integration: number;
  metadata: unknown;
  name: string;
  recipient_code: string;
  type: string;
  updatedAt: string;
  is_deleted: boolean;
  details: PaystackTransferRecipientDetails;
}

export interface PaystackTransferData {
  reference: string;
  integration: number;
  domain: string;
  amount: number;
  currency: string;
  source: string;
  source_details: unknown;
  reason: string;
  status: string;
  failures: unknown;
  transfer_code: string;
  id: number;
  createdAt: string;
  updatedAt: string;
  recipient: PaystackTransferRecipientData;
  session: { provider: string | null; id: string | null };
  fee_charged: number | null;
  fees_breakdown: unknown;
  gateway_response: string | null;
  amount_after_factor: number | null;
  titan_code: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Banks & Account Resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackBank {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode: string;
  gateway: string | null;
  pay_with_bank: boolean;
  active: boolean;
  is_deleted: boolean;
  country: string;
  currency: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  ussd?: string;
}

export interface PaystackAccountResolution {
  account_number: string;
  account_name: string;
  bank_id: number;
}
