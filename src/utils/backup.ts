import type {
  Category,
  CategoryKind,
  CurrencyCode,
  GenericFinanceBackup,
  Household,
  RecurringFrequency,
  RecurringObligation,
  Transaction,
  TransactionScope,
  TransactionType,
} from '../types';
import { toISODate } from './finance';

const VALID_CURRENCIES: CurrencyCode[] = ['INR'];
const VALID_KINDS: CategoryKind[] = ['expense', 'event', 'recurring', 'savings', 'fd', 'income'];
const VALID_TX_TYPES: TransactionType[] = ['expense', 'income', 'savings', 'fd'];
const VALID_REC_TYPES: Array<'expense' | 'savings' | 'fd'> = ['expense', 'savings', 'fd'];
const VALID_SCOPES: TransactionScope[] = ['shared', 'personal'];
const VALID_FREQS: RecurringFrequency[] = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'];

function safeStr(val: unknown, max: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, max) || fallback;
}

function safeDate(val: unknown, fallback: string): string {
  if (typeof val === 'string') {
    const trimmed = val.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
  }
  return fallback;
}

export function buildGenericBackupPayload(
  household: Household,
  categories: Category[],
  transactions: Transaction[],
  recurring: RecurringObligation[]
): GenericFinanceBackup {
  return {
    schemaVersion: '1.0',
    format: 'generic-personal-finance-backup',
    exportedAt: new Date().toISOString(),
    sourceApp: 'MoneyLedger',
    household: {
      name: household.name,
      currency: 'INR',
      bankBalance: household.bankBalance || 0,
    },
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      icon: c.icon,
      budgetLimit: c.budgetLimit,
      splitRatio: c.splitRatio,
      isTaxDeductibleDefault: c.isTaxDeductibleDefault,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      title: t.title,
      amount: t.amount,
      type: t.type,
      scope: t.scope,
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      date: t.date,
      paidByName: t.paidByName,
      notes: t.notes,
      isTaxDeductible: t.isTaxDeductible,
      ...(t.receiptSummary ? { receiptSummary: t.receiptSummary } : {}),
    })),
    recurring: recurring.map((r) => ({
      id: r.id,
      title: r.title,
      amount: r.amount,
      frequency: r.frequency,
      type: r.type,
      scope: r.scope,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      nextDueDate: r.nextDueDate,
      ownerName: r.ownerName,
      isTaxDeductible: r.isTaxDeductible,
      isActive: r.isActive,
      notes: r.notes,
    })),
  };
}

export function downloadBackupJSON(payload: GenericFinanceBackup, filename: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseGenericFinanceBackup(rawText: string): GenericFinanceBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  const today = toISODate();

  // Support both structured backup objects and plain arrays of transactions from external apps
  const obj: Record<string, unknown> = Array.isArray(parsed)
    ? { transactions: parsed }
    : typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  if (!Array.isArray(parsed) && (typeof parsed !== 'object' || parsed === null)) {
    throw new Error('Unsupported JSON structure. Expected a backup object or transaction array.');
  }

  const rawHousehold =
    typeof obj.household === 'object' && obj.household !== null
      ? (obj.household as Record<string, unknown>)
      : {};

  const currency = VALID_CURRENCIES.includes(rawHousehold.currency as CurrencyCode)
    ? (rawHousehold.currency as CurrencyCode)
    : 'INR';

  const rawCategories = Array.isArray(obj.categories) ? obj.categories : [];
  const rawTransactions = Array.isArray(obj.transactions) ? obj.transactions : [];
  const rawRecurring = Array.isArray(obj.recurring) ? obj.recurring : [];

  if (
    rawCategories.length === 0 &&
    rawTransactions.length === 0 &&
    rawRecurring.length === 0
  ) {
    throw new Error('Backup file contains no categories, transactions, or recurring rules.');
  }

  const categories: GenericFinanceBackup['categories'] = rawCategories
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: typeof c.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(c.id) ? c.id : undefined,
      name: safeStr(c.name, 50, 'General'),
      kind: VALID_KINDS.includes(c.kind as CategoryKind) ? (c.kind as CategoryKind) : 'expense',
      color:
        typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color)
          ? c.color
          : '#0D9488',
      icon: safeStr(c.icon, 32, 'tag'),
      budgetLimit: Math.min(1e9, Math.max(0, Number(c.budgetLimit) || 0)),
      splitRatio: Math.min(100, Math.max(0, Number(c.splitRatio) || 50)),
      isTaxDeductibleDefault: Boolean(c.isTaxDeductibleDefault),
    }));

  const transactions: GenericFinanceBackup['transactions'] = rawTransactions
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => {
      const amt = Number(t.amount);
      return {
        id: typeof t.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(t.id) ? t.id : undefined,
        title: safeStr(t.title ?? t.description ?? t.merchant, 100, 'Imported Entry'),
        amount: Number.isFinite(amt) && amt > 0 ? Math.min(1e9, amt) : 1,
        type: VALID_TX_TYPES.includes(t.type as TransactionType)
          ? (t.type as TransactionType)
          : 'expense',
        scope: VALID_SCOPES.includes(t.scope as TransactionScope)
          ? (t.scope as TransactionScope)
          : 'shared',
        categoryId:
          typeof t.categoryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(t.categoryId)
            ? t.categoryId
            : undefined,
        categoryName: safeStr(t.categoryName ?? t.category, 50, 'General'),
        date: safeDate(t.date, today),
        paidByName: safeStr(t.paidByName ?? t.paidBy, 60, 'Partner'),
        notes: safeStr(t.notes, 400, ''),
        isTaxDeductible: Boolean(t.isTaxDeductible),
        ...(typeof t.receiptSummary === 'string' && t.receiptSummary.trim()
          ? { receiptSummary: safeStr(t.receiptSummary, 300) }
          : {}),
      };
    });

  const recurring: GenericFinanceBackup['recurring'] = rawRecurring
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const amt = Number(r.amount);
      return {
        id: typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.id) ? r.id : undefined,
        title: safeStr(r.title, 100, 'Recurring Rule'),
        amount: Number.isFinite(amt) && amt > 0 ? Math.min(1e9, amt) : 1,
        frequency: VALID_FREQS.includes(r.frequency as RecurringFrequency)
          ? (r.frequency as RecurringFrequency)
          : 'monthly',
        type: VALID_REC_TYPES.includes(r.type as 'expense' | 'savings' | 'fd')
          ? (r.type as 'expense' | 'savings' | 'fd')
          : 'expense',
        scope: VALID_SCOPES.includes(r.scope as TransactionScope)
          ? (r.scope as TransactionScope)
          : 'personal',
        categoryId:
          typeof r.categoryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.categoryId)
            ? r.categoryId
            : undefined,
        categoryName: safeStr(r.categoryName ?? r.category, 50, 'Recurring'),
        nextDueDate: safeDate(r.nextDueDate, today),
        ownerName: safeStr(r.ownerName, 60, 'Partner'),
        isTaxDeductible: Boolean(r.isTaxDeductible),
        isActive: r.isActive === undefined ? true : Boolean(r.isActive),
        notes: safeStr(r.notes, 300, ''),
      };
    });

  return {
    schemaVersion: safeStr(obj.schemaVersion, 20, '1.0'),
    format: 'generic-personal-finance-backup',
    exportedAt: safeStr(obj.exportedAt, 40, new Date().toISOString()),
    sourceApp: safeStr(obj.sourceApp, 60, 'External JSON'),
    household: {
      name: safeStr(rawHousehold.name, 80, 'Household Ledger'),
      currency,
      bankBalance: Number.isFinite(Number(rawHousehold.bankBalance))
        ? Number(rawHousehold.bankBalance)
        : 0,
    },
    categories,
    transactions,
    recurring,
  };
}
