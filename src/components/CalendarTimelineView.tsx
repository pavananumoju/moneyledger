import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type {
  Category,
  CurrencyCode,
  RecurringObligation,
  TimeViewMode,
  Transaction,
} from '../types';
import {
  formatMoney,
  formatShortDate,
  getMonthBounds,
  getWeekBounds,
  getYearBounds,
  projectRecurringInRange,
  toISODate,
} from '../utils/finance';
import { CashflowTrendChart, type TrendBucket } from './InteractiveCharts';

interface CalendarTimelineViewProps {
  transactions: Transaction[];
  recurring: RecurringObligation[];
  categories: Category[];
  currency: CurrencyCode;
  onAddOnDate: (dateStr: string) => void;
  onEditTx: (tx: Transaction) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const CalendarTimelineView: React.FC<CalendarTimelineViewProps> = ({
  transactions,
  recurring,
  currency,
  onAddOnDate,
  onEditTx,
}) => {
  const [mode, setMode] = useState<TimeViewMode>('monthly');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => toISODate());

  const year = anchor.getFullYear();
  const month0 = anchor.getMonth();

  const shiftPeriod = (dir: -1 | 1) => {
    const next = new Date(anchor);
    if (mode === 'weekly') {
      next.setDate(next.getDate() + dir * 7);
    } else if (mode === 'yearly') {
      next.setFullYear(next.getFullYear() + dir);
    } else {
      next.setMonth(next.getMonth() + dir);
      const today = toISODate();
      const nextPrefix = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
      setSelectedDay(today.startsWith(nextPrefix) ? today : `${nextPrefix}-01`);
    }
    setAnchor(next);
  };

  const todayIso = toISODate();
  const isViewingCurrentPeriod = useMemo(() => {
    const now = new Date();
    if (mode === 'yearly') return year === now.getFullYear();
    if (mode === 'weekly') {
      const w = getWeekBounds(anchor);
      return todayIso >= w.start && todayIso <= w.end;
    }
    return year === now.getFullYear() && month0 === now.getMonth() && selectedDay === todayIso;
  }, [mode, anchor, year, month0, selectedDay, todayIso]);

  const jumpToToday = () => {
    setAnchor(new Date());
    setSelectedDay(toISODate());
  };

  const bounds = useMemo(() => {
    if (mode === 'weekly') {
      const w = getWeekBounds(anchor);
      return { start: w.start, end: w.end, days: w.days };
    }
    if (mode === 'yearly') {
      const y = getYearBounds(year);
      return { start: y.start, end: y.end, days: [] as string[] };
    }
    const m = getMonthBounds(year, month0);
    return { start: m.start, end: m.end, days: [] as string[] };
  }, [mode, anchor, year, month0]);

  const periodTxs = useMemo(
    () =>
      transactions
        .filter((t) => t.date >= bounds.start && t.date <= bounds.end)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, bounds]
  );

  const periodOccurrences = useMemo(
    () => projectRecurringInRange(recurring, bounds.start, bounds.end),
    [recurring, bounds]
  );

  const periodTotals = useMemo(() => {
    let spent = 0;
    let saved = 0;
    let income = 0;
    for (const tx of periodTxs) {
      if (tx.type === 'expense') spent += tx.amount;
      else if (tx.type === 'savings' || tx.type === 'fd') saved += tx.amount;
      else if (tx.type === 'income') income += tx.amount;
    }
    const upcomingRecurring = periodOccurrences
      .filter((o) => o.type === 'expense')
      .reduce((s, o) => s + o.amount, 0);
    return { spent, saved, income, upcomingRecurring };
  }, [periodTxs, periodOccurrences]);

  const trendBuckets = useMemo<TrendBucket[]>(() => {
    if (mode === 'weekly') {
      return bounds.days.map((dStr) => {
        const dayDate = new Date(dStr + 'T00:00:00');
        const label = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
        const spends = periodTxs
          .filter((t) => t.date === dStr && t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0);
        const savingsAndFd = periodTxs
          .filter((t) => t.date === dStr && (t.type === 'savings' || t.type === 'fd'))
          .reduce((s, t) => s + t.amount, 0);
        const projectedRecurring = periodOccurrences
          .filter((o) => o.dueDate === dStr && o.type === 'expense')
          .reduce((s, o) => s + o.amount, 0);
        return { label, spends, savingsAndFd, projectedRecurring };
      });
    }

    if (mode === 'yearly') {
      return MONTH_NAMES.map((mName, idx) => {
        const prefix = `${year}-${String(idx + 1).padStart(2, '0')}`;
        const spends = periodTxs
          .filter((t) => t.date.startsWith(prefix) && t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0);
        const savingsAndFd = periodTxs
          .filter((t) => t.date.startsWith(prefix) && (t.type === 'savings' || t.type === 'fd'))
          .reduce((s, t) => s + t.amount, 0);
        const projectedRecurring = periodOccurrences
          .filter((o) => o.dueDate.startsWith(prefix) && o.type === 'expense')
          .reduce((s, o) => s + o.amount, 0);
        return { label: mName.slice(0, 3), spends, savingsAndFd, projectedRecurring };
      });
    }

    return [];
  }, [mode, bounds, periodTxs, periodOccurrences, year]);

  const calendarCells = useMemo(() => {
    const firstDayOfWeek = new Date(year, month0, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month0 + 1, 0).getDate();
    const cells: Array<{ dateStr: string | null; dayNum?: number }> = [];
    for (let i = 0; i < firstDayOfWeek; i++) cells.push({ dateStr: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr, dayNum: d });
    }
    return cells;
  }, [year, month0]);

  const selectedDayTxs = useMemo(
    () => periodTxs.filter((t) => t.date === selectedDay),
    [periodTxs, selectedDay]
  );
  const selectedDayDue = useMemo(
    () => periodOccurrences.filter((o) => o.dueDate === selectedDay),
    [periodOccurrences, selectedDay]
  );

  const periodHeading = useMemo(() => {
    if (mode === 'weekly') {
      return `${formatShortDate(bounds.start)} – ${formatShortDate(bounds.end)}`;
    }
    if (mode === 'yearly') return `${year}`;
    return `${MONTH_NAMES[month0]} ${year}`;
  }, [mode, bounds, year, month0]);

  return (
    <section className="w-full min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
          <button
            onClick={() => shiftPeriod(-1)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Previous period"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white min-w-0 sm:min-w-[140px] text-center truncate">
            {periodHeading}
          </h3>
          <button
            onClick={() => shiftPeriod(1)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Next period"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isViewingCurrentPeriod && (
            <button
              type="button"
              onClick={jumpToToday}
              className="min-h-[36px] px-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100/70 dark:hover:bg-teal-900/40 transition-colors whitespace-nowrap shrink-0"
            >
              Today
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-full sm:w-auto">
          {(
            [
              { id: 'weekly', label: 'Weekly' },
              { id: 'monthly', label: 'Monthly' },
              { id: 'yearly', label: 'Yearly' },
            ] as const
          ).map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`relative min-h-[36px] px-2.5 sm:px-3.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="timelineModePill"
                    transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-white dark:bg-slate-900 shadow-sm"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Period metrics strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3 border-y border-slate-100 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Actual Spent</p>
          <p className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
            {formatMoney(periodTotals.spent, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Scheduled Obligations</p>
          <p className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 truncate">
            {formatMoney(periodTotals.upcomingRecurring, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Savings &amp; FDs</p>
          <p className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
            {formatMoney(periodTotals.saved, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Income Logged</p>
          <p className="mt-1 text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
            {formatMoney(periodTotals.income, currency)}
          </p>
        </div>
      </div>

      {mode === 'monthly' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 min-w-0">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((cell, idx) => {
                if (!cell.dateStr) {
                  return <div key={`empty-${idx}`} className="h-14 sm:h-16" />;
                }
                const dayTxSum = periodTxs
                  .filter((t) => t.date === cell.dateStr && t.type === 'expense')
                  .reduce((s, t) => s + t.amount, 0);
                const dayDueCount = periodOccurrences.filter(
                  (o) => o.dueDate === cell.dateStr
                ).length;
                const isSelected = selectedDay === cell.dateStr;
                const isToday = cell.dateStr === toISODate();

                return (
                  <button
                    key={cell.dateStr}
                    onClick={() => setSelectedDay(cell.dateStr!)}
                    className={`min-w-0 overflow-hidden h-14 sm:h-16 rounded-xl border p-1 sm:p-1.5 flex flex-col justify-between items-start text-left transition-all ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/50 dark:border-teal-500'
                        : isToday
                          ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50'
                          : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="text-xs font-mono font-medium text-slate-800 dark:text-slate-200">
                      {cell.dayNum}
                    </span>
                    <div className="w-full min-w-0 space-y-0.5">
                      {dayTxSum > 0 && (
                        <div className="text-[9px] sm:text-[10px] font-mono text-teal-700 dark:text-teal-300 truncate w-full">
                          {formatMoney(dayTxSum, currency)}
                        </div>
                      )}
                      {dayDueCount > 0 && (
                        <div className="text-[9px] sm:text-[10px] font-medium text-amber-600 dark:text-amber-400 truncate w-full">
                          {dayDueCount} due
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-5 min-w-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-6 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {formatShortDate(selectedDay)}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedDayTxs.length} logged · {selectedDayDue.length} scheduled
                  </p>
                </div>
                <button
                  onClick={() => onAddOnDate(selectedDay)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Entry
                </button>
              </div>

              {selectedDayDue.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    Scheduled Deductions
                  </p>
                  {selectedDayDue.map((occ) => (
                    <div
                      key={`${occ.recurringId}-${occ.dueDate}`}
                      className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {occ.title}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 truncate">
                          {occ.categoryName} · {occ.ownerName}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                        {formatMoney(occ.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedDayTxs.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {selectedDayTxs.map((tx) => (
                    <button
                      key={tx.id}
                      onClick={() => onEditTx(tx)}
                      className="w-full py-2.5 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-1 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {tx.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {tx.categoryName} · {tx.paidByName}
                        </p>
                      </div>
                      <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white shrink-0">
                        {formatMoney(tx.amount, currency)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                selectedDayDue.length === 0 && (
                  <p className="py-6 text-xs text-slate-500 dark:text-slate-400 text-center">
                    No transactions or scheduled obligations on {formatShortDate(selectedDay)}.
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        <motion.div
          key={mode + periodHeading}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <CashflowTrendChart buckets={trendBuckets} currency={currency} />
        </motion.div>
      )}
    </section>
  );
};
