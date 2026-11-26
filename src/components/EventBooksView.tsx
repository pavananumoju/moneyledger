import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, Pencil, Plus, Scale, Send, Trash2, X } from 'lucide-react';
import {
  createCategory,
  deleteCategory,
  sendPartnerNudge,
  updateCategory,
} from '../services/householdService';
import type {
  Category,
  CategoryKind,
  CurrencyCode,
  HouseholdMember,
  Transaction,
} from '../types';
import { formatMoney, formatShortDate } from '../utils/finance';
import {
  CATEGORY_COLOR_OPTIONS,
  CATEGORY_ICON_OPTIONS,
  CategoryIcon,
} from './CategoryIcon';

interface EventBooksViewProps {
  householdId: string;
  currentUid: string;
  currentName: string;
  currency: CurrencyCode;
  categories: Category[];
  transactions: Transaction[];
  members: HouseholdMember[];
  initialCategoryId?: string | null;
  onAddTxForCategory: (categoryId: string) => void;
  onSettleUp: (opts: {
    categoryId: string;
    categoryName: string;
    fromUid: string;
    toName: string;
    amount: number;
  }) => void;
  onEditTx: (tx: Transaction) => void;
  onSuccessToast: (msg: string) => void;
}

export const EventBooksView: React.FC<EventBooksViewProps> = ({
  householdId,
  currentUid,
  currentName,
  currency,
  categories,
  transactions,
  members,
  initialCategoryId,
  onAddTxForCategory,
  onSettleUp,
  onEditTx,
  onSuccessToast,
}) => {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(initialCategoryId || null);

  React.useEffect(() => {
    if (initialCategoryId) {
      setSelectedBookId(initialCategoryId);
    }
  }, [initialCategoryId]);
  const [showBookModal, setShowBookModal] = useState(false);
  const [editingBook, setEditingBook] = useState<Category | null>(null);

  const [bookName, setBookName] = useState('');
  const [bookKind, setBookKind] = useState<CategoryKind>('event');
  const [bookColor, setBookColor] = useState(CATEGORY_COLOR_OPTIONS[0]);
  const [bookIcon, setBookIcon] = useState('heart-pulse');
  const [bookBudget, setBookBudget] = useState('50000');
  const [bookSplit, setBookSplit] = useState('50');
  const [bookTaxDefault, setBookTaxDefault] = useState(false);
  const [savingBook, setSavingBook] = useState(false);

  const [nudgeTarget, setNudgeTarget] = useState<Category | null>(null);
  const [nudgeAmount, setNudgeAmount] = useState('');
  const [nudgeMsg, setNudgeMsg] = useState('');
  const [sendingNudge, setSendingNudge] = useState(false);
  const [confirmDeleteBookId, setConfirmDeleteBookId] = useState<string | null>(null);
  const [deletingBook, setDeletingBook] = useState(false);

  const activeBook = useMemo(
    () => categories.find((c) => c.id === selectedBookId) || categories[0] || null,
    [categories, selectedBookId]
  );

  const bookSummaries = useMemo(() => {
    return categories.map((cat) => {
      const txs = transactions.filter((t) => t.categoryId === cat.id);
      const total = txs.reduce((s, t) => s + t.amount, 0);

      // Compute fair-share split strictly across shared non-income entries
      const sharedTxs = txs.filter((t) => t.scope === 'shared' && t.type !== 'income');
      const sharedTotal = sharedTxs.reduce((s, t) => s + t.amount, 0);
      const byMember = new Map<string, { name: string; amount: number; role?: 'owner' | 'partner' }>();

      for (const m of members) {
        byMember.set(m.uid, { name: m.displayName, amount: 0, role: m.role });
      }
      for (const tx of sharedTxs) {
        const prev = byMember.get(tx.paidByUid);
        if (prev) prev.amount += tx.amount;
        else byMember.set(tx.paidByUid, { name: tx.paidByName, amount: tx.amount });
      }

      const contributions = Array.from(byMember.entries()).map(([uid, v]) => ({ uid, ...v }));
      const splitRatio = Math.min(100, Math.max(0, Number(cat.splitRatio ?? 50)));

      let settlement: {
        fromUid: string;
        fromName: string;
        toName: string;
        amount: number;
        splitLabel: string;
      } | null = null;

      if (sharedTotal > 0 && contributions.length === 2) {
        const ownerEntry = contributions.find((c) => c.role === 'owner') || contributions[0];
        const partnerEntry = contributions.find((c) => c.uid !== ownerEntry.uid)!;
        const ownerTarget = (sharedTotal * splitRatio) / 100;
        const ownerDiff = Math.round(ownerEntry.amount - ownerTarget);
        const splitLabel = `${splitRatio}/${100 - splitRatio}`;

        if (ownerDiff > 0) {
          settlement = {
            fromUid: partnerEntry.uid,
            fromName: partnerEntry.name,
            toName: ownerEntry.name,
            amount: ownerDiff,
            splitLabel,
          };
        } else if (ownerDiff < 0) {
          settlement = {
            fromUid: ownerEntry.uid,
            fromName: ownerEntry.name,
            toName: partnerEntry.name,
            amount: Math.abs(ownerDiff),
            splitLabel,
          };
        }
      } else if (sharedTotal > 0 && contributions.length > 2) {
        const fairShare = sharedTotal / contributions.length;
        const sorted = [...contributions].sort((a, b) => b.amount - a.amount);
        const leader = sorted[0];
        const trailing = sorted[sorted.length - 1];
        const gap = Math.max(0, Math.round(fairShare - trailing.amount));
        if (gap > 0 && leader.uid !== trailing.uid) {
          settlement = {
            fromUid: trailing.uid,
            fromName: trailing.name,
            toName: leader.name,
            amount: gap,
            splitLabel: 'Equal',
          };
        }
      }

      return {
        category: cat,
        txs: txs.sort((a, b) => b.date.localeCompare(a.date)),
        total,
        sharedTotal,
        contributions,
        settlement,
      };
    });
  }, [categories, transactions, members]);

  const activeSummary = useMemo(
    () => bookSummaries.find((b) => b.category.id === activeBook?.id) || null,
    [bookSummaries, activeBook]
  );

  const monthlySeries = useMemo(() => {
    if (!activeSummary) return [];
    const map = new Map<string, number>();
    for (const tx of activeSummary.txs) {
      const ym = tx.date.slice(0, 7);
      map.set(ym, (map.get(ym) || 0) + tx.amount);
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(...entries.map((e) => e[1]), 1);
    return entries.map(([ym, amt]) => {
      const [y, m] = ym.split('-');
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      return { ym, label, amount: amt, pct: Math.round((amt / max) * 100) };
    });
  }, [activeSummary]);

  const openCreateBook = () => {
    setEditingBook(null);
    setBookName('');
    setBookKind('event');
    setBookColor(CATEGORY_COLOR_OPTIONS[0]);
    setBookIcon('gift');
    setBookBudget('50000');
    setBookSplit('50');
    setBookTaxDefault(false);
    setShowBookModal(true);
  };

  const openEditBook = (cat: Category) => {
    setEditingBook(cat);
    setBookName(cat.name);
    setBookKind(cat.kind);
    setBookColor(cat.color);
    setBookIcon(cat.icon);
    setBookBudget(String(cat.budgetLimit));
    setBookSplit(String(cat.splitRatio));
    setBookTaxDefault(cat.isTaxDeductibleDefault);
    setShowBookModal(true);
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookName.trim()) return;
    setSavingBook(true);
    try {
      if (editingBook) {
        await updateCategory(householdId, editingBook.id, {
          name: bookName.trim(),
          kind: bookKind,
          color: bookColor,
          icon: bookIcon,
          budgetLimit: Number(bookBudget) || 0,
          splitRatio: Number(bookSplit) || 50,
          isTaxDeductibleDefault: bookTaxDefault,
        });
        onSuccessToast('Book updated');
      } else {
        const id = await createCategory(householdId, currentUid, {
          name: bookName.trim(),
          kind: bookKind,
          color: bookColor,
          icon: bookIcon,
          budgetLimit: Number(bookBudget) || 0,
          splitRatio: Number(bookSplit) || 50,
          isTaxDeductibleDefault: bookTaxDefault,
        });
        setSelectedBookId(id);
        onSuccessToast('New category/event book created');
      }
      setShowBookModal(false);
    } catch {
      onSuccessToast('Unable to save book right now');
    } finally {
      setSavingBook(false);
    }
  };

  const openNudgeModal = (
    cat: Category,
    totalSpent: number,
    settlementGap?: number | null
  ) => {
    const sharePct = (100 - (cat.splitRatio || 50)) / 100;
    const suggested =
      settlementGap && settlementGap > 0
        ? settlementGap
        : Math.round(totalSpent * sharePct);
    setNudgeTarget(cat);
    setNudgeAmount(
      String(suggested > 0 ? suggested : Math.round((cat.budgetLimit || 10000) * 0.5))
    );
    setNudgeMsg(
      settlementGap && settlementGap > 0
        ? `Quick update on ${cat.name}: total is ${formatMoney(totalSpent, currency)}. Your share difference is ${formatMoney(settlementGap, currency)} — please add your recent bills or share!`
        : `Quick update on ${cat.name}: we've logged ${formatMoney(totalSpent, currency)} across all months. Please add your recent entries or share!`
    );
  };

  const handleSendNudge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nudgeTarget) return;
    setSendingNudge(true);
    try {
      await sendPartnerNudge(
        householdId,
        currentUid,
        currentName,
        nudgeTarget.id,
        nudgeTarget.name,
        Number(nudgeAmount) || 0,
        nudgeMsg
      );
      setNudgeTarget(null);
      onSuccessToast('Contribution nudge sent to partner');
    } catch {
      onSuccessToast('Unable to send nudge right now');
    } finally {
      setSendingNudge(false);
    }
  };

  const handleDeleteBook = async (catId: string) => {
    setDeletingBook(true);
    try {
      await deleteCategory(householdId, catId);
      setConfirmDeleteBookId(null);
      setSelectedBookId(null);
      onSuccessToast('Category removed');
    } catch {
      onSuccessToast('Unable to delete book right now');
    } finally {
      setDeletingBook(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Event Books &amp; Custom Categories
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track multi-month goals like Family Events, Home Renovation, or Mutual Funds together.
          </p>
        </div>
        <button
          onClick={openCreateBook}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Book / Category
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {bookSummaries.map(({ category, total, txs }) => {
            const isSelected = activeBook?.id === category.id;
            const pct =
              category.budgetLimit > 0
                ? Math.min(100, Math.round((total / category.budgetLimit) * 100))
                : 0;

            return (
              <button
                key={category.id}
                onClick={() => setSelectedBookId(category.id)}
                className={`w-full p-4 text-left transition-colors flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-teal-50/70 dark:bg-teal-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: category.color }}
                  >
                    <CategoryIcon icon={category.icon} className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {category.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {category.kind === 'event'
                        ? 'Event Book'
                        : category.kind === 'fd'
                          ? 'Fixed Deposit'
                          : category.kind === 'savings'
                            ? 'Savings'
                            : category.kind === 'recurring'
                              ? 'Recurring'
                              : category.kind === 'income'
                                ? 'Income'
                                : 'Category'}{' '}
                      · {txs.length} {txs.length === 1 ? 'entry' : 'entries'}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                    {formatMoney(total, currency)}
                  </p>
                  {category.budgetLimit > 0 && (
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {pct}% of {formatMoney(category.budgetLimit, currency)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-7 min-w-0">
          {activeSummary ? (
            <motion.div
              key={activeSummary.category.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: activeSummary.category.color }}
                  >
                    <CategoryIcon icon={activeSummary.category.icon} className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white break-words">
                      {activeSummary.category.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      All-time total across all months · {activeSummary.txs.length} transactions
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      openNudgeModal(
                        activeSummary.category,
                        activeSummary.total,
                        activeSummary.settlement?.amount
                      )
                    }
                    className="min-h-[40px] px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-950/70 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    Nudge Partner
                  </button>
                  <button
                    onClick={() => onAddTxForCategory(activeSummary.category.id)}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Expense
                  </button>
                  <button
                    onClick={() => openEditBook(activeSummary.category)}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    aria-label="Edit book"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {categories.length > 1 && (
                    confirmDeleteBookId === activeSummary.category.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={deletingBook}
                          onClick={() => handleDeleteBook(activeSummary.category.id)}
                          className="min-h-[40px] px-3 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          {deletingBook ? 'Deleting...' : 'Confirm Delete'}
                        </button>
                        <button
                          type="button"
                          disabled={deletingBook}
                          onClick={() => setConfirmDeleteBookId(null)}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteBookId(activeSummary.category.id)}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        aria-label="Delete book"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Total & Partner Contribution Split + Fair-Share Settlement */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Cumulative Book Total
                  </p>
                  <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
                    {formatMoney(activeSummary.total, currency)}
                  </p>
                  {activeSummary.category.budgetLimit > 0 && (
                    <div className="mt-2.5 space-y-1">
                      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Target Budget</span>
                        <span className="font-mono">
                          {formatMoney(activeSummary.category.budgetLimit, currency)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (activeSummary.total / activeSummary.category.budgetLimit) * 100
                              )
                            )}%`,
                            backgroundColor: activeSummary.category.color,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Shared Partner Contributions &amp; Fair-Share
                  </p>
                  {activeSummary.sharedTotal === 0 && activeSummary.total > 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Entries in this book are marked Individual (no shared split required).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeSummary.contributions.map((c) => {
                        const pct =
                          activeSummary.sharedTotal > 0
                            ? Math.round((c.amount / activeSummary.sharedTotal) * 100)
                            : 0;
                        return (
                          <div key={c.uid} className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate pr-2">
                              {c.name}
                            </span>
                            <span className="font-mono text-slate-900 dark:text-white shrink-0">
                              {formatMoney(c.amount, currency)} ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {activeSummary.settlement && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-teal-700 dark:text-teal-300">
                      <div className="flex items-center gap-2">
                        <Scale className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {activeSummary.settlement.splitLabel} split:{' '}
                          <strong>{activeSummary.settlement.fromName}</strong> owes{' '}
                          <strong className="font-mono">
                            {formatMoney(activeSummary.settlement.amount, currency)}
                          </strong>{' '}
                          to {activeSummary.settlement.toName}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          onSettleUp({
                            categoryId: activeSummary.category.id,
                            categoryName: activeSummary.category.name,
                            fromUid: activeSummary.settlement!.fromUid,
                            toName: activeSummary.settlement!.toName,
                            amount: activeSummary.settlement!.amount,
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-teal-600 text-white text-[11px] font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap"
                      >
                        Settle Up
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {monthlySeries.length > 0 && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Monthly Spend Across Time
                  </p>
                  <div className="overflow-x-auto pb-1">
                    <div className="h-32 flex items-end gap-2.5 min-w-full w-max">
                      {monthlySeries.map((m) => (
                        <div key={m.ym} className="min-w-[64px] flex-1 h-full flex flex-col justify-end items-center gap-1">
                          <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate max-w-full">
                            {formatMoney(m.amount, currency)}
                          </span>
                          <motion.div
                            initial={{ scaleY: 0 }}
                            animate={{ scaleY: 1 }}
                            transition={{ duration: 0.35 }}
                            style={{
                              height: `${Math.max(12, m.pct * 0.62)}%`,
                              backgroundColor: activeSummary.category.color,
                              transformOrigin: 'bottom',
                            }}
                            className="w-full max-w-[38px] rounded-t-md"
                          />
                          <span className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {m.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  All Entries in {activeSummary.category.name}
                </p>
                {activeSummary.txs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No entries logged yet. Tap &ldquo;Add Expense&rdquo; to record the first milestone.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeSummary.txs.map((tx) => (
                      <button
                        key={tx.id}
                        onClick={() => onEditTx(tx)}
                        className="w-full py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 px-1 rounded-lg transition-colors"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {tx.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {formatShortDate(tx.date)} · Paid by {tx.paidByName} ·{' '}
                            {tx.scope === 'shared' ? 'Shared' : 'Individual'}
                          </p>
                        </div>
                        <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white shrink-0">
                          {formatMoney(tx.amount, currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>

      {/* Create / Edit Category Modal */}
      <AnimatePresence>
        {showBookModal && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 overflow-hidden"
            onTouchMove={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {editingBook ? 'Edit Book / Category' : 'New Event Book or Category'}
                </h3>
                <button
                  onClick={() => setShowBookModal(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveBook} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    placeholder="e.g. Family Vacation, Home Upgrade, Mutual Funds"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Book Type
                    </label>
                    <select
                      value={bookKind}
                      onChange={(e) => setBookKind(e.target.value as CategoryKind)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      <option value="event">Event / Goal Book</option>
                      <option value="expense">Regular Expense</option>
                      <option value="recurring">Recurring Bills</option>
                      <option value="savings">Savings</option>
                      <option value="fd">Fixed Deposit (FD)</option>
                      <option value="income">Income</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Target Budget
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={bookBudget}
                      onChange={(e) => setBookBudget(e.target.value)}
                      placeholder="e.g. 85000"
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Icon
                    </label>
                    <select
                      value={bookIcon}
                      onChange={(e) => setBookIcon(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      {CATEGORY_ICON_OPTIONS.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Target Split (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={bookSplit}
                      onChange={(e) => setBookSplit(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Color
                  </label>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {CATEGORY_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBookColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          bookColor === c
                            ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110'
                            : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bookTaxDefault}
                    onChange={(e) => setBookTaxDefault(e.target.checked)}
                    className="w-4 h-4 rounded accent-teal-600"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Mark entries tax-deductible by default
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={savingBook}
                  className="w-full min-h-[46px] rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {savingBook ? 'Saving...' : editingBook ? 'Save Changes' : 'Create Book'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Nudge Partner Modal */}
      <AnimatePresence>
        {nudgeTarget && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 overflow-hidden"
            onTouchMove={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white truncate min-w-0">
                  Nudge Partner · {nudgeTarget.name}
                </h3>
                <button
                  onClick={() => setNudgeTarget(null)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleSendNudge} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Suggested Share Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={nudgeAmount}
                    onChange={(e) => setNudgeAmount(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Message
                  </label>
                  <textarea
                    rows={3}
                    required
                    maxLength={300}
                    value={nudgeMsg}
                    onChange={(e) => setNudgeMsg(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-2.5">
                  <button
                    type="submit"
                    disabled={sendingNudge}
                    className="w-full min-h-[46px] rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-700 inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" />
                    {sendingNudge ? 'Sending Nudge...' : 'Send Real-Time Nudge'}
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `${nudgeMsg}${Number(nudgeAmount) > 0 ? ` (Suggested share: ${formatMoney(Number(nudgeAmount), currency)})` : ''}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[44px] rounded-xl bg-[#25D366] hover:bg-[#1EBE5D] text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.79 14.08c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.01-2.42.27-.29.58-.36.77-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.02 1.12.99 2.06 1.3 2.35 1.45.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.15.27.1 1.69.8 1.98.94.29.15.48.22.55.34.07.12.07.7-.17 1.38z" />
                    </svg>
                    Share Nudge on WhatsApp
                  </a>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
