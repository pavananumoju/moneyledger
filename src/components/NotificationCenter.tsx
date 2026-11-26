import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ReceiptText,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { CurrencyCode, HouseholdNotification } from '../types';
import { formatMoney, formatRelativeTime } from '../utils/finance';

export interface ActiveToastPayload {
  id: string;
  variant: 'partner' | 'nudge' | 'success';
  title: string;
  subtitle?: string;
  amount?: number;
  categoryId?: string;
  fromName?: string;
}

interface LiveNotificationBannerProps {
  banner: ActiveToastPayload | null;
  currency: CurrencyCode;
  onDismiss: () => void;
  onViewBook: (categoryId?: string) => void;
  onLogShare: (categoryId?: string, amount?: number) => void;
}

export const LiveNotificationBanner: React.FC<LiveNotificationBannerProps> = ({
  banner,
  currency,
  onDismiss,
  onViewBook,
  onLogShare,
}) => {
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          key={banner.id}
          initial={{ opacity: 0, y: -28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed top-3 left-3 right-3 sm:left-auto sm:right-5 sm:top-4 sm:w-[390px] z-50 pointer-events-auto no-print"
        >
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl p-3.5 sm:p-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  banner.variant === 'nudge'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300'
                    : banner.variant === 'partner'
                      ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/80 dark:text-teal-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
                }`}
              >
                {banner.variant === 'nudge' ? (
                  <BellRing className="w-4 h-4" />
                ) : banner.variant === 'partner' ? (
                  <ReceiptText className="w-4 h-4" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                    {banner.title}
                  </p>
                  <button
                    onClick={onDismiss}
                    className="p-1 -mr-1 -mt-0.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {banner.subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                    {banner.subtitle}
                  </p>
                )}

                {(banner.variant === 'nudge' || banner.variant === 'partner') && (
                  <div className="mt-2.5 flex items-center gap-2">
                    {banner.variant === 'nudge' && (
                      <button
                        onClick={() => {
                          onLogShare(banner.categoryId, banner.amount);
                          onDismiss();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition-colors whitespace-nowrap"
                      >
                        Log Share
                        {banner.amount && banner.amount > 0
                          ? ` (${formatMoney(banner.amount, currency)})`
                          : ''}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onViewBook(banner.categoryId);
                        onDismiss();
                      }}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      {banner.categoryId ? 'View Book' : 'Open Ledger'}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface NotificationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: HouseholdNotification[];
  currentUid: string;
  currency: CurrencyCode;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSelectNotification: (n: HouseholdNotification) => void;
}

export const NotificationSheet: React.FC<NotificationSheetProps> = ({
  isOpen,
  onClose,
  notifications,
  currentUid,
  currency,
  onMarkAllRead,
  onClearAll,
  onSelectNotification,
}) => {
  const unreadCount = notifications.filter(
    (n) => !n.readByUids.includes(currentUid)
  ).length;

  const renderIcon = (kind: HouseholdNotification['kind']) => {
    switch (kind) {
      case 'nudge':
        return (
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <BellRing className="w-4 h-4" />
          </div>
        );
      case 'member_joined':
        return (
          <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
            <ReceiptText className="w-4 h-4" />
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-start md:justify-end bg-black/40 md:bg-black/20 backdrop-blur-[2px] md:p-4 md:pt-16 overflow-hidden"
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 36 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="relative w-full md:w-[400px] max-h-[82vh] flex flex-col rounded-t-3xl md:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden overscroll-contain"
          >
            <div className="md:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Partner Activity &amp; Alerts
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={onMarkAllRead}
                    className="px-2 py-1.5 rounded-lg text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 inline-flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={onClearAll}
                    className="px-2 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1"
                    title="Clear all notifications"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close notifications"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800 px-3 py-1">
              {notifications.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-2">
                  <Bell className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    All caught up
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Real-time partner entries and contribution nudges will appear here.
                  </p>
                </div>
              ) : (
                notifications.map((n) => {
                  const isUnread = !n.readByUids.includes(currentUid);
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        onSelectNotification(n);
                        onClose();
                      }}
                      className={`w-full text-left px-3 py-3.5 rounded-xl my-0.5 flex items-start gap-3 transition-colors ${
                        isUnread
                          ? 'bg-teal-50/60 dark:bg-teal-950/25 hover:bg-teal-50 dark:hover:bg-teal-950/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {renderIcon(n.kind)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {n.title}
                          </p>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                            {formatRelativeTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                          {n.message}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {typeof n.targetAmount === 'number' && n.targetAmount > 0 && (
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {formatMoney(n.targetAmount, currency)}
                            </span>
                          )}
                          {isUnread && (
                            <span className="text-teal-700 dark:text-teal-400 font-medium">
                              · Unread
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
