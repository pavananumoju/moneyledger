export type CurrencyCode = 'INR';

export type CategoryKind = 'expense' | 'event' | 'recurring' | 'savings' | 'fd' | 'income';

export type TransactionType = 'expense' | 'income' | 'savings' | 'fd';

export type TransactionScope = 'shared' | 'personal';

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export type TimeViewMode = 'weekly' | 'monthly' | 'yearly';

export type NavTab = 'overview' | 'events' | 'recurring' | 'ledger' | 'settings';

export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  activeHouseholdId?: string;
  currency: CurrencyCode;
  notificationsEnabled: boolean;
  updatedAt?: unknown;
}

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  currency: CurrencyCode;
  ownerId: string;
  bankBalance: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HouseholdMember {
  uid: string;
  displayName: string;
  photoURL?: string;
  role: 'owner' | 'partner';
  inviteCodeUsed?: string;
  joinedAt?: unknown;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  budgetLimit: number;
  splitRatio: number;
  isTaxDeductibleDefault: boolean;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Transaction {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  scope: TransactionScope;
  categoryId: string;
  categoryName: string;
  date: string; // YYYY-MM-DD
  paidByUid: string;
  paidByName: string;
  notes: string;
  isTaxDeductible: boolean;
  recurringId?: string;
  receiptSummary?: string;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RecurringObligation {
  id: string;
  title: string;
  amount: number;
  frequency: RecurringFrequency;
  type: 'expense' | 'savings' | 'fd';
  scope: TransactionScope;
  categoryId: string;
  categoryName: string;
  nextDueDate: string; // YYYY-MM-DD
  ownerUid: string;
  ownerName: string;
  isTaxDeductible: boolean;
  isActive: boolean;
  notes: string;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HouseholdNotification {
  id: string;
  kind: 'transaction_added' | 'nudge' | 'recurring_due' | 'member_joined';
  title: string;
  message: string;
  fromUid: string;
  fromName: string;
  targetCategoryId?: string;
  targetAmount?: number;
  readByUids: string[];
  createdAt?: unknown;
}

export interface HouseholdPushSubscription {
  id: string;
  uid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  updatedAt?: unknown;
}

export interface ScheduledOccurrence {
  recurringId: string;
  title: string;
  amount: number;
  dueDate: string;
  frequency: RecurringFrequency;
  type: 'expense' | 'savings' | 'fd';
  scope: TransactionScope;
  categoryId: string;
  categoryName: string;
  ownerName: string;
  isTaxDeductible: boolean;
  daysUntilDue: number;
}

export interface GenericFinanceBackup {
  schemaVersion: string;
  format: 'generic-personal-finance-backup';
  exportedAt: string;
  sourceApp: string;
  household: {
    name: string;
    currency: CurrencyCode;
    bankBalance?: number;
  };
  categories: Array<{
    id?: string;
    name: string;
    kind: CategoryKind;
    color: string;
    icon: string;
    budgetLimit: number;
    splitRatio: number;
    isTaxDeductibleDefault: boolean;
  }>;
  transactions: Array<{
    id?: string;
    title: string;
    amount: number;
    type: TransactionType;
    scope: TransactionScope;
    categoryId?: string;
    categoryName: string;
    date: string;
    paidByName: string;
    notes: string;
    isTaxDeductible: boolean;
    receiptSummary?: string;
  }>;
  recurring: Array<{
    id?: string;
    title: string;
    amount: number;
    frequency: RecurringFrequency;
    type: 'expense' | 'savings' | 'fd';
    scope: TransactionScope;
    categoryId?: string;
    categoryName: string;
    nextDueDate: string;
    ownerName: string;
    isTaxDeductible: boolean;
    isActive: boolean;
    notes: string;
  }>;
}

