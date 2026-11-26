import React, { useMemo, useState } from 'react';
import { Download, Printer, Repeat2, Search, Trash2 } from 'lucide-react';
import { deleteTransaction } from '../services/householdService';
import type { Category, CurrencyCode, HouseholdMember, Transaction } from '../types';
import { exportTransactionsCSV, formatMoney, formatShortDate } from '../utils/finance';
import { CategoryIcon } from './CategoryIcon';

interface LedgerHistoryViewProps {
  householdId: string;
  householdName: string;
  currency: CurrencyCode;
  transactions: Transaction[];
  categories: Category[];
  members: HouseholdMember[];
  onEditTx: (tx: Transaction) => void;
  onRepeatTx: (tx: Transaction) => void;
  onSuccessToast: (msg: string) => void;
}

export const LedgerHistoryView: React.FC<LedgerHistoryViewProps> = ({
  householdId,
  householdName,
  currency,
  transactions,
  categories,
  members,
  onEditTx,
  onRepeatTx,
  onSuccessToast,
}) => {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [payerFilter, setPayerFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'shared' | 'personal'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'savings' | 'fd' | 'income'>('all');
  const [taxOnly, setTaxOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<string | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (q) {
          const hay = `${tx.title} ${tx.categoryName} ${tx.paidByName} ${tx.notes} ${tx.receiptSummary || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (catFilter !== 'all' && tx.categoryId !== catFilter) return false;
        if (payerFilter !== 'all' && tx.paidByUid !== payerFilter) return false;
        if (scopeFilter !== 'all' && tx.scope !== scopeFilter) return false;
        if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (taxOnly && !tx.isTaxDeductible) return false;
        if (dateFrom && tx.date < dateFrom) return false;
        if (dateTo && tx.date > dateTo) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, search, catFilter, payerFilter, scopeFilter, typeFilter, taxOnly, dateFrom, dateTo]);

  const totals = useMemo(() => {
    let expenses = 0;
    let savingsFd = 0;
    let taxDeductible = 0;
    for (const tx of filtered) {
      if (tx.type === 'expense') expenses += tx.amount;
      if (tx.type === 'savings' || tx.type === 'fd') savingsFd += tx.amount;
      if (tx.isTaxDeductible) taxDeductible += tx.amount;
    }
    return { expenses, savingsFd, taxDeductible };
  }, [filtered]);

  const handleExportCSV = (onlyTax: boolean) => {
    const list = onlyTax ? filtered.filter((t) => t.isTaxDeductible) : filtered;
    const prefix = onlyTax ? 'tax-report' : 'ledger-export';
    const stamp = new Date().toISOString().slice(0, 10);
    exportTransactionsCSV(list, currency, `${householdName.toLowerCase().replace(/\s+/g, '-')}-${prefix}-${stamp}.csv`);
    onSuccessToast(onlyTax ? 'Tax CSV exported' : 'Filtered ledger CSV exported');
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Transaction History &amp; Tax Export
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search across shared events, individual entries, FDs, and export tax-deductible records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            onClick={() => handleExportCSV(true)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export Tax CSV
          </button>
          <button
            onClick={() => handleExportCSV(false)}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export Filtered CSV
          </button>
          <button
            onClick={() => window.print()}
            className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 min-w-0 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search FD, MF, EMI, insurance, or notes..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-10 pr-3.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="md:col-span-3 min-w-0">
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
            >
              <option value="all">All Categories &amp; Events</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 min-w-0">
            <select
              value={payerFilter}
              onChange={(e) => setPayerFilter(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
            >
              <option value="all">All Payers</option>
              {members.map((m) => (
                <option key={m.uid} value={m.uid}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 min-w-0 grid grid-cols-2 gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="expense">Expenses</option>
              <option value="savings">Savings</option>
              <option value="fd">FDs</option>
              <option value="income">Income</option>
            </select>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
              className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="all">All Scopes</option>
              <option value="shared">Shared</option>
              <option value="personal">Individual</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto text-xs text-slate-500 dark:text-slate-400">
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="flex-1 sm:flex-initial min-w-0 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 font-mono text-xs text-slate-900 dark:text-white"
              />
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="flex-1 sm:flex-initial min-w-0 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 font-mono text-xs text-slate-900 dark:text-white"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={taxOnly}
                onChange={(e) => setTaxOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-teal-600"
              />
              Tax-Deductible Only
            </label>
          </div>

          {(search || catFilter !== 'all' || payerFilter !== 'all' || scopeFilter !== 'all' || typeFilter !== 'all' || taxOnly || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setSearch('');
                setCatFilter('all');
                setPayerFilter('all');
                setScopeFilter('all');
                setTypeFilter('all');
                setTaxOnly(false);
                setDateFrom('');
                setDateTo('');
              }}
              className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>
      </section>

      {/* Filtered Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-1">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Matching Entries</p>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">{filtered.length}</p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Expenses Total</p>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
            {formatMoney(totals.expenses, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Savings &amp; FDs</p>
          <p className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
            {formatMoney(totals.savingsFd, currency)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Tax-Deductible Total</p>
          <p className="text-lg font-bold font-mono tabular-nums text-teal-600 dark:text-teal-400 truncate">
            {formatMoney(totals.taxDeductible, currency)}
          </p>
        </div>
      </div>

      {/* Transaction List */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            No transactions match the current search or filters.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((tx) => {
              const cat = catMap.get(tx.categoryId);
              const color = cat?.color || '#0D9488';
              return (
                <div
                  key={tx.id}
                  className="px-3.5 sm:px-6 py-3.5 flex items-center justify-between gap-2 sm:gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <button
                    onClick={() => onEditTx(tx)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      <CategoryIcon icon={cat?.icon || 'tag'} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {tx.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {formatShortDate(tx.date)} · {tx.categoryName} · {tx.paidByName} ·{' '}
                        {tx.scope === 'shared' ? 'Shared' : 'Individual'}
                        {tx.isTaxDeductible ? ' · Tax-Deductible' : ''}
                      </p>
                      {tx.notes && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                          {tx.notes}
                        </p>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <span
                      className={`text-sm font-mono font-bold mr-1 ${
                        tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : tx.type === 'savings' || tx.type === 'fd'
                            ? 'text-teal-600 dark:text-teal-400'
                            : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : ''}
                      {formatMoney(tx.amount, currency)}
                    </span>
                    <button
                      onClick={() => onRepeatTx(tx)}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/30 transition-colors no-print"
                      aria-label="Repeat transaction today"
                      title="Repeat today"
                    >
                      <Repeat2 className="w-4 h-4" />
                    </button>
                    {confirmDeleteTxId === tx.id ? (
                      <div className="flex items-center gap-1 no-print">
                        <button
                          disabled={deletingTxId === tx.id}
                          onClick={async () => {
                            setDeletingTxId(tx.id);
                            try {
                              await deleteTransaction(householdId, tx.id);
                              setConfirmDeleteTxId(null);
                              onSuccessToast('Transaction deleted');
                            } catch {
                              onSuccessToast('Unable to delete transaction right now');
                            } finally {
                              setDeletingTxId(null);
                            }
                          }}
                          className="min-h-[36px] px-2.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          {deletingTxId === tx.id ? '...' : 'Delete'}
                        </button>
                        <button
                          disabled={deletingTxId === tx.id}
                          onClick={() => setConfirmDeleteTxId(null)}
                          className="min-h-[36px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteTxId(tx.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors no-print"
                        aria-label="Delete transaction"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
