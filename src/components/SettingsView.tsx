import React, { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  Download,
  FileJson,
  LogOut,
  Moon,
  QrCode,
  RefreshCw,
  Send,
  Share2,
  Smartphone,
  Sun,
  Upload,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import {
  disconnectHouseholdMember,
  joinHouseholdByCode,
  leaveHousehold,
  restoreHouseholdBackup,
  updateHouseholdSettings,
  updateUserPreferences,
} from '../services/householdService';
import type {
  Category,
  GenericFinanceBackup,
  Household,
  HouseholdMember,
  HouseholdPushSubscription,
  RecurringObligation,
  Transaction,
  UserProfile,
} from '../types';
import {
  buildGenericBackupPayload,
  downloadBackupJSON,
  parseGenericFinanceBackup,
} from '../utils/backup';
import { buildInviteUrl } from '../utils/inviteQr';
import { InviteQRCode } from './InviteQRCode';
import { PWAInstallButton } from './PWAInstallButton';
import { QRScannerModal } from './QRScannerModal';

interface SettingsViewProps {
  household: Household;
  userProfile: UserProfile;
  members: HouseholdMember[];
  categories: Category[];
  transactions: Transaction[];
  recurring: RecurringObligation[];
  darkMode: boolean;
  onToggleDarkMode: () => void;
  pushSupported: boolean;
  pushPermission: NotificationPermission;
  isPushSubscribed?: boolean;
  isEphemeralVapid?: boolean;
  firestoreSyncOk?: boolean | null;
  pushRulesMissing?: boolean;
  pushEndpoint?: string | null;
  registeredDevices?: HouseholdPushSubscription[];
  isIOS?: boolean;
  isStandalone?: boolean;
  onSubscribeWebPush?: () => Promise<{ ok: boolean; reason?: string; firestoreSynced?: boolean }>;
  onReRegisterWebPush?: () => Promise<{ ok: boolean; reason?: string; firestoreSynced?: boolean }>;
  onSendTestPush?: (delaySeconds?: number) => Promise<{ ok: boolean; reason?: string }>;
  onSendPartnerTestPush?: () => Promise<{
    sent: number;
    failed: number;
    totalTargets: number;
    reason?: string;
  }>;
  onRequestPushPermission: () => Promise<NotificationPermission>;
  onTestNotification: () => void;
  onSwitchHousehold: (id: string) => void;
  onSuccessToast: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  household,
  userProfile,
  members,
  categories,
  transactions,
  recurring,
  darkMode,
  onToggleDarkMode,
  pushSupported,
  pushPermission,
  isPushSubscribed = false,
  isEphemeralVapid = false,
  firestoreSyncOk = null,
  pushRulesMissing = false,
  pushEndpoint = null,
  registeredDevices = [],
  isIOS = false,
  isStandalone = false,
  onSubscribeWebPush,
  onReRegisterWebPush,
  onSendTestPush,
  onSendPartnerTestPush,
  onRequestPushPermission,
  onTestNotification,
  onSwitchHousehold,
  onSuccessToast,
}) => {
  const [hhName, setHhName] = useState(household.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHhName(household.name);
  }, [household.name]);
  const [copied, setCopied] = useState(false);
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    filename: string;
    data: GenericFinanceBackup;
  } | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDisconnectUid, setConfirmDisconnectUid] = useState<string | null>(null);
  const [disconnectingUid, setDisconnectingUid] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const handleSaveHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateHouseholdSettings(household.id, { name: hhName, currency: 'INR' });
      await updateUserPreferences(userProfile.uid, { currency: 'INR' });
      onSuccessToast('Household settings saved');
    } catch {
      onSuccessToast('Could not save settings right now');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(household.inviteCode);
      setCopied(true);
      onSuccessToast('Invite code copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onSuccessToast(`Invite code: ${household.inviteCode}`);
    }
  };

  const appUrl = buildInviteUrl(household.inviteCode);
  const shareText = `Join our MoneyLedger shared finance book "${household.name}" with invite code: ${household.inviteCode}`;
  const fullShareMessage = `${shareText}\n\nTap to connect: ${appUrl}`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(fullShareMessage)}`;
  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleCopyInviteMessage = async () => {
    try {
      await navigator.clipboard.writeText(fullShareMessage);
      setCopied(true);
      onSuccessToast('Invite message copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onSuccessToast(`Invite code: ${household.inviteCode}`);
    }
    setShareOpen(false);
  };

  const handleNativeShare = async () => {
    if (!supportsNativeShare) {
      await handleCopyInviteMessage();
      return;
    }
    try {
      await navigator.share({
        title: 'Join MoneyLedger Shared Ledger',
        text: shareText,
        url: appUrl,
      });
      setShareOpen(false);
    } catch {
      // User cancelled native share sheet
    }
  };

  const [clearingCache, setClearingCache] = useState(false);

  const handleClearCacheAndReload = async () => {
    setClearingCache(true);
    onSuccessToast('Clearing cache and reloading app...');

    try {
      // Delete CacheStorage (Workbox precache & runtime bundles)
      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }

      // Unregister Service Workers so the fresh build activates immediately
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }

      // Clear non-critical sessionStorage
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }

      // Clear any non-essential cookies
      if (typeof document !== 'undefined' && document.cookie) {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const eqPos = cookie.indexOf('=');
          const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      }
    } catch (err) {
      console.warn('Error clearing cache:', err);
    }

    // Force hard reload bypassing browser cache with fresh timestamp
    setTimeout(() => {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.replace(`${cleanUrl}?v=${Date.now()}`);
    }, 350);
  };

  const [reRegistering, setReRegistering] = useState(false);
  const [testingOtherDevices, setTestingOtherDevices] = useState(false);

  const handleEnableNotifications = async (forceRefresh = false) => {
    const fn = forceRefresh && onReRegisterWebPush ? onReRegisterWebPush : onSubscribeWebPush;
    if (fn) {
      setReRegistering(true);
      try {
        const res = await fn();
        if (res.ok) {
          await updateUserPreferences(userProfile.uid, {
            notificationsEnabled: true,
          }).catch(() => {});
          if (!forceRefresh) onTestNotification();
          onSuccessToast(
            forceRefresh
              ? 'Device push token refreshed & synced'
              : 'Push alerts enabled for lock-screen'
          );
          return;
        }
        if (res.reason === 'ios_install_required') {
          onSuccessToast('On iPhone, tap Share → Add to Home Screen first');
          return;
        }
        if (res.reason === 'permission_denied') {
          onSuccessToast('Enable notifications in browser/phone settings');
          return;
        }
      } finally {
        setReRegistering(false);
      }
    }

    const perm = await onRequestPushPermission();
    await updateUserPreferences(userProfile.uid, {
      notificationsEnabled: perm === 'granted',
    }).catch(() => {});
    if (perm === 'granted') {
      onTestNotification();
      onSuccessToast('Push notifications enabled');
    } else {
      onSuccessToast('Enable notifications in browser/phone settings');
    }
  };

  const [testingLockScreen, setTestingLockScreen] = useState(false);

  const handleTestLockScreen = async (delaySeconds = 3) => {
    if (!onSendTestPush) {
      onTestNotification();
      return;
    }
    setTestingLockScreen(true);
    if (delaySeconds > 0) {
      onSuccessToast('Lock your phone now! Notification arriving in 3 seconds...');
    } else {
      onSuccessToast('Sending lock-screen test notification...');
    }
    try {
      const res = await onSendTestPush(delaySeconds);
      if (!res.ok) {
        onSuccessToast(res.reason || 'Failed to send test alert');
      }
    } finally {
      setTimeout(() => setTestingLockScreen(false), (delaySeconds + 1) * 1000);
    }
  };

  const handleTestOtherDevices = async () => {
    if (!onSendPartnerTestPush) return;
    setTestingOtherDevices(true);
    try {
      const res = await onSendPartnerTestPush();
      if (res.sent > 0) {
        onSuccessToast(
          `Sent lock-screen alert to ${res.sent} other device${res.sent === 1 ? '' : 's'}!`
        );
      } else if (res.totalTargets === 0) {
        onSuccessToast(
          'No other device subscribed yet — open MoneyLedger on your other phone & enable alerts'
        );
      } else {
        onSuccessToast(
          'Push reached server but delivery failed — tap "Re-register Device" on the other phone'
        );
      }
    } finally {
      setTestingOtherDevices(false);
    }
  };

  const connectByInviteCode = async (rawCode: string) => {
    if (!auth.currentUser) return;
    setJoinError(null);
    setJoining(true);
    try {
      const nextId = await joinHouseholdByCode(auth.currentUser, rawCode);
      setJoinCode('');
      onSwitchHousehold(nextId);
      onSuccessToast('Joined partner household ledger');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Unable to join household.');
    } finally {
      setJoining(false);
    }
  };

  const handleJoinAnother = async (e: React.FormEvent) => {
    e.preventDefault();
    await connectByInviteCode(joinCode);
  };

  const handleScanToSwitch = (scannedCode: string) => {
    setJoinCode(scannedCode);
    void connectByInviteCode(scannedCode);
  };

  const handleDownloadBackup = () => {
    const payload = buildGenericBackupPayload(
      household,
      categories,
      transactions,
      recurring
    );
    const slug = household.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'moneyledger';
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBackupJSON(payload, `${slug}-backup-${stamp}.json`);
    onSuccessToast('Portable JSON backup downloaded');
  };

  const handlePickBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreError(null);
    try {
      const text = await file.text();
      const parsed = parseGenericFinanceBackup(text);
      setPendingBackup({ filename: file.name, data: parsed });
      setRestoreMode('merge');
    } catch (err) {
      setPendingBackup(null);
      setRestoreError(err instanceof Error ? err.message : 'Unable to parse backup file.');
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingBackup || !auth.currentUser) return;
    setRestoreError(null);
    setRestoring(true);
    try {
      const result = await restoreHouseholdBackup(
        household.id,
        auth.currentUser.uid,
        userProfile.displayName,
        members,
        categories,
        transactions,
        recurring,
        pendingBackup.data,
        restoreMode
      );
      setPendingBackup(null);
      onSuccessToast(
        `Restored ${result.transactionsAdded} entries, ${result.recurringAdded} rules, ${result.categoriesAdded} books`
      );
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore backup.');
    } finally {
      setRestoring(false);
    }
  };

  const handleDisconnectMember = async (member: HouseholdMember) => {
    setDisconnectError(null);
    setDisconnectingUid(member.uid);
    const isSelf = member.uid === userProfile.uid;
    try {
      if (isSelf) {
        await leaveHousehold(household.id, userProfile.uid);
        setConfirmDisconnectUid(null);
        onSuccessToast(`Left ${household.name}`);
        onSwitchHousehold('');
      } else {
        await disconnectHouseholdMember(household.id, member.uid);
        setConfirmDisconnectUid(null);
        onSuccessToast(`Disconnected ${member.displayName}`);
      }
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : 'Unable to disconnect member right now.'
      );
    } finally {
      setDisconnectingUid(null);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Settings &amp; Partner Sync
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage your partner invite code, QR connection, push notifications, dark mode, and install on your phone.
        </p>
      </div>

      {/* Partner Invite Card */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              Partner Invite Code &amp; QR
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Share this code or let your partner scan the QR code to sync all books in real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-mono text-base font-bold tracking-widest text-slate-900 dark:text-white">
              {household.inviteCode}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Copy invite code"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowQrPanel((prev) => !prev)}
              className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                showQrPanel
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              {showQrPanel ? 'Hide QR' : 'Show QR'}
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="min-h-[42px] px-3.5 rounded-xl bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
        </div>

        {showQrPanel && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-5">
            <InviteQRCode
              inviteCode={household.inviteCode}
              householdName={household.name}
            />
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Connected Household Members ({members.length})
          </p>
          {disconnectError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
              {disconnectError}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            {members.map((m) => {
              const isOwner = household.ownerId === userProfile.uid;
              const isSelf = m.uid === userProfile.uid;
              const canDisconnect = (isOwner && !isSelf) || (!isOwner && isSelf);
              const isConfirming = confirmDisconnectUid === m.uid;
              const isBusy = disconnectingUid === m.uid;

              return (
                <div
                  key={m.uid}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {m.photoURL ? (
                        <img
                          src={m.photoURL}
                          alt={m.displayName}
                          referrerPolicy="no-referrer"
                          className="w-8 h-8 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-teal-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                          {m.displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {m.displayName}
                          {isSelf ? ' (You)' : ''}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                          {m.role}
                        </p>
                      </div>
                    </div>

                    {canDisconnect && !isConfirming && (
                      <button
                        type="button"
                        onClick={() => {
                          setDisconnectError(null);
                          setConfirmDisconnectUid(m.uid);
                        }}
                        className="min-h-[36px] px-3 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                        {isSelf ? 'Leave' : 'Disconnect'}
                      </button>
                    )}
                  </div>

                  {isConfirming && (
                    <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {isSelf
                          ? 'Leave this shared ledger? You can rejoin later using an invite code.'
                          : `Disconnect ${m.displayName} from this ledger? Logged transactions remain intact.`}
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDisconnectUid(null)}
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDisconnectMember(m)}
                          className="min-h-[34px] px-3 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-60 whitespace-nowrap"
                        >
                          {isBusy
                            ? 'Removing...'
                            : isSelf
                              ? 'Confirm Leave'
                              : 'Confirm Disconnect'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Household Preferences */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Ledger Details
          </h3>
          <form onSubmit={handleSaveHousehold} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Household Name
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={hhName}
                onChange={(e) => setHhName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Currency
              </span>
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                Indian Rupee (₹ INR)
              </span>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[44px] rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </form>
        </section>

        {/* Notifications, Theme & App Install */}
        <section className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Device &amp; Alerts
          </h3>

          <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                Dark Mode
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                High-contrast slate theme for night readability
              </p>
            </div>
            <button
              onClick={onToggleDarkMode}
              className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
          </div>

          <div className="py-2.5 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Bell className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  Push Notifications &amp; Lock-Screen Alerts
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isIOS && !isStandalone
                    ? 'Add to Home Screen on iPhone for lock-screen alerts'
                    : !pushSupported
                      ? 'Web Push is not supported in this browser'
                      : isPushSubscribed
                        ? 'Lock-screen alerts active · High-priority wake enabled for iPhone & Android'
                        : pushPermission === 'granted'
                          ? 'Permission granted · Tap Re-register Device to sync lock-screen push'
                          : 'Alerts when your partner logs an expense or sends a nudge'}
                </p>
              </div>

              {pushPermission === 'granted' ? (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={testingLockScreen}
                    onClick={() => handleTestLockScreen(0)}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Bell className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Test Now
                  </button>
                  <button
                    type="button"
                    disabled={testingLockScreen}
                    onClick={() => handleTestLockScreen(3)}
                    className="min-h-[40px] px-3.5 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 active:scale-95 transition-all inline-flex items-center gap-1.5 whitespace-nowrap shadow-sm disabled:opacity-60"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    {testingLockScreen ? 'Lock Screen Now (3s)...' : 'Test Lock Screen (in 3s)'}
                  </button>
                  {onSendPartnerTestPush && (
                    <button
                      type="button"
                      disabled={testingOtherDevices}
                      onClick={handleTestOtherDevices}
                      className="min-h-[40px] px-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100/70 dark:hover:bg-teal-900/40 active:scale-95 transition-all inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {testingOtherDevices ? 'Sending...' : 'Ping Other Devices'}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={reRegistering}
                  onClick={() => handleEnableNotifications(false)}
                  className="min-h-[44px] px-4 rounded-xl bg-teal-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:bg-teal-700 active:scale-95 transition-all shadow-sm disabled:opacity-60"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {reRegistering ? 'Enabling...' : 'Enable Alerts'}
                </button>
              )}
            </div>

            {pushPermission === 'granted' && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    Synced household devices:{' '}
                    <strong className="font-mono text-slate-700 dark:text-slate-200">
                      {registeredDevices.length}
                    </strong>
                    {registeredDevices.length > 0 && (
                      <>
                        {' '}
                        (
                        {registeredDevices
                          .map((d) =>
                            d.endpoint === pushEndpoint ? `${d.deviceLabel} · This device` : d.deviceLabel
                          )
                          .slice(0, 3)
                          .join(', ')}
                        {registeredDevices.length > 3 ? ` +${registeredDevices.length - 3}` : ''})
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={reRegistering}
                    onClick={() => handleEnableNotifications(true)}
                    className="text-teal-600 dark:text-teal-400 hover:underline font-medium shrink-0 disabled:opacity-50"
                  >
                    {reRegistering ? 'Re-registering...' : 'Re-register Device'}
                  </button>
                </div>

                {(pushRulesMissing || firestoreSyncOk === false) && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold">Cloud Push Sync Needs Rules Update:</strong>{' '}
                      Deploy the updated <code className="font-mono">firestore.rules</code> to your Firebase project so device push tokens stay synced across server restarts.
                    </div>
                  </div>
                )}

                {isEphemeralVapid && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold">Temporary Push Keys Active:</strong>{' '}
                      Configure <code className="font-mono">VAPID_PUBLIC_KEY</code> and{' '}
                      <code className="font-mono">VAPID_PRIVATE_KEY</code> in environment secrets so locked phones keep receiving alerts after server restarts.
                    </div>
                  </div>
                )}
              </div>
            )}

            {isIOS && !isStandalone && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <Smartphone className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">iPhone Lock-Screen Alerts:</strong> Apple requires MoneyLedger to be added to your Home Screen to deliver notifications when your phone is locked or screen is off. Tap Safari&apos;s <strong>Share</strong> button and choose <strong>Add to Home Screen</strong>.
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-1">
            <PWAInstallButton variant="full" />

            <button
              type="button"
              disabled={clearingCache}
              onClick={handleClearCacheAndReload}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 text-teal-600 dark:text-teal-400 ${clearingCache ? 'animate-spin' : ''}`} />
              {clearingCache ? 'Clearing & Reloading...' : 'Clear Cache & Reload App'}
            </button>

            <button
              type="button"
              onClick={() => signOut(auth)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out ({userProfile.displayName})
            </button>
          </div>
        </section>
      </div>

      {/* Portable JSON Backup & Restore */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <FileJson className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              Portable Backup &amp; Restore (Generic JSON)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Download all books, transactions, and recurring rules in a clean open JSON schema that any app can import—or restore a backup anytime.
            </p>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1.5">
              {categories.length} books · {transactions.length} transactions · {recurring.length} recurring rules
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadBackup}
              className="min-h-[42px] px-4 rounded-xl bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download Backup (.json)
            </button>

            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handlePickBackupFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              Restore from JSON
            </button>
          </div>
        </div>

        {restoreError && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
            {restoreError}
          </div>
        )}

        {pendingBackup && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  Ready to Restore: {pendingBackup.filename}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Source: {pendingBackup.data.sourceApp} ·{' '}
                  {pendingBackup.data.categories.length} books ·{' '}
                  {pendingBackup.data.transactions.length} transactions ·{' '}
                  {pendingBackup.data.recurring.length} recurring rules
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900 max-w-sm">
              <button
                type="button"
                onClick={() => setRestoreMode('merge')}
                className={`min-h-[36px] rounded-lg text-xs font-medium transition-colors ${
                  restoreMode === 'merge'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Merge with Current
              </button>
              <button
                type="button"
                onClick={() => setRestoreMode('replace')}
                className={`min-h-[36px] rounded-lg text-xs font-medium transition-colors ${
                  restoreMode === 'replace'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Replace Existing
              </button>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {restoreMode === 'merge'
                ? 'Adds backup transactions and rules while matching existing categories by name.'
                : 'Deletes all current books, transactions, and recurring rules in this household before restoring from the file.'}
            </p>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={restoring}
                onClick={handleConfirmRestore}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-60 ${
                  restoreMode === 'replace'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {restoring
                  ? 'Restoring...'
                  : restoreMode === 'replace'
                    ? 'Confirm Replace & Restore'
                    : 'Confirm Merge Restore'}
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={() => setPendingBackup(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Join another household */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Connect to Partner&apos;s Ledger
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Scan a partner QR code or enter their invite code
          </p>
        </div>
        <form onSubmit={handleJoinAnother} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            maxLength={12}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Enter partner's invite code (e.g. ML8X4K2P)"
            className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-mono uppercase text-slate-900 dark:text-white"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={joining}
              onClick={() => setScannerOpen(true)}
              className="flex-1 sm:flex-initial min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              Scan QR
            </button>
            <button
              type="submit"
              disabled={joining || joinCode.trim().length < 6}
              className="flex-1 sm:flex-initial min-h-[44px] px-5 rounded-xl bg-slate-900 dark:bg-teal-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {joining ? 'Joining...' : 'Join Ledger'}
            </button>
          </div>
        </form>
        {joinError && <p className="text-xs text-rose-600 dark:text-rose-400">{joinError}</p>}
      </section>

      {/* Share Options Sheet */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4 overflow-hidden"
          onTouchMove={(e) => e.stopPropagation()}
          onClick={() => setShareOpen(false)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Share Ledger Invite
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Code: <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{household.inviteCode}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close share options"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
              <InviteQRCode
                inviteCode={household.inviteCode}
                householdName={household.name}
                compact
              />
            </div>

            <div className="space-y-2.5">
              <a
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShareOpen(false)}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#25D366] hover:bg-[#1EBE5D] text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.79 14.08c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.01-2.42.27-.29.58-.36.77-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.02 1.12.99 2.06 1.3 2.35 1.45.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.15.27.1 1.69.8 1.98.94.29.15.48.22.55.34.07.12.07.7-.17 1.38z" />
                </svg>
                Share on WhatsApp
              </a>

              <button
                type="button"
                onClick={handleCopyInviteMessage}
                className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy Invite Message &amp; Link
              </button>

              {supportsNativeShare && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  More Share Options
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanCode={handleScanToSwitch}
      />
    </div>
  );
};
