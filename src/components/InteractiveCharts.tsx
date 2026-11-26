import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Category, CurrencyCode, ScheduledOccurrence, Transaction } from '../types';
import { formatMoney } from '../utils/finance';

interface AllocationItem {
  id: string;
  name: string;
  amount: number;
  color: string;
  kindLabel: string;
}

export const CategoryAllocationChart: React.FC<{
  transactions: Transaction[];
  categories: Category[];
  currency: CurrencyCode;
}> = ({ transactions, categories, currency }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const items = useMemo<AllocationItem[]>(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const totals = new Map<string, { name: string; amount: number; color: string; kindLabel: string }>();

    for (const tx of transactions) {
      if (tx.type === 'income') continue;
      const cat = catMap.get(tx.categoryId);
      const existing = totals.get(tx.categoryId);
      const kindLabel =
        tx.type === 'fd'
          ? 'Fixed Deposit'
          : tx.type === 'savings'
            ? 'Savings'
            : cat?.kind === 'event'
              ? 'Event Book'
              : cat?.kind === 'recurring'
                ? 'Recurring'
                : 'Spend';

      if (existing) {
        existing.amount += tx.amount;
      } else {
        totals.set(tx.categoryId, {
          name: tx.categoryName || cat?.name || 'Other',
          amount: tx.amount,
          color: cat?.color || (tx.type === 'fd' ? '#0F766E' : tx.type === 'savings' ? '#16A34A' : '#475569'),
          kindLabel,
        });
      }
    }

    return Array.from(totals.entries())
      .map(([id, val]) => ({ id, ...val }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions, categories]);

  const grandTotal = useMemo(() => items.reduce((s, i) => s + i.amount, 0), [items]);
  const activeItem = items.find((i) => i.id === hoveredId) || items[0] || null;

  // Compute SVG donut arc geometry with generous inner hole clearance
  const radius = 70;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    if (grandTotal <= 0) return [];
    const topItems = items.slice(0, 7);
    const gap = topItems.length > 1 ? 2 : 0;
    let offsetAcc = 0;
    return topItems.map((item) => {
      const fraction = item.amount / grandTotal;
      const length = fraction * circumference;
      const dashLength = gap > 0 ? Math.max(2, length - gap) : length;
      const seg = {
        ...item,
        fraction,
        dashArray: `${dashLength} ${circumference}`,
        dashOffset: -offsetAcc,
      };
      offsetAcc += length;
      return seg;
    });
  }, [items, grandTotal, circumference]);

  if (items.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Log expenses, FDs, or savings to unlock category allocation charts.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 sm:gap-6 items-center min-w-0 w-full">
      <div className="sm:col-span-5 min-w-0 flex items-center justify-center relative">
        <svg viewBox="0 0 200 200" className="w-48 h-48 -rotate-90 shrink-0">
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="20"
            className="text-slate-100 dark:text-slate-800"
          />
          {segments.map((seg) => (
            <motion.circle
              key={seg.id}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={hoveredId === seg.id ? 24 : 20}
              strokeDasharray={seg.dashArray}
              strokeDashoffset={seg.dashOffset}
              strokeLinecap="butt"
              initial={{ opacity: 0 }}
              animate={{ opacity: hoveredId && hoveredId !== seg.id ? 0.45 : 1 }}
              transition={{ duration: 0.25 }}
              onMouseEnter={() => setHoveredId(seg.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => setHoveredId(hoveredId === seg.id ? null : seg.id)}
              className="cursor-pointer transition-all"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[96px] max-w-[96px] px-1 text-center flex flex-col items-center">
            <span className="text-[11px] leading-tight font-medium text-slate-500 dark:text-slate-400 truncate w-full">
              {activeItem ? activeItem.name : 'Total'}
            </span>
            <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5 truncate w-full">
              {formatMoney(activeItem ? activeItem.amount : grandTotal, currency)}
            </span>
            {activeItem && grandTotal > 0 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {Math.round((activeItem.amount / grandTotal) * 100)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="sm:col-span-7 min-w-0 space-y-3">
        {items.slice(0, 6).map((item) => {
          const pct = grandTotal > 0 ? Math.round((item.amount / grandTotal) * 100) : 0;
          return (
            <div
              key={item.id}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="group cursor-pointer min-w-0 w-full"
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1 min-w-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 whitespace-nowrap">
                    · {item.kindLabel}
                  </span>
                </div>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 shrink-0 whitespace-nowrap">
                  {formatMoney(item.amount, currency)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    width: `${Math.max(3, pct)}%`,
                    backgroundColor: item.color,
                    transformOrigin: 'left',
                  }}
                  className="h-full rounded-full"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface TrendBucket {
  label: string;
  spends: number;
  savingsAndFd: number;
  projectedRecurring: number;
}

export const CashflowTrendChart: React.FC<{
  buckets: TrendBucket[];
  currency: CurrencyCode;
}> = ({ buckets, currency }) => {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      const sum = b.spends + b.savingsAndFd + b.projectedRecurring;
      if (sum > m) m = sum;
    }
    return m || 1000;
  }, [buckets]);

  const activeBucket = selectedIdx !== null ? buckets[selectedIdx] : null;

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-teal-600" />
            Actual Spends
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            Upcoming Recurring
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Savings &amp; FDs
          </span>
        </div>
        {activeBucket && (
          <div className="font-mono text-slate-800 dark:text-slate-200 max-w-full">
            {activeBucket.label}: Spend {formatMoney(activeBucket.spends, currency)} · Upcoming{' '}
            {formatMoney(activeBucket.projectedRecurring, currency)} · Saved{' '}
            {formatMoney(activeBucket.savingsAndFd, currency)}
          </div>
        )}
      </div>

      <div className="h-44 flex items-end gap-1 sm:gap-2.5 pt-4 border-b border-slate-200 dark:border-slate-800 pb-2 min-w-0">
        {buckets.map((b, idx) => {
          const spendPct = (b.spends / maxVal) * 100;
          const recPct = (b.projectedRecurring / maxVal) * 100;
          const savPct = (b.savingsAndFd / maxVal) * 100;
          const isSelected = selectedIdx === idx;

          return (
            <button
              key={b.label}
              type="button"
              onMouseEnter={() => setSelectedIdx(idx)}
              onMouseLeave={() => setSelectedIdx(null)}
              onClick={() => setSelectedIdx(isSelected ? null : idx)}
              className={`flex-1 min-w-0 h-full flex flex-col justify-end items-center group focus:outline-none rounded-lg px-0 sm:px-0.5 transition-colors ${
                isSelected ? 'bg-slate-100/80 dark:bg-slate-800/60' : ''
              }`}
            >
              <div className="w-full max-w-[34px] flex-1 flex flex-col justify-end gap-0.5 pb-1">
                {savPct > 0 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.35 }}
                    style={{ height: `${Math.max(4, savPct)}%`, transformOrigin: 'bottom' }}
                    className="w-full rounded-t-sm bg-emerald-500"
                  />
                )}
                {recPct > 0 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.35 }}
                    style={{ height: `${Math.max(4, recPct)}%`, transformOrigin: 'bottom' }}
                    className="w-full bg-amber-500/90"
                  />
                )}
                {spendPct > 0 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.35 }}
                    style={{ height: `${Math.max(4, spendPct)}%`, transformOrigin: 'bottom' }}
                    className="w-full rounded-b-sm bg-teal-600"
                  />
                )}
                {spendPct === 0 && recPct === 0 && savPct === 0 && (
                  <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-800" />
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-full">
                {b.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export function buildMonthlyProjectionBuckets(
  transactions: Transaction[],
  occurrences: ScheduledOccurrence[],
  year: number,
  month0: number
): TrendBucket[] {
  // 4-5 weekly buckets within the month
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const ranges = [
    { label: '1–7', start: 1, end: 7 },
    { label: '8–14', start: 8, end: 14 },
    { label: '15–21', start: 15, end: 21 },
    { label: `22–${daysInMonth}`, start: 22, end: daysInMonth },
  ];

  const monthStr = `${year}-${String(month0 + 1).padStart(2, '0')}`;

  return ranges.map((r) => {
    let spends = 0;
    let savingsAndFd = 0;
    let projectedRecurring = 0;

    for (const tx of transactions) {
      if (!tx.date.startsWith(monthStr)) continue;
      const day = Number(tx.date.slice(8, 10));
      if (day >= r.start && day <= r.end) {
        if (tx.type === 'expense') spends += tx.amount;
        if (tx.type === 'savings' || tx.type === 'fd') savingsAndFd += tx.amount;
      }
    }

    for (const occ of occurrences) {
      if (!occ.dueDate.startsWith(monthStr)) continue;
      const day = Number(occ.dueDate.slice(8, 10));
      if (day >= r.start && day <= r.end) {
        if (occ.type === 'expense') projectedRecurring += occ.amount;
        else savingsAndFd += occ.amount;
      }
    }

    return { label: r.label, spends, savingsAndFd, projectedRecurring };
  });
}
