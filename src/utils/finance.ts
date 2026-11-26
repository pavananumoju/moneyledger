import type {
  CurrencyCode,
  RecurringFrequency,
  RecurringObligation,
  ScheduledOccurrence,
  Transaction,
} from '../types';

export function getCurrencySymbol(_currency: CurrencyCode = 'INR'): string {
  return '₹';
}

export function formatMoney(amount: number, _currency: CurrencyCode = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatShortDate(dateStr: string): string {
  const d = parseISODate(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatFullDate(dateStr: string): string {
  const d = parseISODate(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function diffDays(fromDateStr: string, toDateStr: string): number {
  const a = parseISODate(fromDateStr).getTime();
  const b = parseISODate(toDateStr).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const day = date.getDate();
  const targetFirst = new Date(year, month, 1);
  const lastDayOfTargetMonth = new Date(
    targetFirst.getFullYear(),
    targetFirst.getMonth() + 1,
    0
  ).getDate();
  return new Date(
    targetFirst.getFullYear(),
    targetFirst.getMonth(),
    Math.min(day, lastDayOfTargetMonth)
  );
}

export function addFrequency(dateStr: string, frequency: RecurringFrequency): string {
  const d = parseISODate(dateStr);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      return toISODate(d);
    case 'monthly':
      return toISODate(addMonthsClamped(d, 1));
    case 'quarterly':
      return toISODate(addMonthsClamped(d, 3));
    case 'half_yearly':
      return toISODate(addMonthsClamped(d, 6));
    case 'yearly':
      return toISODate(addMonthsClamped(d, 12));
  }
}

export function frequencyLabel(freq: RecurringFrequency): string {
  switch (freq) {
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'half_yearly':
      return 'Half-Yearly';
    case 'yearly':
      return 'Yearly';
  }
}

export function projectRecurringInRange(
  recurringList: RecurringObligation[],
  startDateStr: string,
  endDateStr: string,
  referenceTodayStr: string = toISODate()
): ScheduledOccurrence[] {
  const occurrences: ScheduledOccurrence[] = [];

  for (const rec of recurringList) {
    if (!rec.isActive || !rec.nextDueDate) continue;
    let cursor = rec.nextDueDate;
    let guard = 0;

    // Roll forward if cursor is strictly before startDateStr
    while (cursor < startDateStr && guard < 120) {
      cursor = addFrequency(cursor, rec.frequency);
      guard++;
    }

    while (cursor <= endDateStr && guard < 240) {
      occurrences.push({
        recurringId: rec.id,
        title: rec.title,
        amount: rec.amount,
        dueDate: cursor,
        frequency: rec.frequency,
        type: rec.type,
        scope: rec.scope,
        categoryId: rec.categoryId,
        categoryName: rec.categoryName,
        ownerName: rec.ownerName,
        isTaxDeductible: rec.isTaxDeductible,
        daysUntilDue: diffDays(referenceTodayStr, cursor),
      });
      cursor = addFrequency(cursor, rec.frequency);
      guard++;
    }
  }

  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function getOverdueRecurring(
  recurringList: RecurringObligation[],
  referenceTodayStr: string = toISODate()
): ScheduledOccurrence[] {
  return recurringList
    .filter((rec) => rec.isActive && rec.nextDueDate && rec.nextDueDate < referenceTodayStr)
    .map((rec) => ({
      recurringId: rec.id,
      title: rec.title,
      amount: rec.amount,
      dueDate: rec.nextDueDate,
      frequency: rec.frequency,
      type: rec.type,
      scope: rec.scope,
      categoryId: rec.categoryId,
      categoryName: rec.categoryName,
      ownerName: rec.ownerName,
      isTaxDeductible: rec.isTaxDeductible,
      daysUntilDue: diffDays(referenceTodayStr, rec.nextDueDate),
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function getWeekBounds(anchorDate: Date): { start: string; end: string; days: string[] } {
  const start = new Date(anchorDate);
  const day = start.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMon);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(toISODate(d));
  }
  return { start: days[0], end: days[6], days };
}

export function getMonthBounds(year: number, monthIndex0: number): { start: string; end: string } {
  const first = new Date(year, monthIndex0, 1);
  const last = new Date(year, monthIndex0 + 1, 0);
  return { start: toISODate(first), end: toISODate(last) };
}

export function getYearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function exportTransactionsCSV(
  transactions: Transaction[],
  _currency: CurrencyCode,
  filename: string
): void {
  const headers = [
    'Date',
    'Title',
    'Type',
    'Category / Event Book',
    'Scope',
    'Paid By',
    'Amount (INR)',
    'Tax Deductible',
    'Notes',
    'Receipt Summary',
  ];

  const escapeCsv = (val: string | number | boolean | undefined): string => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = transactions.map((tx) => [
    escapeCsv(tx.date),
    escapeCsv(tx.title),
    escapeCsv(tx.type.toUpperCase()),
    escapeCsv(tx.categoryName),
    escapeCsv(tx.scope),
    escapeCsv(tx.paidByName),
    escapeCsv(tx.amount),
    escapeCsv(tx.isTaxDeductible ? 'Yes' : 'No'),
    escapeCsv(tx.notes),
    escapeCsv(tx.receiptSummary || ''),
  ]);

  const csvContent =
    '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows.map((r) => r.join(','))].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const STARTER_CATEGORIES = [
  {
    name: 'Mutual Funds & SIPs',
    kind: 'savings' as const,
    color: '#0D9488',
    icon: 'piggy-bank',
    budgetLimit: 100000,
    splitRatio: 50,
    isTaxDeductibleDefault: true,
  },
  {
    name: 'Family Events & Milestones',
    kind: 'event' as const,
    color: '#D97706',
    icon: 'gift',
    budgetLimit: 75000,
    splitRatio: 50,
    isTaxDeductibleDefault: false,
  },
  {
    name: 'EMIs & Loans',
    kind: 'recurring' as const,
    color: '#2563EB',
    icon: 'landmark',
    budgetLimit: 45000,
    splitRatio: 50,
    isTaxDeductibleDefault: true,
  },
  {
    name: 'LIC & Health Insurance',
    kind: 'recurring' as const,
    color: '#059669',
    icon: 'shield',
    budgetLimit: 60000,
    splitRatio: 50,
    isTaxDeductibleDefault: true,
  },
  {
    name: 'FDs & Savings',
    kind: 'fd' as const,
    color: '#0F766E',
    icon: 'piggy-bank',
    budgetLimit: 50000,
    splitRatio: 50,
    isTaxDeductibleDefault: false,
  },
  {
    name: 'Taxes & Subscriptions',
    kind: 'recurring' as const,
    color: '#7C3AED',
    icon: 'receipt',
    budgetLimit: 30000,
    splitRatio: 50,
    isTaxDeductibleDefault: true,
  },
  {
    name: 'Daily Living & Groceries',
    kind: 'expense' as const,
    color: '#475569',
    icon: 'shopping-bag',
    budgetLimit: 25000,
    splitRatio: 50,
    isTaxDeductibleDefault: false,
  },
  {
    name: 'Salary & Household Income',
    kind: 'income' as const,
    color: '#16A34A',
    icon: 'wallet',
    budgetLimit: 0,
    splitRatio: 50,
    isTaxDeductibleDefault: false,
  },
];

export function triggerHaptic(ms: number = 10): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore unsupported environments
    }
  }
}

export function formatRelativeTime(ts: unknown): string {
  if (!ts) return 'Just now';
  let ms = 0;
  if (typeof ts === 'number') {
    ms = ts;
  } else if (ts instanceof Date) {
    ms = ts.getTime();
  } else if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    ms = (ts as { toMillis: () => number }).toMillis();
  } else if (typeof ts === 'object' && ts !== null && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    ms = (ts as { seconds: number }).seconds * 1000;
  }
  if (!ms) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return 'Just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getMonthPaceComparison(transactions: Transaction[], today: Date = new Date()): {
  thisMonthToDate: number;
  lastMonthSamePeriod: number;
  deltaAmount: number;
  deltaPct: number | null;
} {
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = today.getDate();

  const curPrefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const curEnd = toISODate(today);

  const prevDate = new Date(y, m - 1, 1);
  const prevY = prevDate.getFullYear();
  const prevM = prevDate.getMonth();
  const prevDaysInMonth = new Date(prevY, prevM + 1, 0).getDate();
  const prevClampedDay = Math.min(day, prevDaysInMonth);
  const prevStart = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
  const prevEnd = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(prevClampedDay).padStart(2, '0')}`;

  let thisMonthToDate = 0;
  let lastMonthSamePeriod = 0;

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    if (tx.date >= `${curPrefix}-01` && tx.date <= curEnd) {
      thisMonthToDate += tx.amount;
    } else if (tx.date >= prevStart && tx.date <= prevEnd) {
      lastMonthSamePeriod += tx.amount;
    }
  }

  const deltaAmount = thisMonthToDate - lastMonthSamePeriod;
  const deltaPct =
    lastMonthSamePeriod > 0 ? Math.round((deltaAmount / lastMonthSamePeriod) * 100) : null;

  return { thisMonthToDate, lastMonthSamePeriod, deltaAmount, deltaPct };
}

