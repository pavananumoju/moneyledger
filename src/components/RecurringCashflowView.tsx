import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  createRecurringObligation,
  deleteRecurringObligation,
  markRecurringPaid,
  updateHouseholdSettings,
  updateRecurringObligation,
} from '../services/householdService';
import type {
  Category,
  CurrencyCode,
  Household,
  HouseholdMember,
  RecurringFrequency,
  RecurringObligation,
  TransactionScope,
} from '../types';
import {
  formatMoney,
  formatShortDate,
  frequencyLabel,
  getCurrencySymbol,
  getMonthBounds,
  getOverdueRecurring,
  projectRecurringInRange,
  toISODate,
} from '../utils/finance';

interface RecurringCashflowViewProps {
  household: Household;
  currentUid: string;
  currentName: string;
  members: HouseholdMember[];
  categories: Category[];
  recurring: RecurringObligation[];
  onSuccessToast: (msg: string) => void;
}

export const RecurringCashflowView: React.FC<RecurringCashflowViewProps> = ({
  household,
  currentUid,
  currentName,
  members,
  categories,
  recurring,
  onSuccessToast,
}) => {
  const hasSavedBalance = (household.bankBalance ?? 0) > 0;
  const [showBalanceCheck, setShowBalanceCheck] = useState(hasSavedBalance);
  const [balanceInput, setBalanceInput] = useState(
    hasSavedBalance ? String(household.bankBalance) : ''
  );
  const [savingBalance, setSavingBalance] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingRec, setEditingRec] = useState<RecurringObligation | null>(null);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [type, setType] = useState<'expense' | 'savings' | 'fd'>('expense');
  const [scope, setScope] = useState<TransactionScope>('personal');
  const [categoryId, setCategoryId] = useState('');
  const [nextDueDate, setNextDueDate] = useState(toISODate());
  const [ownerUid, setOwnerUid] = useState(currentUid);
  const [isTaxDeductible, setIsTaxDeductible] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingRec, setSavingRec] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [confirmDeleteRecId, setConfirmDeleteRecId] = useState<string | null>(null);

  useEffect(() => {
    setBalanceInput((household.bankBalance ?? 0) > 0 ? String(household.bankBalance) : '');
  }, [household.bankBalance]);

  const todayStr = toISODate();
  const { monthEnd, next30End } = useMemo(() => {
    const [yStr, mStr, dStr] = todayStr.split('-');
    const y = Number(yStr);
    const m0 = Number(mStr) - 1;
    const d = Number(dStr);
    return {
      monthEnd: getMonthBounds(y, m0).end,
      next30End: toISODate(new Date(y, m0, d + 30)),
    };
  }, [todayStr]);

  const overdueOccurrences = useMemo(
    () => getOverdueRecurring(recurring, todayStr),
    [recurring, todayStr]
  );

  const remainingMonthOccurrences = useMemo(
    () => projectRecurringInRange(recurring, todayStr, monthEnd, todayStr),
    [recurring, todayStr, monthEnd]
  );

  const next30Occurrences = useMemo(
    () => projectRecurringInRange(recurring, todayStr, next30End, todayStr),
    [recurring, todayStr, next30End]
  );

  const upcoming7DaysTotal = useMemo(
    () =>
      next30Occurrences
        .filter((o) => o.daysUntilDue <= 7)
        .reduce((s, o) => s + o.amount, 0),
    [next30Occurrences]
  );

  const remainingMonthTotal = useMemo(
    () => remainingMonthOccurrences.reduce((s, o) => s + o.amount, 0),
    [remainingMonthOccurrences]
  );

  const annualObligationTotal = useMemo(() => {
    return recurring
      .filter((r) => r.isActive && r.type === 'expense')
      .reduce((sum, r) => {
        const mult =
          r.frequency === 'weekly'
            ? 52
            : r.frequency === 'monthly'
              ? 12
              : r.frequency === 'quarterly'
                ? 4
                : r.frequency === 'half_yearly'
                  ? 2
                  : 1;
        return sum + r.amount * mult;
      }, 0);
  }, [recurring]);

  const afterMonthBalance = (household.bankBalance ?? 0) - remainingMonthTotal;

  const handleSaveBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBalance(true);
    try {
      await updateHouseholdSettings(household.id, {
        bankBalance: Number(balanceInput) || 0,
      });
      onSuccessToast(Number(balanceInput) > 0 ? 'Bank balance check updated' : 'Bank balance cleared');
    } catch {
      onSuccessToast('Unable to update balance right now');
    } finally {
      setSavingBalance(false);
    }
  };

  const openCreateModal = () => {
    setEditingRec(null);
    const defaultCat =
      categories.find((c) => c.kind === 'recurring') || categories[0];
    setTitle('');
    setAmount('');
    setFrequency('monthly');
    setType('expense');
    setScope('personal');
    setCategoryId(defaultCat?.id || '');
    setNextDueDate(toISODate());
    setOwnerUid(currentUid);
    setIsTaxDeductible(Boolean(defaultCat?.isTaxDeductibleDefault));
    setNotes('');
    setShowModal(true);
  };

  const openEditModal = (rec: RecurringObligation) => {
    setEditingRec(rec);
    setTitle(rec.title);
    setAmount(String(rec.amount));
    setFrequency(rec.frequency);
    setType(rec.type);
    setScope(rec.scope);
    setCategoryId(rec.categoryId);
    setNextDueDate(rec.nextDueDate);
    setOwnerUid(rec.ownerUid);
    setIsTaxDeductible(rec.isTaxDeductible);
    setNotes(rec.notes);
    setShowModal(true);
  };

  const handleSaveRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) return;

    const cat = categories.find((c) => c.id === categoryId) || categories[0];
    const owner = members.find((m) => m.uid === ownerUid);
    const ownerName = owner?.displayName || currentName;

    setSavingRec(true);
    try {
      if (editingRec) {
        await updateRecurringObligation(household.id, editingRec.id, {
          title: title.trim(),
          amount: num,
          frequency,
          type,
          scope,
          categoryId: cat.id,
          categoryName: cat.name,
          nextDueDate,
          ownerUid,
          ownerName,
          isTaxDeductible,
          notes: notes.trim(),
        });
        onSuccessToast('Recurring rule updated');
      } else {
        await createRecurringObligation(household.id, currentUid, {
          title: title.trim(),
          amount: num,
          frequency,
          type,
          scope,
          categoryId: cat.id,
          categoryName: cat.name,
          nextDueDate,
          ownerUid,
          ownerName,
          isTaxDeductible,
          notes: notes.trim(),
        });
        onSuccessToast('Recurring obligation scheduled');
      }
      setShowModal(false);
    } catch {
      onSuccessToast('Unable to save recurring rule');
    } finally {
      setSavingRec(false);
    }
  };

  const handleMarkPaid = async (occRecurringId: string) => {
    const rec = recurring.find((r) => r.id === occRecurringId);
    if (!rec) return;
    setPayingId(rec.id);
    try {
      await markRecurringPaid(
        household.id,
        currentUid,
        currentName,
        household.currency,
        rec,
        todayStr
      );
      onSuccessToast(`Logged ${rec.title} & advanced next due date`);
    } catch {
      onSuccessToast('Unable to mark paid right now');
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Recurring Obligations &amp; Upcoming Schedule
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track monthly EMIs, half-yearly LIC &amp; health insurance, and yearly software or tax bills.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Recurring Rule
        </button>
      </div>

      {/* Overdue Unpaid Obligations */}
      {overdueOccurrences.length > 0 && (
        <section className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <h3 className="text-sm font-bold">
              Overdue Unpaid Obligations ({overdueOccurrences.length})
            </h3>
          </div>
          <div className="divide-y divide-rose-200/70 dark:divide-rose-900/50">
            {overdueOccurrences.map((occ) => (
              <div
                key={`overdue-${occ.recurringId}`}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-rose-950 dark:text-rose-100 truncate">
                    {occ.title}
                  </p>
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Due {formatShortDate(occ.dueDate)} ({Math.abs(occ.daysUntilDue)}d overdue) ·{' '}
                    {frequencyLabel(occ.frequency)} · {occ.ownerName}
                  </p>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="text-sm font-mono font-bold tabular-nums text-rose-950 dark:text-rose-100">
                    {formatMoney(occ.amount, household.currency)}
                  </span>
                  <button
                    onClick={() => handleMarkPaid(occ.recurringId)}
                    disabled={payingId === occ.recurringId}
                    className="min-h-[38px] px-3.5 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {payingId === occ.recurringId ? '...' : 'Mark Paid'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Deductions Projection Strip + Optional Bank Balance Check */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Due Next 7 Days</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 truncate">
              {formatMoney(upcoming7DaysTotal, household.currency)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {next30Occurrences.filter((o) => o.daysUntilDue <= 7).length} upcoming deductions
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Rest of This Month</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
              {formatMoney(remainingMonthTotal, household.currency)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {remainingMonthOccurrences.length} scheduled obligations
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Annualized Run-Rate</p>
            <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
              {formatMoney(annualObligationTotal, household.currency)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Total active recurring / year
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowBalanceCheck((v) => !v)}
            className="inline-flex items-center gap-2 text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline text-left"
          >
            {showBalanceCheck ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
            {hasSavedBalance
              ? `Optional Bank Balance Check (${formatMoney(household.bankBalance, household.currency)})`
              : 'Optional: Check if your current bank balance covers this month'}
          </button>

          {showBalanceCheck && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <form onSubmit={handleSaveBalance} className="flex gap-2 w-full sm:max-w-sm">
                <input
                  type="number"
                  step="any"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  placeholder="Optional current balance (e.g. 85000)"
                  className="flex-1 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={savingBalance}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  {savingBalance ? 'Saving...' : 'Check'}
                </button>
              </form>

              {hasSavedBalance && (
                <div className="flex items-center gap-2 text-xs">
                  {afterMonthBalance >= 0 ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="text-slate-600 dark:text-slate-300">
                        Covered with{' '}
                        <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                          {formatMoney(afterMonthBalance, household.currency)}
                        </strong>{' '}
                        leftover after deductions.
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="text-amber-800 dark:text-amber-300">
                        Needs{' '}
                        <strong className="font-mono">
                          {formatMoney(Math.abs(afterMonthBalance), household.currency)}
                        </strong>{' '}
                        top-up before month end.
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Date-Wise Upcoming 30-Day Deductions */}
        <section className="lg:col-span-6 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Date-Wise Upcoming Deductions (Next 30 Days)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chronological schedule so you know exact dates before funds are debited.
            </p>
          </div>

          {next30Occurrences.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No recurring obligations due in the next 30 days. Add EMIs, LIC, or annual plans to track them.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {next30Occurrences.map((occ) => (
                <div
                  key={`${occ.recurringId}-${occ.dueDate}`}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {occ.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {formatShortDate(occ.dueDate)} ·{' '}
                      {occ.daysUntilDue === 0
                        ? 'Due today'
                        : `In ${occ.daysUntilDue} day${occ.daysUntilDue === 1 ? '' : 's'}`}{' '}
                      · {frequencyLabel(occ.frequency)} · {occ.ownerName}
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="text-sm font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatMoney(occ.amount, household.currency)}
                    </span>
                    <button
                      onClick={() => handleMarkPaid(occ.recurringId)}
                      disabled={payingId === occ.recurringId}
                      className="min-h-[36px] px-3 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {payingId === occ.recurringId ? '...' : 'Mark Paid'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* All Recurring Rules (Monthly, Half-Yearly, Yearly) */}
        <section className="lg:col-span-6 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              All Scheduled Rules ({recurring.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monthly EMIs, half-yearly insurance, yearly software &amp; tax obligations.
            </p>
          </div>

          {recurring.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No recurring rules added yet.
              </p>
              <button
                onClick={openCreateModal}
                className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700"
              >
                Schedule First EMI / Insurance
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recurring.map((rec) => (
                <div
                  key={rec.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3"
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        rec.isActive
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-400 dark:text-slate-500 line-through'
                      }`}
                    >
                      {rec.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {frequencyLabel(rec.frequency)} · Next: {formatShortDate(rec.nextDueDate)} ·{' '}
                      {rec.categoryName} · {rec.scope === 'shared' ? 'Shared' : 'Individual'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0">
                    <span className="text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-white mr-2">
                      {formatMoney(rec.amount, household.currency)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={async () => {
                          try {
                            await updateRecurringObligation(household.id, rec.id, {
                              isActive: !rec.isActive,
                            });
                          } catch {
                            onSuccessToast('Unable to update rule right now');
                          }
                        }}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        aria-label={rec.isActive ? 'Pause rule' : 'Resume rule'}
                      >
                        {rec.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => openEditModal(rec)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        aria-label="Edit recurring rule"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteRecId === rec.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => {
                              try {
                                await deleteRecurringObligation(household.id, rec.id);
                                setConfirmDeleteRecId(null);
                                onSuccessToast('Recurring rule deleted');
                              } catch {
                                onSuccessToast('Unable to delete rule right now');
                              }
                            }}
                            className="min-h-[38px] px-2.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteRecId(null)}
                            className="min-h-[38px] px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteRecId(rec.id)}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          aria-label="Delete recurring rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Add/Edit Recurring Modal */}
      <AnimatePresence>
        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 overflow-hidden"
            onTouchMove={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {editingRec ? 'Edit Recurring Rule' : 'Schedule Recurring Obligation'}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveRecurring} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Obligation Title
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Home Loan EMI, LIC Policy, Adobe Pro"
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Amount ({getCurrencySymbol(household.currency as CurrencyCode)})
                    </label>
                    <input
                      type="number"
                      required
                      step="any"
                      min="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 24500"
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Frequency
                    </label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly (EMI / SIP)</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="half_yearly">Half-Yearly (LIC / Health Ins.)</option>
                      <option value="yearly">Yearly (Software / Tax)</option>
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Next Due Date
                    </label>
                    <input
                      type="date"
                      required
                      value={nextDueDate}
                      onChange={(e) => setNextDueDate(e.target.value)}
                      className="w-full min-w-0 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Category
                    </label>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Type
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as 'expense' | 'savings' | 'fd')}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      <option value="expense">Expense / Bill / EMI</option>
                      <option value="savings">Recurring Savings / SIP</option>
                      <option value="fd">Recurring FD</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Owner
                    </label>
                    <select
                      value={ownerUid}
                      onChange={(e) => setOwnerUid(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      {members.length > 0 ? (
                        members.map((m) => (
                          <option key={m.uid} value={m.uid}>
                            {m.displayName}
                          </option>
                        ))
                      ) : (
                        <option value={currentUid}>{currentName}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Scope
                    </label>
                    <select
                      value={scope}
                      onChange={(e) => setScope(e.target.value as TransactionScope)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
                    >
                      <option value="personal">Individual</option>
                      <option value="shared">Shared Household</option>
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isTaxDeductible}
                    onChange={(e) => setIsTaxDeductible(e.target.checked)}
                    className="w-4 h-4 rounded accent-teal-600"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Include in Tax-Deductible Report
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={savingRec}
                  className="w-full min-h-[46px] rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {savingRec ? 'Saving...' : editingRec ? 'Update Rule' : 'Save Schedule'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
