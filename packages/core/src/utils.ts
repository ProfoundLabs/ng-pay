import { randomBytes } from 'crypto';
import type { AccountDetails, Bank } from './types/index.js';

/**
 * Generates a unique payment reference.
 * Format: ngp_{timestamp}_{random}
 * e.g. ngp_1712345678901_a3f9b2c1
 */
export function generateReference(prefix = 'ngp'): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Validates a Nigerian account number (10 digits, NUBAN standard)
 */
export function isValidNUBAN(accountNumber: string): boolean {
  return /^\d{10}$/.test(accountNumber);
}

/**
 * Validates a Nigerian bank code (3 digits, CBN standard)
 */
export function isValidBankCode(bankCode: string): boolean {
  return /^\d{3}$/.test(bankCode);
}

/**
 * Safely parse a date from provider responses
 */
export function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

/**
 * Enriches an AccountDetails object with bankName by looking it up
 * from a banks list. Call getBanks() first, cache the result,
 * then pass here to avoid repeated API calls.
 */
export function enrichAccountWithBankName(
  account: AccountDetails,
  banks: Bank[]
): AccountDetails {
  const bank = banks.find((b) => b.code === account.bankCode);
  return { ...account, bankName: bank?.name ?? account.bankName };
}
