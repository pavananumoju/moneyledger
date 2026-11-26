import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lock, Pencil, Plus, X } from 'lucide-react';
import {
  createCategory,
  createTransaction,
  updateTransaction,
} from '../services/householdService';
import type {
  Category,
  CurrencyCode,
  HouseholdMember,
  Transaction,
  TransactionScope,
  TransactionType,
} from '../types';
import {
  formatFullDate,
  formatMoney,
  getCurrencySymbol,
  toISODate,
  triggerHaptic,
} from '../utils/finance';
import { CATEGORY_COLOR_OPTIONS, CategoryIcon } from './CategoryIcon';

export interface TransactionPrefill {
  title?: string;
  amount?: number;
  categoryId?: string;
  paidByUid?: string;
  type?: TransactionType;
  scope?: TransactionScope;
  notes?: string;
  isTaxDeductible?: boolean;
}

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  householdId: string;
  currentUid: string;
  currentName: string;
  currency: CurrencyCode;
  members: HouseholdMember[];
  categories: Category[];
  editingTx?: Transaction | null;
  prefill?: TransactionPrefill | null;
  defaultDate?: string;
  defaultCategoryId?: string;
  onSuccessToast: (msg: string) => void;
}

const QUICK_TEMPLATES = [
  { label: 'Fixed Deposit (FD)', title: 'Fixed Deposit Transfer', catMatch: 'fd', type: 'fd' as TransactionType, tax: false },
  { label: 'Mutual Fund (MF)', title: 'Mutual Fund SIP', catMatch: 'mutual', type: 'savings' as TransactionType, tax: true },
  { label: 'Family Event', title: 'Family Event Expense', catMatch: 'event', type: 'expense' as TransactionType, tax: false },
  { label: 'Groceries', title: 'Household Groceries', catMatch: 'daily', type: 'expense' as TransactionType, tax: false },
];

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  householdId,
  currentUid,
  currentName,
  currency,
  members,
  categories,
  editingTx,
  prefill,
  defaultDate,
  defaultCategoryId,
  onSuccessToast,
}) => {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [scope, setScope] = useState<TransactionScope>('shared');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(toISODate());
  const [paidByUid, setPaidByUid] = useState(currentUid);
  const [notes, setNotes] = useState('');
  const [isTaxDeductible, setIsTaxDeductible] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLOR_OPTIONS[0]);
  const [creatingCat, setCreatingCat] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setShowNewCat(false);

    if (editingTx) {
      setIsLocked(true);
      setTitle(editingTx.title);
      setAmount(String(editingTx.amount));
      setType(editingTx.type);
      setScope(editingTx.scope);
      setCategoryId(editingTx.categoryId);
      setDate(editingTx.date);
      setPaidByUid(editingTx.paidByUid);
      setNotes(editingTx.notes);
      setIsTaxDeductible(editingTx.isTaxDeductible);
    } else {
      setIsLocked(false);
      const initialCat =
        categories.find((c) => c.id === (prefill?.categoryId || defaultCategoryId)) ||
        categories[0];
      setTitle(prefill?.title || '');
      setAmount(prefill?.amount && prefill.amount > 0 ? String(prefill.amount) : '');
      setType(
        prefill?.type ||
          (initialCat?.kind === 'fd'
            ? 'fd'
            : initialCat?.kind === 'savings'
              ? 'savings'
              : initialCat?.kind === 'income'
                ? 'income'
                : 'expense')
      );
      setScope(prefill?.scope || 'shared');
      setCategoryId(initialCat?.id || '');
      setDate(defaultDate || toISODate());
      setPaidByUid(prefill?.paidByUid || currentUid);
      setNotes(prefill?.notes || '');
      setIsTaxDeductible(
        typeof prefill?.isTaxDeductible === 'boolean'
          ? prefill.isTaxDeductible
          : Boolean(initialCat?.isTaxDeductibleDefault)
      );
    }
  }, [isOpen, editingTx, prefill, categories, defaultCategoryId, defaultDate, currentUid]);

  const applyTemplate = (tpl: (typeof QUICK_TEMPLATES)[number]) => {
    triggerHaptic(8);
    setTitle(tpl.title);
    setType(tpl.type);
    setIsTaxDeductible(tpl.tax);
    const matched = categories.find((c) =>
      c.name.toLowerCase().includes(tpl.catMatch)
    );
    if (matched) setCategoryId(matched.id);
  };

  const handleScopeChange = (nextScope: TransactionScope) => {
    setScope(nextScope);
    if (nextScope === 'personal') {
      const currentCat = categories.find((c) => c.id === categoryId);
      if (currentCat?.kind === 'event') {
        const fallback = categories.find((c) => c.kind !== 'event') || categories[0];
        if (fallback) setCategoryId(fallback.id);
      }
    }
  };

  const handleCategoryChange = (id: string) => {
    setCategoryId(id);
    const cat = categories.find((c) => c.id === id);
    if (cat && !editingTx) {
      setIsTaxDeductible(cat.isTaxDeductibleDefault);
      if (cat.kind === 'fd') setType('fd');
      else if (cat.kind === 'savings') setType('savings');
      else if (cat.kind === 'income') setType('income');
      else setType('expense');
    }
  };

  const handleQuickCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const id = await createCategory(householdId, currentUid, {
        name: newCatName.trim(),
        kind: type === 'fd' ? 'fd' : type === 'savings' ? 'savings' : 'event',
        color: newCatColor,
        icon: 'tag',
        budgetLimit: 0,
        splitRatio: 50,
        isTaxDeductibleDefault: isTaxDeductible,
      });
      setCategoryId(id);
      setNewCatName('');
      setShowNewCat(false);
      onSuccessToast('Custom book added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create category.');
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter an amount greater than 0.');
      return;
    }

    const cat = categories.find((c) => c.id === categoryId) || categories[0];
    if (!cat) {
      setError('Please select or create a category first.');
      return;
    }

    const payer = members.find((m) => m.uid === paidByUid);
    const paidByName = payer?.displayName || currentName;

    setSaving(true);
    try {
      if (editingTx) {
        await updateTransaction(householdId, editingTx.id, {
          title: title.trim(),
          amount: parsedAmount,
          type,
          scope,
          categoryId: cat.id,
          categoryName: cat.name,
          date,
          paidByUid,
          paidByName,
          notes: notes.trim(),
          isTaxDeductible,
        });
        onSuccessToast('Transaction updated');
      } else {
        await createTransaction(householdId, currentUid, currentName, currency, {
          title: title.trim(),
          amount: parsedAmount,
          type,
          scope,
          categoryId: cat.id,
          categoryName: cat.name,
          date,
          paidByUid,
          paidByName,
          notes: notes.trim(),
          isTaxDeductible,
        });
        onSuccessToast(`Saved & synced to ${cat.name}`);
      }
      triggerHaptic(14);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save transaction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 overflow-hidden"
          onTouchMove={(e) => e.stopPropagation()}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden overscroll-contain"
          >
            <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
                  {editingTx
                    ? isLocked
                      ? 'Transaction Details'
                      : 'Edit Transaction'
                    : 'Log Transaction'}
                </h2>
                {editingTx && isLocked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                    <Lock className="w-3 h-3" />
                    Locked
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editingTx && isLocked ? (
              <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-5">
                {(() => {
                  const cat = categories.find((c) => c.id === editingTx.categoryId);
                  const typeLabel =
                    editingTx.type === 'fd'
                      ? 'Fixed Deposit (FD)'
                      : editingTx.type === 'savings'
                        ? 'Savings / MF'
                        : editingTx.type === 'income'
                          ? 'Income'
                          : 'Expense';
                  return (
                    <>
                      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0"
                            style={{ backgroundColor: cat?.color || '#0D9488' }}
                          >
                            <CategoryIcon icon={cat?.icon || 'tag'} className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-base font-bold text-slate-900 dark:text-white truncate">
                              {editingTx.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {editingTx.categoryName} · {typeLabel}
                            </p>
                          </div>
                        </div>
                        <p
                          className={`text-xl font-bold font-mono shrink-0 ${
                            editingTx.type === 'income'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : editingTx.type === 'savings' || editingTx.type === 'fd'
                                ? 'text-teal-600 dark:text-teal-400'
                                : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {editingTx.type === 'income' ? '+' : ''}
                          {formatMoney(editingTx.amount, currency)}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Date</p>
                          <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                            {formatFullDate(editingTx.date)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Paid By</p>
                          <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                            {editingTx.paidByName}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Scope</p>
                          <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                            {editingTx.scope === 'shared' ? 'Shared Household' : 'Individual'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Tax Deductible</p>
                          <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                            {editingTx.isTaxDeductible ? 'Yes (Included in Tax CSV)' : 'No'}
                          </p>
                        </div>
                      </div>

                      {(editingTx.notes || editingTx.receiptSummary) && (
                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                          {editingTx.notes && (
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">Notes</p>
                              <p className="mt-1 text-slate-800 dark:text-slate-200 leading-relaxed">
                                {editingTx.notes}
                              </p>
                            </div>
                          )}
                          {editingTx.receiptSummary && (
                            <div>
                              <p className="text-slate-500 dark:text-slate-400">Receipt Summary</p>
                              <p className="mt-1 text-slate-700 dark:text-slate-300 leading-relaxed">
                                {editingTx.receiptSummary}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                        Locked to prevent accidental edits from swipes or taps.
                      </p>

                      <div className="pt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={onClose}
                          className="flex-1 min-h-[46px] rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            triggerHaptic(8);
                            setIsLocked(false);
                          }}
                          className="flex-1 min-h-[46px] rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {!editingTx && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Quick Fill
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.label}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-300 transition-colors whitespace-nowrap"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}

              {/* Type selector */}
              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                {(
                  [
                    { id: 'expense', label: 'Expense' },
                    { id: 'savings', label: 'Savings' },
                    { id: 'fd', label: 'FD' },
                    { id: 'income', label: 'Income' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setType(opt.id)}
                    className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors ${
                      type === opt.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    What was this for?
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Fixed Deposit (FD), Mutual Fund SIP, Groceries"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Amount ({getCurrencySymbol(currency)})
                  </label>
                  <input
                    type="number"
                    required
                    step="any"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 3500"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Category / Event Book
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowNewCat((v) => !v)}
                    className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    New Custom Book
                  </button>
                </div>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {categories
                    .filter((cat) => scope === 'shared' || cat.kind !== 'event')
                    .map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                </select>

                {showNewCat && (
                  <div className="mt-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2.5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={50}
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="e.g. Family Trip, Home Renovation, Festival"
                        className="flex-1 min-w-0 min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={creatingCat || !newCatName.trim()}
                        onClick={handleQuickCreateCategory}
                        className="px-3 min-h-[40px] rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50 shrink-0"
                      >
                        {creatingCat ? '...' : 'Add'}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {CATEGORY_COLOR_OPTIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewCatColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            newCatColor === c ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white scale-110' : ''
                          }`}
                          aria-label={`Color ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full min-w-0 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Paid By
                  </label>
                  <select
                    value={paidByUid}
                    onChange={(e) => setPaidByUid(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => handleScopeChange('shared')}
                    className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors ${
                      scope === 'shared'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Shared
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange('personal')}
                    className={`min-h-[38px] rounded-lg text-xs font-medium transition-colors ${
                      scope === 'personal'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Individual
                  </button>
                </div>

                <label className="min-h-[44px] flex items-center gap-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isTaxDeductible}
                    onChange={(e) => setIsTaxDeductible(e.target.checked)}
                    className="w-4 h-4 rounded accent-teal-600"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Tax Deductible
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={400}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Receipt #402, folio number, or shared split note"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 min-h-[46px] rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[46px] rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.99] transition-all disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingTx ? 'Update Entry' : 'Save & Sync'}
                </button>
              </div>
            </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
