import React, { useEffect, useState } from 'react';
import { User, signInWithPopup, signOut } from 'firebase/auth';
import { motion } from 'motion/react';
import {
  ArrowRight,
  KeyRound,
  LogOut,
  Moon,
  PlusCircle,
  QrCode,
  Sun,
  Users,
} from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import { createHouseholdWorkspace, joinHouseholdByCode } from '../services/householdService';
import { clearPendingInvite } from '../utils/inviteQr';
import { PWAInstallButton } from './PWAInstallButton';
import { QRScannerModal } from './QRScannerModal';

interface AuthGateProps {
  user: User | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onHouseholdReady: (householdId: string) => void;
  initialInviteCode?: string;
  onConsumePendingInvite?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onHouseholdReady,
  initialInviteCode = '',
  onConsumePendingInvite,
}) => {
  const [mode, setMode] = useState<'create' | 'join'>(
    initialInviteCode ? 'join' : 'create'
  );
  const [householdName, setHouseholdName] = useState('Family & Milestones');
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialInviteCode) {
      setMode('join');
      setInviteCode(initialInviteCode);
    }
  }, [initialInviteCode]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const id = await createHouseholdWorkspace(user, householdName, 'INR', 0);
      clearPendingInvite();
      onConsumePendingInvite?.();
      onHouseholdReady(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create household workspace.');
    } finally {
      setBusy(false);
    }
  };

  const submitJoinWithCode = async (codeToJoin: string) => {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const id = await joinHouseholdByCode(user, codeToJoin);
      clearPendingInvite();
      onConsumePendingInvite?.();
      onHouseholdReady(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join with that invite code.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitJoinWithCode(inviteCode);
  };

  const handleQrScanned = (scannedCode: string) => {
    setInviteCode(scannedCode);
    void submitJoinWithCode(scannedCode);
  };

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#F8F9FA] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3 sm:gap-8">
        <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          MoneyLedger
        </span>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <PWAInstallButton variant="compact" />
          <button
            onClick={onToggleDarkMode}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {user && (
            <button
              onClick={() => signOut(auth)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="lg:col-span-7 min-w-0 space-y-6"
        >
          <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
            Shared Household &amp; Event Finance
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] [text-wrap:balance] max-w-2xl">
            One calm ledger for both phones and your laptop.
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
            Log shared event expenses, Mutual Funds (MF), Fixed Deposits (FD), monthly EMIs, and
            half-yearly insurance together. Every entry syncs in real time across Android, iPhone,
            and desktop—even when added offline.
          </p>

          <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-slate-200 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Real-Time Partner Sync
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Instant alerts, fair-share splits, and shared event books across devices.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Date-Wise Projections
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Track upcoming EMIs, LIC premiums, and annual taxes on your calendar.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Offline-First PWA
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Install on home screen; offline entries queue locally and auto-sync.
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="lg:col-span-5 min-w-0"
        >
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
            {!user ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Sign in to get started
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    Start logging expenses immediately and invite your partner anytime.
                  </p>
                </div>

                {initialInviteCode && (
                  <div className="rounded-xl border border-teal-200 dark:border-teal-900/60 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 text-xs text-teal-800 dark:text-teal-200">
                    Partner invite <span className="font-mono font-bold">{initialInviteCode}</span> detected. Sign in with Google to connect automatically.
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleGoogleSignIn}
                  disabled={busy}
                  className="w-full min-h-[48px] flex items-center justify-center gap-3 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.99] transition-all disabled:opacity-60"
                >
                  <span>{busy ? 'Connecting...' : 'Continue with Google'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  No opening bank balance required—create your shared ledger, scan a partner QR code, or enter an invite code right after signing in.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Signed in as {user.displayName || user.email}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                    Set up your shared ledger
                  </h2>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('create');
                      setError(null);
                    }}
                    className={`relative min-h-[40px] flex items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      mode === 'create'
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {mode === 'create' && (
                      <motion.span
                        layoutId="authModePill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-lg bg-white dark:bg-slate-900 shadow-sm"
                      />
                    )}
                    <PlusCircle className="relative z-10 w-3.5 h-3.5" />
                    <span className="relative z-10">Create New</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('join');
                      setError(null);
                    }}
                    className={`relative min-h-[40px] flex items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      mode === 'join'
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {mode === 'join' && (
                      <motion.span
                        layoutId="authModePill"
                        transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                        className="absolute inset-0 rounded-lg bg-white dark:bg-slate-900 shadow-sm"
                      />
                    )}
                    <Users className="relative z-10 w-3.5 h-3.5" />
                    <span className="relative z-10">Join Partner</span>
                  </button>
                </div>

                {error && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {mode === 'create' ? (
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Household Ledger Name
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={householdName}
                        onChange={(e) => setHouseholdName(e.target.value)}
                        placeholder="e.g. Home & Milestones"
                        className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Currency
                      </span>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Indian Rupee (₹ INR)
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full min-h-[46px] rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors disabled:opacity-60"
                    >
                      {busy ? 'Setting up...' : 'Start Tracking'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleJoin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Partner&apos;s Invite Code or QR
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          maxLength={12}
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                          placeholder="e.g. ML7K4P9M"
                          className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-10 pr-3.5 text-sm font-mono uppercase tracking-wider text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                        Scan your partner&apos;s QR code or enter their invite code from Settings &rarr; Partner Invite.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setScannerOpen(true)}
                        className="w-full min-h-[46px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <QrCode className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                        Scan QR
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full min-h-[46px] rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors disabled:opacity-60"
                      >
                        {busy ? 'Joining...' : 'Join Ledger'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </main>

      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanCode={handleQrScanned}
      />
    </div>
  );
};
