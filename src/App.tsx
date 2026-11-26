import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  Bell,
  BookOpen,
  CalendarClock,
  LayoutDashboard,
  ListFilter,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  clearAllNotifications,
  ensureUserProfile,
  joinHouseholdByCode,
  markNotificationsRead,
  markRecurringPaid,
  sendPartnerTestPush,
  setHouseholdPushSubscriptionsCache,
  updateUserPreferences,
} from './services/householdService';
import type {
  Category,
  Household,
  HouseholdMember,
  HouseholdNotification,
  HouseholdPushSubscription,
  NavTab,
  RecurringObligation,
  Transaction,
  UserProfile,
} from './types';
import {
  formatMoney,
  formatShortDate,
  getMonthBounds,
  getMonthPaceComparison,
  getOverdueRecurring,
  projectRecurringInRange,
  toISODate,
  triggerHaptic,
} from './utils/finance';
import {
  capturePendingInviteFromUrl,
  clearPendingInvite,
} from './utils/inviteQr';
import { AuthGate } from './components/AuthGate';
import { CalendarTimelineView } from './components/CalendarTimelineView';
import { CategoryIcon } from './components/CategoryIcon';
import { EventBooksView } from './components/EventBooksView';
import { CategoryAllocationChart } from './components/InteractiveCharts';
import { LedgerHistoryView } from './components/LedgerHistoryView';
import {
  LiveNotificationBanner,
  NotificationSheet,
  type ActiveToastPayload,
} from './components/NotificationCenter';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RecurringCashflowView } from './components/RecurringCashflowView';
import { SettingsView } from './components/SettingsView';
import {
  TransactionModal,
  type TransactionPrefill,
} from './components/TransactionModal';
import { usePushNotifications } from './hooks/usePushNotifications';

const TAB_ORDER: NavTab[] = ['overview', 'events', 'recurring', 'ledger', 'settings'];

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [householdId, setHouseholdId] = useState<string>('');

  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<RecurringObligation[]>([]);
  const [notifications, setNotifications] = useState<HouseholdNotification[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<HouseholdPushSubscription[]>([]);
  const [pushRulesMissing, setPushRulesMissing] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [tabDirection, setTabDirection] = useState<number>(1);
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [txPrefill, setTxPrefill] = useState<TransactionPrefill | null>(null);
  const [defaultTxDate, setDefaultTxDate] = useState<string | undefined>(undefined);
  const [defaultTxCatId, setDefaultTxCatId] = useState<string | undefined>(undefined);

  const [notifOpen, setNotifOpen] = useState(false);
  const [liveBanner, setLiveBanner] = useState<ActiveToastPayload | null>(null);
  const [quickPayingId, setQuickPayingId] = useState<string | null>(null);
  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() =>
    capturePendingInviteFromUrl()
  );
  const [joiningPendingInvite, setJoiningPendingInvite] = useState(false);
  const [pendingInviteError, setPendingInviteError] = useState<string | null>(null);

  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const initialNotifLoadedRef = useRef(false);
  const bannerTimerRef = useRef<number | null>(null);

  const {
    pushSupported,
    permission: pushPermission,
    isPushSubscribed,
    isEphemeralVapid,
    firestoreSyncOk,
    pushEndpoint,
    isIOS,
    isStandalone,
    subscribeToWebPush,
    reRegisterWebPush,
    sendTestPush,
    requestPermission: requestPushPermission,
    showNotification,
    syncAppBadge,
  } = usePushNotifications();

  const [activatingPush, setActivatingPush] = useState(false);

  // Automatically sync Web Push subscription with Firestore & server so device receives lock-screen alerts
  useEffect(() => {
    if (!user || !householdId || pushPermission !== 'granted') return;
    subscribeToWebPush(householdId, user.uid).catch(() => {});
  }, [user, householdId, pushPermission, subscribeToWebPush]);

  const handleActivatePush = async () => {
    if (!household || !user) return;
    setActivatingPush(true);
    try {
      const res = await subscribeToWebPush(household.id, user.uid);
      if (res.ok) {
        showToast('Lock-screen alerts enabled! Sending test notification...');
        await sendTestPush(0);
      } else if (res.reason === 'ios_install_required') {
        showToast('On iPhone, tap Safari Share → Add to Home Screen first');
      } else if (res.reason === 'permission_denied') {
        showToast('Notification permission blocked in phone settings');
      } else {
        showToast('Unable to activate push alerts on this device');
      }
    } finally {
      setActivatingPush(false);
    }
  };

  const presentBanner = useCallback((payload: Omit<ActiveToastPayload, 'id'>, durationMs = 4500) => {
    const id = `banner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (bannerTimerRef.current) {
      window.clearTimeout(bannerTimerRef.current);
    }
    setLiveBanner({ id, ...payload });
    bannerTimerRef.current = window.setTimeout(() => {
      setLiveBanner((curr) => (curr?.id === id ? null : curr));
    }, durationMs);
  }, []);

  const showToast = useCallback(
    (msg: string) => {
      presentBanner({ variant: 'success', title: msg }, 3200);
    },
    [presentBanner]
  );

  const switchTab = useCallback(
    (next: NavTab) => {
      if (next === activeTab) return;
      triggerHaptic(8);
      const prevIdx = TAB_ORDER.indexOf(activeTab);
      const nextIdx = TAB_ORDER.indexOf(next);
      setTabDirection(nextIdx >= prevIdx ? 1 : -1);
      setActiveTab(next);
    },
    [activeTab]
  );

  // Handle Service Worker notification click deep-links & background subscription rotation
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; data?: { categoryId?: string } } | null;
      if (!msg?.type) return;
      if (msg.type === 'MONEYLEDGER_NOTIFICATION_CLICK') {
        if (msg.data?.categoryId) {
          setFocusedEventId(msg.data.categoryId);
          switchTab('events');
        }
      } else if (msg.type === 'MONEYLEDGER_PUSH_SUBSCRIPTION_ROTATED' && user && householdId) {
        subscribeToWebPush(householdId, user.uid).catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSwMessage);
  }, [switchTab, user, householdId, subscribeToWebPush]);

  const toggleDarkMode = () => {
    triggerHaptic(8);
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('moneyledger_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('moneyledger_theme', 'light');
      }
      return next;
    });
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const profile = await ensureUserProfile(u);
          setUserProfile(profile);
          setHouseholdId(profile.activeHouseholdId || '');
        } catch (err) {
          console.error('Failed loading user profile:', err);
        }
      } else {
        setUserProfile(null);
        setHouseholdId('');
        setHousehold(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !householdId) return;

    seenNotifIdsRef.current = new Set();
    initialNotifLoadedRef.current = false;

    let disconnectedHandled = false;
    const handleListenerError = (err: unknown, op: OperationType, path: string) => {
      const code = (err as { code?: string })?.code;
      if (code === 'permission-denied') {
        if (!disconnectedHandled) {
          disconnectedHandled = true;
          setHouseholdId('');
          setHousehold(null);
          setUserProfile((prev) => (prev ? { ...prev, activeHouseholdId: '' } : prev));
          updateUserPreferences(user.uid, { activeHouseholdId: '' }).catch(() => {});
          showToast('Disconnected from shared ledger');
        }
        return;
      }
      handleFirestoreError(err, op, path);
    };

    const unsubHH = onSnapshot(
      doc(db, 'households', householdId),
      (snap) => {
        if (snap.exists()) {
          setHousehold({ id: snap.id, ...(snap.data() as Omit<Household, 'id'>) });
        }
      },
      (err) => handleListenerError(err, OperationType.GET, `households/${householdId}`)
    );

    const unsubMembers = onSnapshot(
      collection(db, 'households', householdId, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as HouseholdMember));
      },
      (err) =>
        handleListenerError(err, OperationType.LIST, `households/${householdId}/members`)
    );

    const unsubCategories = onSnapshot(
      collection(db, 'households', householdId, 'categories'),
      (snap) => {
        setCategories(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Category, 'id'>),
          }))
        );
      },
      (err) =>
        handleListenerError(err, OperationType.LIST, `households/${householdId}/categories`)
    );

    const unsubTx = onSnapshot(
      query(
        collection(db, 'households', householdId, 'transactions'),
        orderBy('date', 'desc')
      ),
      (snap) => {
        setTransactions(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Transaction, 'id'>),
          }))
        );
      },
      (err) =>
        handleListenerError(err, OperationType.LIST, `households/${householdId}/transactions`)
    );

    const unsubRec = onSnapshot(
      collection(db, 'households', householdId, 'recurring'),
      (snap) => {
        setRecurring(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<RecurringObligation, 'id'>),
          }))
        );
      },
      (err) =>
        handleListenerError(err, OperationType.LIST, `households/${householdId}/recurring`)
    );

    const unsubNotifs = onSnapshot(
      query(
        collection(db, 'households', householdId, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(30)
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<HouseholdNotification, 'id'>),
        }));
        setNotifications(list);

        if (!initialNotifLoadedRef.current) {
          list.forEach((n) => seenNotifIdsRef.current.add(n.id));
          initialNotifLoadedRef.current = true;
          return;
        }

        for (const n of list) {
          if (!seenNotifIdsRef.current.has(n.id)) {
            seenNotifIdsRef.current.add(n.id);
            if (n.fromUid !== user.uid) {
              triggerHaptic(15);
              presentBanner(
                {
                  variant: n.kind === 'nudge' ? 'nudge' : 'partner',
                  title: n.title,
                  subtitle: n.message,
                  amount: n.targetAmount,
                  categoryId: n.targetCategoryId,
                  fromName: n.fromName,
                },
                6200
              );
              if (
                userProfile?.notificationsEnabled !== false &&
                typeof document !== 'undefined' &&
                document.visibilityState !== 'visible'
              ) {
                showNotification(n.title, n.message, {
                  tag: n.id,
                  data: { categoryId: n.targetCategoryId, kind: n.kind },
                });
              }
            }
          }
        }
      },
      (err) =>
        handleListenerError(err, OperationType.LIST, `households/${householdId}/notifications`)
    );

    const unsubPushSubs = onSnapshot(
      collection(db, 'households', householdId, 'pushSubscriptions'),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<HouseholdPushSubscription, 'id'>),
        }));
        setPushSubscriptions(list);
        setHouseholdPushSubscriptionsCache(list);
        setPushRulesMissing(false);
      },
      (err) => {
        const code = (err as { code?: string })?.code;
        if (code === 'permission-denied') {
          // Gracefully degrade if updated firestore.rules haven't been deployed yet
          setPushRulesMissing(true);
          setPushSubscriptions([]);
          setHouseholdPushSubscriptionsCache([]);
          return;
        }
        console.warn('[MoneyLedger Push] Failed listening to pushSubscriptions:', err);
      }
    );

    return () => {
      unsubHH();
      unsubMembers();
      unsubCategories();
      unsubTx();
      unsubRec();
      unsubNotifs();
      unsubPushSubs();
      setHouseholdPushSubscriptionsCache([]);
    };
  }, [authReady, user, householdId, showNotification, presentBanner, showToast, userProfile?.notificationsEnabled]);

  const unreadCount = useMemo(() => {
    if (!user) return 0;
    return notifications.filter((n) => !n.readByUids.includes(user.uid)).length;
  }, [notifications, user]);

  useEffect(() => {
    syncAppBadge(unreadCount);
  }, [unreadCount, syncAppBadge]);

  const todayStr = toISODate();
  const currentMonthBounds = useMemo(() => {
    const [yStr, mStr] = todayStr.split('-');
    return getMonthBounds(Number(yStr), Number(mStr) - 1);
  }, [todayStr]);
  const currentYearStr = todayStr.slice(0, 4);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const dashboardStats = useMemo(() => {
    const [yStr, mStr, dStr] = todayStr.split('-');
    const todayDate = new Date(Number(yStr), Number(mStr) - 1, Number(dStr));

    const monthTxs = transactions.filter(
      (t) => t.date >= currentMonthBounds.start && t.date <= currentMonthBounds.end
    );
    const monthSpent = monthTxs
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    const pace = getMonthPaceComparison(transactions, todayDate);

    const totalSavingsAndFds = transactions
      .filter((t) => t.type === 'savings' || t.type === 'fd')
      .reduce((s, t) => s + t.amount, 0);

    const taxDeductibleYear = transactions
      .filter((t) => t.isTaxDeductible && t.date.startsWith(currentYearStr))
      .reduce((s, t) => s + t.amount, 0);

    const sharedMonthExpenses = monthTxs.filter(
      (t) => t.scope === 'shared' && t.type === 'expense'
    );
    const sharedTotal = sharedMonthExpenses.reduce((s, t) => s + t.amount, 0);
    const partnerTotals = new Map<string, { name: string; amount: number }>();
    for (const m of members) {
      partnerTotals.set(m.uid, { name: m.displayName, amount: 0 });
    }
    for (const t of sharedMonthExpenses) {
      const prev = partnerTotals.get(t.paidByUid);
      if (prev) prev.amount += t.amount;
      else partnerTotals.set(t.paidByUid, { name: t.paidByName, amount: t.amount });
    }
    const partnerList = Array.from(partnerTotals.values()).sort((a, b) => b.amount - a.amount);
    const splitDiff =
      partnerList.length >= 2
        ? Math.round(sharedTotal / partnerList.length - partnerList[partnerList.length - 1].amount)
        : 0;

    const overdueRecurring = getOverdueRecurring(recurring, todayStr);
    const remainingMonthOccs = projectRecurringInRange(
      recurring,
      todayStr,
      currentMonthBounds.end,
      todayStr
    );
    const upcomingMonthTotal = remainingMonthOccs.reduce((s, o) => s + o.amount, 0);
    const dueSoon = remainingMonthOccs.filter((o) => o.daysUntilDue <= 3);

    const eventBooks = categories.filter((c) => c.kind === 'event');
    const eventTotals = eventBooks.map((book) => ({
      book,
      total: transactions
        .filter((t) => t.categoryId === book.id)
        .reduce((s, t) => s + t.amount, 0),
    }));

    return {
      monthSpent,
      pace,
      totalSavingsAndFds,
      taxDeductibleYear,
      sharedTotal,
      partnerList,
      splitDiff,
      overdueRecurring,
      remainingMonthOccs,
      upcomingMonthTotal,
      dueSoon,
      eventTotals,
    };
  }, [transactions, recurring, categories, members, todayStr, currentMonthBounds, currentYearStr]);

  const openNewTransaction = (opts?: {
    date?: string;
    categoryId?: string;
    prefill?: TransactionPrefill;
  }) => {
    triggerHaptic(8);
    setEditingTx(null);
    setTxPrefill(opts?.prefill || null);
    setDefaultTxDate(opts?.date);
    setDefaultTxCatId(opts?.categoryId);
    setTxModalOpen(true);
  };

  const openEditTransaction = (tx: Transaction) => {
    triggerHaptic(8);
    setEditingTx(tx);
    setTxPrefill(null);
    setDefaultTxDate(undefined);
    setDefaultTxCatId(undefined);
    setTxModalOpen(true);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] dark:bg-[#0B1120] flex items-center justify-center">
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Loading MoneyLedger...
        </div>
      </div>
    );
  }

  if (!user || !householdId || !household || !userProfile) {
    return (
      <MotionConfig reducedMotion="user">
        <AuthGate
          user={user}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          initialInviteCode={pendingInviteCode}
          onConsumePendingInvite={() => {
            clearPendingInvite();
            setPendingInviteCode('');
          }}
          onHouseholdReady={(id) => {
            setHouseholdId(id);
            if (userProfile) {
              setUserProfile({ ...userProfile, activeHouseholdId: id });
            }
          }}
        />
        <OfflineIndicator />
      </MotionConfig>
    );
  }

  const currentMember = members.find((m) => m.uid === user.uid);
  const currentName =
    currentMember?.displayName || userProfile.displayName || user.displayName || 'Partner';

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-[21px] h-[21px]" /> },
    { id: 'events', label: 'Books', icon: <BookOpen className="w-[21px] h-[21px]" /> },
    { id: 'recurring', label: 'Recurring', icon: <CalendarClock className="w-[21px] h-[21px]" /> },
    { id: 'ledger', label: 'Ledger', icon: <ListFilter className="w-[21px] h-[21px]" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-[21px] h-[21px]" /> },
  ];

  const handleQuickPayDue = async (recId: string) => {
    const rec = recurring.find((r) => r.id === recId);
    if (!rec) return;
    setQuickPayingId(rec.id);
    try {
      await markRecurringPaid(
        household.id,
        user.uid,
        currentName,
        household.currency,
        rec,
        todayStr
      );
      triggerHaptic(14);
      showToast(`Logged ${rec.title}`);
    } finally {
      setQuickPayingId(null);
    }
  };

  const handleNotificationNavigate = (n: HouseholdNotification) => {
    if (n.targetCategoryId) {
      setFocusedEventId(n.targetCategoryId);
      switchTab('events');
    } else if (n.kind === 'transaction_added') {
      switchTab('ledger');
    } else {
      switchTab('overview');
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen w-full bg-[#F8F9FA] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 pb-24 md:pb-12 overflow-x-clip">
        {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
        <header className="sticky top-0 z-30 pt-safe border-b border-slate-200/90 dark:border-slate-800/90 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md no-print">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[52px] md:h-16 flex items-center justify-between gap-4 sm:gap-8">
            <button
              onClick={() => switchTab('overview')}
              className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 text-left"
            >
              MoneyLedger
            </button>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => switchTab(item.id)}
                  className={`relative py-2 whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === item.id
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.id === 'events' ? 'Event Books' : item.label}
                  {activeTab === item.id && (
                    <motion.span
                      layoutId="desktopNavIndicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute left-0 right-0 bottom-0 h-0.5 bg-teal-600 dark:bg-teal-400 rounded-full"
                    />
                  )}
                </button>
              ))}
            </nav>

            <div className="flex items-center shrink-0">
              <button
                onClick={() => openNewTransaction()}
                className="min-h-[38px] md:min-h-[40px] px-3.5 md:px-4 py-1.5 md:py-2 rounded-xl bg-teal-600 text-white text-xs sm:text-sm font-semibold hover:bg-teal-700 active:scale-[0.97] transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                Log Entry
              </button>
            </div>
          </div>
        </header>

        <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 sm:pt-7 space-y-5 sm:space-y-6">
          {/* QR Deep-Link Connect Banner (when signed-in user scans a partner QR with phone camera) */}
          {pendingInviteCode && pendingInviteCode !== household.inviteCode && (
            <div className="rounded-2xl border border-teal-200 dark:border-teal-900/60 bg-teal-50/90 dark:bg-teal-950/40 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs sm:text-sm font-semibold text-teal-950 dark:text-teal-100">
                  Partner invite QR detected (<span className="font-mono">{pendingInviteCode}</span>)
                </p>
                <p className="text-xs text-teal-800 dark:text-teal-300">
                  Connect your account to this shared household ledger?
                </p>
                {pendingInviteError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 pt-1">
                    {pendingInviteError}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={joiningPendingInvite}
                  onClick={() => {
                    clearPendingInvite();
                    setPendingInviteCode('');
                    setPendingInviteError(null);
                  }}
                  className="min-h-[38px] px-3 rounded-xl border border-teal-300 dark:border-teal-800 text-xs font-medium text-teal-900 dark:text-teal-200 hover:bg-teal-100/60 dark:hover:bg-teal-900/40"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={joiningPendingInvite}
                  onClick={async () => {
                    setPendingInviteError(null);
                    setJoiningPendingInvite(true);
                    try {
                      const nextId = await joinHouseholdByCode(user, pendingInviteCode);
                      clearPendingInvite();
                      setPendingInviteCode('');
                      setHouseholdId(nextId);
                      setUserProfile((prev) =>
                        prev ? { ...prev, activeHouseholdId: nextId } : prev
                      );
                      switchTab('overview');
                      showToast('Connected to partner household ledger');
                    } catch (err) {
                      setPendingInviteError(
                        err instanceof Error ? err.message : 'Unable to join ledger.'
                      );
                    } finally {
                      setJoiningPendingInvite(false);
                    }
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-60 whitespace-nowrap"
                >
                  {joiningPendingInvite ? 'Connecting...' : 'Connect Now'}
                </button>
              </div>
            </div>
          )}

          {/* Workspace Toolbar */}
          <div className="flex items-center justify-between gap-3 min-w-0 no-print">
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-slate-900 dark:text-white truncate">
                {household.name}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {members.length} {members.length === 1 ? 'member' : 'partners'} synced · INR
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:block">
                <PWAInstallButton variant="compact" />
              </div>

              <button
                onClick={() => {
                  triggerHaptic(8);
                  setNotifOpen((o) => !o);
                }}
                className="min-h-[40px] min-w-[40px] px-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all relative flex items-center justify-center"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="ml-1 text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                    {unreadCount}
                  </span>
                )}
              </button>

              <button
                onClick={toggleDarkMode}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
                aria-label="Toggle dark mode"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait" custom={tabDirection}>
            {activeTab === 'overview' && (
              <motion.div
                key="overview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.04 }}
                className="w-full min-w-0 space-y-6"
              >
                {/* 1-Tap Lock-Screen Push Activation Banner */}
                {(!isPushSubscribed || pushPermission !== 'granted') && (
                  <div className="rounded-2xl border border-teal-200 dark:border-teal-900/60 bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/40 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm no-print">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0">
                        <Bell className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          Enable Lock-Screen Alerts on this {isIOS ? 'iPhone' : 'Device'}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                          {isIOS && !isStandalone
                            ? 'To receive alerts when locked, tap Safari Share → "Add to Home Screen", open the app, and tap Enable.'
                            : 'Receive instant alerts on your lock screen when your partner adds entries or sends nudges.'}
                        </p>
                      </div>
                    </div>
                    {(!isIOS || isStandalone) && (
                      <button
                        onClick={handleActivatePush}
                        disabled={activatingPush}
                        className="min-h-[42px] px-4 rounded-xl bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 shadow-sm disabled:opacity-60"
                      >
                        {activatingPush ? 'Activating...' : 'Enable Alerts Now'}
                      </button>
                    )}
                  </div>
                )}

                {/* Overdue or Gentle 3-Day Upcoming Obligation Reminder */}
                {dashboardStats.overdueRecurring.length > 0 ? (
                  <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs sm:text-sm text-rose-900 dark:text-rose-200">
                      <strong>Overdue obligation:</strong>{' '}
                      {dashboardStats.overdueRecurring[0].title} (
                      <span className="font-mono font-semibold">
                        {formatMoney(dashboardStats.overdueRecurring[0].amount, household.currency)}
                      </span>
                      ) was due {formatShortDate(dashboardStats.overdueRecurring[0].dueDate)}
                      {dashboardStats.overdueRecurring.length > 1
                        ? ` + ${dashboardStats.overdueRecurring.length - 1} more`
                        : ''}
                    </div>
                    <button
                      onClick={() => handleQuickPayDue(dashboardStats.overdueRecurring[0].recurringId)}
                      disabled={quickPayingId === dashboardStats.overdueRecurring[0].recurringId}
                      className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {quickPayingId === dashboardStats.overdueRecurring[0].recurringId
                        ? 'Logging...'
                        : 'Mark Paid'}
                    </button>
                  </div>
                ) : (
                  dashboardStats.dueSoon.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
                        <strong>Upcoming within 3 days:</strong>{' '}
                        {dashboardStats.dueSoon[0].title} (
                        <span className="font-mono font-semibold">
                          {formatMoney(dashboardStats.dueSoon[0].amount, household.currency)}
                        </span>
                        ) on {formatShortDate(dashboardStats.dueSoon[0].dueDate)}
                        {dashboardStats.dueSoon.length > 1
                          ? ` + ${dashboardStats.dueSoon.length - 1} more`
                          : ''}
                      </div>
                      <button
                        onClick={() => handleQuickPayDue(dashboardStats.dueSoon[0].recurringId)}
                        disabled={quickPayingId === dashboardStats.dueSoon[0].recurringId}
                        className="min-h-[40px] px-3.5 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        {quickPayingId === dashboardStats.dueSoon[0].recurringId
                          ? 'Logging...'
                          : 'Mark Paid'}
                      </button>
                    </div>
                  )
                )}

                {/* 4-Column KPI Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
                  <div className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Spent This Month</p>
                    <p className="mt-1.5 text-lg sm:text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
                      {formatMoney(dashboardStats.monthSpent, household.currency)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dashboardStats.pace.deltaPct !== null
                        ? `${dashboardStats.pace.deltaPct <= 0 ? '↓' : '↑'} ${Math.abs(
                            dashboardStats.pace.deltaPct
                          )}% vs last month`
                        : 'Actual logged outflow'}
                    </p>
                  </div>

                  <button
                    onClick={() => switchTab('recurring')}
                    className="min-w-0 text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 hover:border-teal-500 active:scale-[0.99] transition-all"
                  >
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Upcoming Deductions
                    </p>
                    <p className="mt-1.5 text-lg sm:text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 truncate">
                      {formatMoney(dashboardStats.upcomingMonthTotal, household.currency)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dashboardStats.remainingMonthOccs.length} scheduled remaining
                    </p>
                  </button>

                  <div className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Savings, MF &amp; FDs
                    </p>
                    <p className="mt-1.5 text-lg sm:text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                      {formatMoney(dashboardStats.totalSavingsAndFds, household.currency)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                      Cumulative invested
                    </p>
                  </div>

                  <button
                    onClick={() =>
                      dashboardStats.partnerList.length >= 2 && dashboardStats.splitDiff > 0
                        ? switchTab('events')
                        : switchTab('ledger')
                    }
                    className="min-w-0 text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 hover:border-teal-500 active:scale-[0.99] transition-all"
                  >
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dashboardStats.partnerList.length >= 2 && dashboardStats.splitDiff > 0
                        ? 'Shared Fair-Share Split'
                        : 'Tax-Deductible YTD'}
                    </p>
                    <p className="mt-1.5 text-lg sm:text-2xl font-bold font-mono tabular-nums text-teal-600 dark:text-teal-400 truncate">
                      {dashboardStats.partnerList.length >= 2 && dashboardStats.splitDiff > 0
                        ? formatMoney(dashboardStats.splitDiff, household.currency)
                        : formatMoney(dashboardStats.taxDeductibleYear, household.currency)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                      {dashboardStats.partnerList.length >= 2 && dashboardStats.splitDiff > 0
                        ? `${dashboardStats.partnerList[1].name} → ${dashboardStats.partnerList[0].name}`
                        : 'Ready for tax CSV export'}
                    </p>
                  </button>
                </div>

                {/* Allocation Chart + Upcoming Date-wise Deductions */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <section className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                          Spending, Recurring, Savings &amp; FDs Breakdown
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Transparent category &amp; event totals across your household
                        </p>
                      </div>
                      <button
                        onClick={() => switchTab('events')}
                        className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0 pt-0.5"
                      >
                        Open Books
                      </button>
                    </div>
                    <CategoryAllocationChart
                      transactions={transactions}
                      categories={categories}
                      currency={household.currency}
                    />
                  </section>

                  <section className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                          Coming Up This Month
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Date-wise EMIs, insurance &amp; scheduled bills
                        </p>
                      </div>
                      <button
                        onClick={() => switchTab('recurring')}
                        className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0 pt-0.5"
                      >
                        Manage
                      </button>
                    </div>

                    {dashboardStats.remainingMonthOccs.length === 0 ? (
                      <div className="py-10 text-center space-y-2">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No scheduled obligations left this month.
                        </p>
                        <button
                          onClick={() => switchTab('recurring')}
                          className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          Add monthly EMI, insurance, or annual tax
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dashboardStats.remainingMonthOccs.slice(0, 5).map((occ) => (
                          <div
                            key={`${occ.recurringId}-${occ.dueDate}`}
                            className="py-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {occ.title}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {formatShortDate(occ.dueDate)} ·{' '}
                                {occ.daysUntilDue === 0
                                  ? 'Due today'
                                  : `In ${occ.daysUntilDue}d`}{' '}
                                · {occ.ownerName}
                              </p>
                            </div>
                            <span className="text-sm font-mono font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                              {formatMoney(occ.amount, household.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Weekly / Monthly / Calendar / Yearly View */}
                <CalendarTimelineView
                  transactions={transactions}
                  recurring={recurring}
                  categories={categories}
                  currency={household.currency}
                  onAddOnDate={(dateStr) => openNewTransaction({ date: dateStr })}
                  onEditTx={openEditTransaction}
                />

                {/* Event Books Progress Strip + Recent Synced Feed */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <section className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white min-w-0 truncate">
                        Active Event Books
                      </h2>
                      <button
                        onClick={() => switchTab('events')}
                        className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        View All
                      </button>
                    </div>
                    <div className="space-y-4 max-h-[380px] overflow-y-auto overscroll-contain pr-1">
                      {dashboardStats.eventTotals.map(({ book, total }) => {
                        const pct =
                          book.budgetLimit > 0
                            ? Math.min(100, Math.round((total / book.budgetLimit) * 100))
                            : 0;
                        return (
                          <button
                            key={book.id}
                            onClick={() => {
                              setFocusedEventId(book.id);
                              switchTab('events');
                            }}
                            className="w-full text-left space-y-1.5 group"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5 min-w-0 pr-3">
                                <span
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
                                  style={{ backgroundColor: book.color }}
                                >
                                  <CategoryIcon icon={book.icon} className="w-3.5 h-3.5" />
                                </span>
                                <span className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                                  {book.name}
                                </span>
                              </div>
                              <span className="text-sm font-mono font-bold text-slate-900 dark:text-white shrink-0">
                                {formatMoney(total, household.currency)}
                              </span>
                            </div>
                            {book.budgetLimit > 0 && (
                              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${Math.max(4, pct)}%`, backgroundColor: book.color }}
                                />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-white min-w-0 truncate">
                        Recent Synced Transactions
                      </h2>
                      <button
                        onClick={() => switchTab('ledger')}
                        className="text-xs font-medium text-teal-600 dark:text-teal-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        Search &amp; Export
                      </button>
                    </div>

                    {transactions.length === 0 ? (
                      <div className="py-10 text-center space-y-3">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Your shared ledger is ready. Log your first FD, mutual fund SIP, event, or daily expense.
                        </p>
                        <button
                          onClick={() => openNewTransaction()}
                          className="px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700"
                        >
                          Log First Entry
                        </button>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {transactions.slice(0, 6).map((tx) => {
                          const cat = catMap.get(tx.categoryId);
                          return (
                            <button
                              key={tx.id}
                              onClick={() => openEditTransaction(tx)}
                              className="w-full py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 px-1 rounded-lg transition-colors"
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                                <div
                                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                                  style={{ backgroundColor: cat?.color || '#0D9488' }}
                                >
                                  <CategoryIcon icon={cat?.icon || 'tag'} className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                    {tx.title}
                                  </p>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    {formatShortDate(tx.date)} · {tx.categoryName} · {tx.paidByName}
                                  </p>
                                </div>
                              </div>
                              <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white shrink-0">
                                {tx.type === 'income' ? '+' : ''}
                                {formatMoney(tx.amount, household.currency)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              </motion.div>
            )}

            {activeTab === 'events' && (
              <motion.div
                key="events"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.04 }}
                className="w-full min-w-0"
              >
                <EventBooksView
                  householdId={household.id}
                  currentUid={user.uid}
                  currentName={currentName}
                  currency={household.currency}
                  categories={categories}
                  transactions={transactions}
                  members={members}
                  initialCategoryId={focusedEventId}
                  onAddTxForCategory={(categoryId) => openNewTransaction({ categoryId })}
                  onSettleUp={({ categoryId, categoryName, fromUid, toName, amount }) =>
                    openNewTransaction({
                      categoryId,
                      prefill: {
                        title: `Fair-Share Settlement (${categoryName})`,
                        amount,
                        categoryId,
                        paidByUid: fromUid,
                        type: 'expense',
                        scope: 'shared',
                        notes: `Settling 50/50 split with ${toName}`,
                      },
                    })
                  }
                  onEditTx={openEditTransaction}
                  onSuccessToast={showToast}
                />
              </motion.div>
            )}

            {activeTab === 'recurring' && (
              <motion.div
                key="recurring"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.04 }}
                className="w-full min-w-0"
              >
                <RecurringCashflowView
                  household={household}
                  currentUid={user.uid}
                  currentName={currentName}
                  members={members}
                  categories={categories}
                  recurring={recurring}
                  onSuccessToast={showToast}
                />
              </motion.div>
            )}

            {activeTab === 'ledger' && (
              <motion.div
                key="ledger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.04 }}
                className="w-full min-w-0"
              >
                <LedgerHistoryView
                  householdId={household.id}
                  householdName={household.name}
                  currency={household.currency}
                  transactions={transactions}
                  categories={categories}
                  members={members}
                  onEditTx={openEditTransaction}
                  onRepeatTx={(tx) =>
                    openNewTransaction({
                      date: todayStr,
                      categoryId: tx.categoryId,
                      prefill: {
                        title: tx.title,
                        amount: tx.amount,
                        categoryId: tx.categoryId,
                        paidByUid: tx.paidByUid,
                        type: tx.type,
                        scope: tx.scope,
                        notes: tx.notes,
                        isTaxDeductible: tx.isTaxDeductible,
                      },
                    })
                  }
                  onSuccessToast={showToast}
                />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.04 }}
                className="w-full min-w-0"
              >
                <SettingsView
                  household={household}
                  userProfile={userProfile}
                  members={members}
                  categories={categories}
                  transactions={transactions}
                  recurring={recurring}
                  darkMode={darkMode}
                  onToggleDarkMode={toggleDarkMode}
                  pushSupported={pushSupported}
                  pushPermission={pushPermission}
                  isPushSubscribed={isPushSubscribed}
                  isEphemeralVapid={isEphemeralVapid}
                  firestoreSyncOk={firestoreSyncOk}
                  pushRulesMissing={pushRulesMissing}
                  pushEndpoint={pushEndpoint}
                  registeredDevices={pushSubscriptions}
                  isIOS={isIOS}
                  isStandalone={isStandalone}
                  onSubscribeWebPush={() => subscribeToWebPush(household.id, user.uid)}
                  onReRegisterWebPush={() => reRegisterWebPush(household.id, user.uid)}
                  onSendTestPush={sendTestPush}
                  onSendPartnerTestPush={() =>
                    sendPartnerTestPush(household.id, user.uid, currentName)
                  }
                  onRequestPushPermission={requestPushPermission}
                  onTestNotification={() => {
                    showNotification(
                      'MoneyLedger Alerts Active',
                      'You will receive real-time alerts whenever your partner adds an entry or sends a nudge.',
                      { tag: 'moneyledger-test' }
                    );
                    presentBanner(
                      {
                        variant: 'partner',
                        title: 'Partner Alerts Ready',
                        subtitle:
                          'Real-time updates & contribution nudges will slide in here and notify your phone.',
                      },
                      5000
                    );
                  }}
                  onSwitchHousehold={(id) => {
                    setHouseholdId(id);
                    if (!id) {
                      setHousehold(null);
                      setUserProfile((prev) =>
                        prev ? { ...prev, activeHouseholdId: '' } : prev
                      );
                    } else {
                      switchTab('overview');
                    }
                  }}
                  onSuccessToast={showToast}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Native-Style Mobile Bottom Navigation Dock */}
        <nav
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[60px] pb-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/90 dark:border-slate-800/90 grid grid-cols-5 items-center no-print shadow-[0_-4px_20px_rgba(0,0,0,0.04)] dark:shadow-none"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.9 }}
                onClick={() => switchTab(item.id)}
                className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? 'text-teal-600 dark:text-teal-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="mobileNavIndicator"
                    transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    className="absolute top-0 w-9 h-0.5 rounded-full bg-teal-600 dark:bg-teal-400"
                  />
                )}
                <motion.span
                  animate={{ y: active ? -1 : 0, scale: active ? 1.08 : 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                  className={`px-3 py-1 rounded-xl transition-colors ${
                    active ? 'bg-teal-50 dark:bg-teal-950/60' : ''
                  }`}
                >
                  {item.icon}
                </motion.span>
                <span className="text-[10px] font-semibold tracking-tight leading-none">
                  {item.label}
                </span>
              </motion.button>
            );
          })}
        </nav>

        <TransactionModal
          isOpen={txModalOpen}
          onClose={() => setTxModalOpen(false)}
          householdId={household.id}
          currentUid={user.uid}
          currentName={currentName}
          currency={household.currency}
          members={members}
          categories={categories}
          editingTx={editingTx}
          prefill={txPrefill}
          defaultDate={defaultTxDate}
          defaultCategoryId={defaultTxCatId}
          onSuccessToast={showToast}
        />

        <NotificationSheet
          isOpen={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={notifications}
          currentUid={user.uid}
          currency={household.currency}
          onMarkAllRead={() => markNotificationsRead(household.id, user.uid, notifications)}
          onClearAll={async () => {
            try {
              await clearAllNotifications(household.id, notifications);
              showToast('Notifications cleared');
            } catch {
              showToast('Unable to clear notifications');
            }
          }}
          onSelectNotification={handleNotificationNavigate}
        />

        <LiveNotificationBanner
          banner={liveBanner}
          currency={household.currency}
          onDismiss={() => setLiveBanner(null)}
          onViewBook={(catId) => {
            if (catId) {
              setFocusedEventId(catId);
              switchTab('events');
            } else {
              switchTab('ledger');
            }
          }}
          onLogShare={(catId, amt) => {
            openNewTransaction({
              categoryId: catId,
              prefill: {
                title: 'Partner Share Contribution',
                amount: amt,
                categoryId: catId,
                type: 'expense',
                scope: 'shared',
              },
            });
          }}
        />

        <OfflineIndicator />
      </div>
    </MotionConfig>
  );
}
