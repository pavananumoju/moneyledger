import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type {
  Category,
  CategoryKind,
  CurrencyCode,
  GenericFinanceBackup,
  HouseholdMember,
  HouseholdNotification,
  HouseholdPushSubscription,
  RecurringFrequency,
  RecurringObligation,
  Transaction,
  TransactionScope,
  TransactionType,
  UserProfile,
} from '../types';
import { addFrequency, formatMoney, STARTER_CATEGORIES } from '../utils/finance';

function clampStr(val: string | undefined | null, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ML';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

let activeClientPushEndpoint: string | null = null;
let cachedHouseholdPushSubs: HouseholdPushSubscription[] = [];

export function setActiveClientPushEndpoint(endpoint: string | null): void {
  activeClientPushEndpoint = endpoint;
}

export function setHouseholdPushSubscriptionsCache(subs: HouseholdPushSubscription[]): void {
  cachedHouseholdPushSubs = subs;
}

export function computePushSubDocId(endpoint: string): string {
  // Deterministic 64-bit FNV-1a-style pair hash -> valid Firestore ID matching ^[a-zA-Z0-9_-]+$
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < endpoint.length; i++) {
    const ch = endpoint.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }
  return `sub_${h1.toString(36)}_${h2.toString(36)}`;
}

export async function getFirebaseAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Proceed without token if unavailable
  }
  return headers;
}

export async function saveHouseholdPushSubscription(
  householdId: string,
  uid: string,
  subscription: PushSubscriptionJSON,
  deviceLabel: string
): Promise<{ ok: boolean; permissionDenied?: boolean }> {
  const endpoint = subscription.endpoint || '';
  const p256dh = subscription.keys?.p256dh || '';
  const authKey = subscription.keys?.auth || '';
  if (!endpoint || !p256dh || !authKey) {
    return { ok: false };
  }

  const subId = computePushSubDocId(endpoint);
  try {
    await setDoc(doc(db, 'households', householdId, 'pushSubscriptions', subId), {
      uid,
      endpoint: clampStr(endpoint, 2048),
      p256dh: clampStr(p256dh, 256),
      auth: clampStr(authKey, 128),
      deviceLabel: clampStr(deviceLabel, 80) || 'Web Device',
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code || '';
    if (code === 'permission-denied' || msg.toLowerCase().includes('missing or insufficient permissions')) {
      return { ok: false, permissionDenied: true };
    }
    console.warn('[MoneyLedger Push] Failed persisting subscription to Firestore:', err);
    return { ok: false };
  }
}

export async function deleteHouseholdPushSubscription(
  householdId: string,
  subId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'households', householdId, 'pushSubscriptions', subId));
  } catch {
    // Best-effort cleanup
  }
}

export async function dispatchBackendPush(payload: {
  householdId: string;
  senderUid: string;
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}): Promise<{ sent: number; failed: number; totalTargets: number; reason?: string }> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return { sent: 0, failed: 0, totalTargets: 0, reason: 'unavailable' };
  }
  try {
    const headers = await getFirebaseAuthHeaders();
    const subscriptions = cachedHouseholdPushSubs.map((s) => ({
      uid: s.uid,
      subscription: {
        endpoint: s.endpoint,
        keys: {
          p256dh: s.p256dh,
          auth: s.auth,
        },
      },
    }));

    const res = await fetch('/api/push/notify', {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        ...payload,
        senderEndpoint: activeClientPushEndpoint,
        subscriptions,
      }),
    });

    if (!res.ok) {
      return { sent: 0, failed: 0, totalTargets: 0, reason: `HTTP ${res.status}` };
    }

    const result = (await res.json()) as {
      sent?: number;
      failed?: number;
      totalTargets?: number;
      deadEndpoints?: string[];
      reason?: string;
    };

    if (Array.isArray(result.deadEndpoints) && result.deadEndpoints.length > 0) {
      for (const deadEndpoint of result.deadEndpoints) {
        void deleteHouseholdPushSubscription(payload.householdId, computePushSubDocId(deadEndpoint));
      }
    }

    return {
      sent: result.sent ?? 0,
      failed: result.failed ?? 0,
      totalTargets: result.totalTargets ?? 0,
      reason: result.reason,
    };
  } catch {
    return { sent: 0, failed: 0, totalTargets: 0, reason: 'network_error' };
  }
}

export async function sendPartnerTestPush(
  householdId: string,
  senderUid: string,
  senderName: string
): Promise<{ sent: number; failed: number; totalTargets: number; reason?: string }> {
  const safeName = clampStr(senderName, 60) || 'Partner';
  return dispatchBackendPush({
    householdId,
    senderUid,
    title: `MoneyLedger Ping from ${safeName}`,
    body: 'Real-time lock-screen alerts are synced across your household devices!',
    tag: `ml-partner-test-${Date.now()}`,
    data: { url: '/' },
  });
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const profile: UserProfile = {
      uid: user.uid,
      displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'Partner', 60) || 'Partner',
      email: clampStr(user.email, 160),
      photoURL: clampStr(user.photoURL, 500),
      activeHouseholdId: '',
      currency: 'INR',
      notificationsEnabled: true,
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: Partial<Pick<UserProfile, 'currency' | 'notificationsEnabled' | 'activeHouseholdId' | 'displayName'>>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.currency) payload.currency = updates.currency;
    if (typeof updates.notificationsEnabled === 'boolean') {
      payload.notificationsEnabled = updates.notificationsEnabled;
    }
    if (typeof updates.activeHouseholdId === 'string') {
      payload.activeHouseholdId = updates.activeHouseholdId;
    }
    if (updates.displayName) {
      payload.displayName = clampStr(updates.displayName, 60);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createHouseholdWorkspace(
  user: User,
  householdName: string,
  _currency: CurrencyCode = 'INR',
  initialBankBalance: number = 0
): Promise<string> {
  const currency: CurrencyCode = 'INR';
  const householdId = generateId('hh');
  const inviteCode = generateInviteCode();
  const safeName = clampStr(householdName, 80) || 'Family Ledger';
  const displayName = clampStr(user.displayName || user.email?.split('@')[0] || 'Partner', 60);
  const safeBalance = Number.isFinite(initialBankBalance) ? initialBankBalance : 0;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'households', householdId), {
      name: safeName,
      inviteCode,
      currency,
      ownerId: user.uid,
      bankBalance: safeBalance,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'householdInvites', inviteCode), {
      inviteCode,
      householdId,
      householdName: safeName,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'households', householdId, 'members', user.uid), {
      uid: user.uid,
      displayName,
      photoURL: clampStr(user.photoURL, 500),
      role: 'owner',
      joinedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', user.uid), {
      activeHouseholdId: householdId,
      currency,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `households/${householdId}`);
  }

  // Seed starter categories in a second batch after member doc exists
  try {
    const catBatch = writeBatch(db);
    for (const starter of STARTER_CATEGORIES) {
      const catId = generateId('cat');
      catBatch.set(doc(db, 'households', householdId, 'categories', catId), {
        name: starter.name,
        kind: starter.kind,
        color: starter.color,
        icon: starter.icon,
        budgetLimit: starter.budgetLimit,
        splitRatio: starter.splitRatio,
        isTaxDeductibleDefault: starter.isTaxDeductibleDefault,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await catBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `households/${householdId}/categories`);
  }

  return householdId;
}

export async function joinHouseholdByCode(user: User, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 6 || code.length > 12) {
    throw new Error('Please enter a valid 6 to 12 character household invite code.');
  }

  const invitePath = `householdInvites/${code}`;
  let householdId = '';
  let householdName = '';

  try {
    const inviteSnap = await getDoc(doc(db, 'householdInvites', code));
    if (!inviteSnap.exists()) {
      throw new Error('Invite code not found. Ask your partner to double-check the code in Settings.');
    }
    const inviteData = inviteSnap.data() as { householdId: string; householdName: string };
    householdId = inviteData.householdId;
    householdName = inviteData.householdName;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invite code not found')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.GET, invitePath);
  }

  const displayName = clampStr(user.displayName || user.email?.split('@')[0] || 'Partner', 60);
  const memberPath = `households/${householdId}/members/${user.uid}`;

  try {
    await setDoc(doc(db, 'households', householdId, 'members', user.uid), {
      uid: user.uid,
      displayName,
      photoURL: clampStr(user.photoURL, 500),
      role: 'partner',
      inviteCodeUsed: code,
      joinedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'users', user.uid), {
      activeHouseholdId: householdId,
      updatedAt: serverTimestamp(),
    });

    const notifId = generateId('notif');
    const notifTitle = 'Partner Joined Ledger';
    const notifMsg = `${displayName} joined ${householdName} and is now syncing in real time.`;
    await setDoc(doc(db, 'households', householdId, 'notifications', notifId), {
      kind: 'member_joined',
      title: notifTitle,
      message: notifMsg,
      fromUid: user.uid,
      fromName: displayName,
      readByUids: [user.uid],
      createdAt: serverTimestamp(),
    });

    void dispatchBackendPush({
      householdId,
      senderUid: user.uid,
      title: notifTitle,
      body: notifMsg,
      tag: notifId,
      data: { url: '/' },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, memberPath);
  }

  return householdId;
}

export async function disconnectHouseholdMember(
  householdId: string,
  memberUid: string
): Promise<void> {
  const path = `households/${householdId}/members/${memberUid}`;
  try {
    await deleteDoc(doc(db, 'households', householdId, 'members', memberUid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function leaveHousehold(householdId: string, uid: string): Promise<void> {
  const path = `households/${householdId}/members/${uid}`;
  try {
    await deleteDoc(doc(db, 'households', householdId, 'members', uid));
    await updateUserPreferences(uid, { activeHouseholdId: '' });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateHouseholdSettings(
  householdId: string,
  updates: { name?: string; currency?: CurrencyCode; bankBalance?: number }
): Promise<void> {
  const path = `households/${householdId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = clampStr(updates.name, 80) || 'Family Ledger';
    if (updates.currency !== undefined) payload.currency = 'INR';
    if (updates.bankBalance !== undefined && Number.isFinite(updates.bankBalance)) {
      payload.bankBalance = updates.bankBalance;
    }
    await updateDoc(doc(db, 'households', householdId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createCategory(
  householdId: string,
  uid: string,
  input: {
    name: string;
    kind: CategoryKind;
    color: string;
    icon: string;
    budgetLimit: number;
    splitRatio: number;
    isTaxDeductibleDefault: boolean;
  }
): Promise<string> {
  const catId = generateId('cat');
  const path = `households/${householdId}/categories/${catId}`;
  try {
    await setDoc(doc(db, 'households', householdId, 'categories', catId), {
      name: clampStr(input.name, 50) || 'Custom Book',
      kind: input.kind,
      color: /^#[0-9a-fA-F]{3,8}$/.test(input.color) ? input.color : '#0D9488',
      icon: clampStr(input.icon, 32) || 'tag',
      budgetLimit: Math.max(0, Number(input.budgetLimit) || 0),
      splitRatio: Math.min(100, Math.max(0, Number(input.splitRatio) || 50)),
      isTaxDeductibleDefault: Boolean(input.isTaxDeductibleDefault),
      createdByUid: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return catId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateCategory(
  householdId: string,
  categoryId: string,
  updates: Partial<Pick<Category, 'name' | 'kind' | 'color' | 'icon' | 'budgetLimit' | 'splitRatio' | 'isTaxDeductibleDefault'>>
): Promise<void> {
  const path = `households/${householdId}/categories/${categoryId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = clampStr(updates.name, 50);
    if (updates.kind !== undefined) payload.kind = updates.kind;
    if (updates.color !== undefined) payload.color = updates.color;
    if (updates.icon !== undefined) payload.icon = clampStr(updates.icon, 32);
    if (updates.budgetLimit !== undefined) payload.budgetLimit = Math.max(0, Number(updates.budgetLimit) || 0);
    if (updates.splitRatio !== undefined) payload.splitRatio = Math.min(100, Math.max(0, Number(updates.splitRatio) || 50));
    if (updates.isTaxDeductibleDefault !== undefined) payload.isTaxDeductibleDefault = updates.isTaxDeductibleDefault;
    await updateDoc(doc(db, 'households', householdId, 'categories', categoryId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCategory(householdId: string, categoryId: string): Promise<void> {
  const path = `households/${householdId}/categories/${categoryId}`;
  try {
    await deleteDoc(doc(db, 'households', householdId, 'categories', categoryId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createTransaction(
  householdId: string,
  actorUid: string,
  actorName: string,
  currency: CurrencyCode,
  input: {
    title: string;
    amount: number;
    type: TransactionType;
    scope: TransactionScope;
    categoryId: string;
    categoryName: string;
    date: string;
    paidByUid: string;
    paidByName: string;
    notes: string;
    isTaxDeductible: boolean;
    recurringId?: string;
    receiptSummary?: string;
  }
): Promise<string> {
  const txId = generateId('tx');
  const path = `households/${householdId}/transactions/${txId}`;
  const safeAmount = Math.max(0.01, Number(input.amount) || 0);
  const safeTitle = clampStr(input.title, 100) || 'Untitled Entry';

  try {
    const payload: Record<string, unknown> = {
      title: safeTitle,
      amount: safeAmount,
      type: input.type,
      scope: input.scope,
      categoryId: input.categoryId,
      categoryName: clampStr(input.categoryName, 50) || 'General',
      date: input.date,
      paidByUid: input.paidByUid,
      paidByName: clampStr(input.paidByName, 60) || 'Partner',
      notes: clampStr(input.notes, 400),
      isTaxDeductible: Boolean(input.isTaxDeductible),
      createdByUid: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (input.recurringId) {
      payload.recurringId = clampStr(input.recurringId, 128);
    }
    if (input.receiptSummary) {
      payload.receiptSummary = clampStr(input.receiptSummary, 300);
    }

    await setDoc(doc(db, 'households', householdId, 'transactions', txId), payload);

    // Emit real-time activity notification for partner push alert
    const notifId = generateId('notif');
    const safeActor = clampStr(actorName, 60) || 'Partner';
    const notifTitle = `${safeActor} added ${safeTitle}`;
    const notifMsg = `${formatMoney(safeAmount, currency)} in ${clampStr(input.categoryName, 50)} (${input.scope})`;
    await setDoc(doc(db, 'households', householdId, 'notifications', notifId), {
      kind: 'transaction_added',
      title: notifTitle,
      message: notifMsg,
      fromUid: actorUid,
      fromName: safeActor,
      targetCategoryId: input.categoryId,
      targetAmount: safeAmount,
      readByUids: [actorUid],
      createdAt: serverTimestamp(),
    });

    // Send backend Web Push so partner device is alerted even when locked / screen is off
    void dispatchBackendPush({
      householdId,
      senderUid: actorUid,
      title: notifTitle,
      body: notifMsg,
      tag: notifId,
      data: { url: '/', categoryId: input.categoryId, scope: input.scope },
    });

    return txId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateTransaction(
  householdId: string,
  txId: string,
  updates: Partial<
    Pick<
      Transaction,
      'title' | 'amount' | 'type' | 'scope' | 'categoryId' | 'categoryName' | 'date' | 'paidByUid' | 'paidByName' | 'notes' | 'isTaxDeductible' | 'receiptSummary'
    >
  >
): Promise<void> {
  const path = `households/${householdId}/transactions/${txId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) payload.title = clampStr(updates.title, 100);
    if (updates.amount !== undefined) payload.amount = Math.max(0.01, Number(updates.amount) || 0.01);
    if (updates.type !== undefined) payload.type = updates.type;
    if (updates.scope !== undefined) payload.scope = updates.scope;
    if (updates.categoryId !== undefined) payload.categoryId = updates.categoryId;
    if (updates.categoryName !== undefined) payload.categoryName = clampStr(updates.categoryName, 50);
    if (updates.date !== undefined) payload.date = updates.date;
    if (updates.paidByUid !== undefined) payload.paidByUid = updates.paidByUid;
    if (updates.paidByName !== undefined) payload.paidByName = clampStr(updates.paidByName, 60);
    if (updates.notes !== undefined) payload.notes = clampStr(updates.notes, 400);
    if (updates.isTaxDeductible !== undefined) payload.isTaxDeductible = updates.isTaxDeductible;
    if (updates.receiptSummary !== undefined) payload.receiptSummary = clampStr(updates.receiptSummary, 300);

    await updateDoc(doc(db, 'households', householdId, 'transactions', txId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteTransaction(householdId: string, txId: string): Promise<void> {
  const path = `households/${householdId}/transactions/${txId}`;
  try {
    await deleteDoc(doc(db, 'households', householdId, 'transactions', txId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createRecurringObligation(
  householdId: string,
  actorUid: string,
  input: {
    title: string;
    amount: number;
    frequency: RecurringFrequency;
    type: 'expense' | 'savings' | 'fd';
    scope: TransactionScope;
    categoryId: string;
    categoryName: string;
    nextDueDate: string;
    ownerUid: string;
    ownerName: string;
    isTaxDeductible: boolean;
    notes: string;
  }
): Promise<string> {
  const recId = generateId('rec');
  const path = `households/${householdId}/recurring/${recId}`;
  try {
    await setDoc(doc(db, 'households', householdId, 'recurring', recId), {
      title: clampStr(input.title, 100) || 'Recurring Payment',
      amount: Math.max(0.01, Number(input.amount) || 0.01),
      frequency: input.frequency,
      type: input.type,
      scope: input.scope,
      categoryId: input.categoryId,
      categoryName: clampStr(input.categoryName, 50) || 'Recurring',
      nextDueDate: input.nextDueDate,
      ownerUid: input.ownerUid,
      ownerName: clampStr(input.ownerName, 60) || 'Partner',
      isTaxDeductible: Boolean(input.isTaxDeductible),
      isActive: true,
      notes: clampStr(input.notes, 300),
      createdByUid: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return recId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateRecurringObligation(
  householdId: string,
  recId: string,
  updates: Partial<
    Pick<
      RecurringObligation,
      'title' | 'amount' | 'frequency' | 'type' | 'scope' | 'categoryId' | 'categoryName' | 'nextDueDate' | 'ownerUid' | 'ownerName' | 'isTaxDeductible' | 'isActive' | 'notes'
    >
  >
): Promise<void> {
  const path = `households/${householdId}/recurring/${recId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) payload.title = clampStr(updates.title, 100);
    if (updates.amount !== undefined) payload.amount = Math.max(0.01, Number(updates.amount) || 0.01);
    if (updates.frequency !== undefined) payload.frequency = updates.frequency;
    if (updates.type !== undefined) payload.type = updates.type;
    if (updates.scope !== undefined) payload.scope = updates.scope;
    if (updates.categoryId !== undefined) payload.categoryId = updates.categoryId;
    if (updates.categoryName !== undefined) payload.categoryName = clampStr(updates.categoryName, 50);
    if (updates.nextDueDate !== undefined) payload.nextDueDate = updates.nextDueDate;
    if (updates.ownerUid !== undefined) payload.ownerUid = updates.ownerUid;
    if (updates.ownerName !== undefined) payload.ownerName = clampStr(updates.ownerName, 60);
    if (updates.isTaxDeductible !== undefined) payload.isTaxDeductible = updates.isTaxDeductible;
    if (updates.isActive !== undefined) payload.isActive = updates.isActive;
    if (updates.notes !== undefined) payload.notes = clampStr(updates.notes, 300);

    await updateDoc(doc(db, 'households', householdId, 'recurring', recId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteRecurringObligation(householdId: string, recId: string): Promise<void> {
  const path = `households/${householdId}/recurring/${recId}`;
  try {
    await deleteDoc(doc(db, 'households', householdId, 'recurring', recId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function markRecurringPaid(
  householdId: string,
  actorUid: string,
  actorName: string,
  currency: CurrencyCode,
  rec: RecurringObligation,
  paidDate: string
): Promise<void> {
  await createTransaction(householdId, actorUid, actorName, currency, {
    title: rec.title,
    amount: rec.amount,
    type: rec.type,
    scope: rec.scope,
    categoryId: rec.categoryId,
    categoryName: rec.categoryName,
    date: paidDate,
    paidByUid: rec.ownerUid,
    paidByName: rec.ownerName,
    notes: rec.notes ? `Scheduled ${rec.frequency}: ${rec.notes}` : `Scheduled ${rec.frequency} obligation`,
    isTaxDeductible: rec.isTaxDeductible,
    recurringId: rec.id,
  });

  const nextDue = addFrequency(rec.nextDueDate, rec.frequency);
  await updateRecurringObligation(householdId, rec.id, { nextDueDate: nextDue });
}

export async function sendPartnerNudge(
  householdId: string,
  fromUid: string,
  fromName: string,
  categoryId: string,
  categoryName: string,
  suggestedAmount: number,
  customMessage: string
): Promise<void> {
  const notifId = generateId('notif');
  const path = `households/${householdId}/notifications/${notifId}`;
  try {
    const nudgeTitle = `Contribution Nudge · ${clampStr(categoryName, 45)}`;
    const nudgeMsg = clampStr(customMessage, 300) || `Please review your share for ${categoryName}.`;
    await setDoc(doc(db, 'households', householdId, 'notifications', notifId), {
      kind: 'nudge',
      title: nudgeTitle,
      message: nudgeMsg,
      fromUid,
      fromName: clampStr(fromName, 60) || 'Partner',
      targetCategoryId: categoryId,
      targetAmount: Math.max(0, Number(suggestedAmount) || 0),
      readByUids: [fromUid],
      createdAt: serverTimestamp(),
    });

    // Send backend Web Push to wake up partner phone
    void dispatchBackendPush({
      householdId,
      senderUid: fromUid,
      title: nudgeTitle,
      body: nudgeMsg,
      tag: notifId,
      data: { url: '/', categoryId },
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function markNotificationsRead(
  householdId: string,
  uid: string,
  notifications: HouseholdNotification[]
): Promise<void> {
  const unread = notifications.filter((n) => !n.readByUids.includes(uid));
  if (unread.length === 0) return;

  try {
    const batch = writeBatch(db);
    for (const n of unread.slice(0, 20)) {
      const nextRead = Array.from(new Set([...n.readByUids, uid])).slice(0, 10);
      batch.update(doc(db, 'households', householdId, 'notifications', n.id), {
        readByUids: nextRead,
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `households/${householdId}/notifications`);
  }
}

export async function clearAllNotifications(
  householdId: string,
  notifications: HouseholdNotification[]
): Promise<void> {
  if (notifications.length === 0) return;
  const path = `households/${householdId}/notifications`;
  try {
    const batch = writeBatch(db);
    for (const n of notifications.slice(0, 400)) {
      batch.delete(doc(db, 'households', householdId, 'notifications', n.id));
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function restoreHouseholdBackup(
  householdId: string,
  actorUid: string,
  actorName: string,
  members: HouseholdMember[],
  existingCategories: Category[],
  existingTransactions: Transaction[],
  existingRecurring: RecurringObligation[],
  backup: GenericFinanceBackup,
  mode: 'merge' | 'replace'
): Promise<{ categoriesAdded: number; transactionsAdded: number; recurringAdded: number }> {
  type BatchOp = (batch: ReturnType<typeof writeBatch>) => void;
  const commitOps = async (ops: BatchOp[], pathLabel: string) => {
    const CHUNK = 350;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK)) {
        op(batch);
      }
      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, pathLabel);
      }
    }
  };

  // Step 1: In replace mode, remove existing transactions, recurring rules, and categories first
  if (mode === 'replace') {
    const deleteOps: BatchOp[] = [];
    for (const tx of existingTransactions) {
      deleteOps.push((b) => b.delete(doc(db, 'households', householdId, 'transactions', tx.id)));
    }
    for (const rec of existingRecurring) {
      deleteOps.push((b) => b.delete(doc(db, 'households', householdId, 'recurring', rec.id)));
    }
    for (const cat of existingCategories) {
      deleteOps.push((b) => b.delete(doc(db, 'households', householdId, 'categories', cat.id)));
    }
    if (deleteOps.length > 0) {
      await commitOps(deleteOps, `households/${householdId}`);
    }
  }

  // Step 2: Build category mapping (old ID / lowercase name -> resolved Firestore category)
  const resolvedByOldId = new Map<string, { id: string; name: string }>();
  const resolvedByName = new Map<string, { id: string; name: string }>();

  if (mode === 'merge') {
    for (const cat of existingCategories) {
      const entry = { id: cat.id, name: cat.name };
      resolvedByOldId.set(cat.id, entry);
      resolvedByName.set(cat.name.toLowerCase(), entry);
    }
  }

  const createCatOps: BatchOp[] = [];
  let categoriesAdded = 0;

  const ensureCategory = (
    raw: Partial<GenericFinanceBackup['categories'][number]> & { name: string }
  ): { id: string; name: string } => {
    const safeName = clampStr(raw.name, 50) || 'General';
    const key = safeName.toLowerCase();
    const existing = resolvedByName.get(key);
    if (existing) {
      if (raw.id) resolvedByOldId.set(raw.id, existing);
      return existing;
    }

    const newCatId = generateId('cat');
    const created = { id: newCatId, name: safeName };
    resolvedByName.set(key, created);
    if (raw.id) resolvedByOldId.set(raw.id, created);
    categoriesAdded++;

    createCatOps.push((b) =>
      b.set(doc(db, 'households', householdId, 'categories', newCatId), {
        name: safeName,
        kind: raw.kind || 'expense',
        color:
          raw.color && /^#[0-9a-fA-F]{3,8}$/.test(raw.color) ? raw.color : '#0D9488',
        icon: clampStr(raw.icon, 32) || 'tag',
        budgetLimit: Math.max(0, Math.min(1e9, Number(raw.budgetLimit) || 0)),
        splitRatio: Math.min(100, Math.max(0, Number(raw.splitRatio) || 50)),
        isTaxDeductibleDefault: Boolean(raw.isTaxDeductibleDefault),
        createdByUid: actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return created;
  };

  for (const cat of backup.categories) {
    ensureCategory(cat);
  }

  const resolveCategoryForItem = (catId?: string, catName?: string) => {
    if (catId && resolvedByOldId.has(catId)) {
      return resolvedByOldId.get(catId)!;
    }
    const nameKey = (catName || '').trim().toLowerCase();
    if (nameKey && resolvedByName.has(nameKey)) {
      return resolvedByName.get(nameKey)!;
    }
    return ensureCategory({ name: catName || 'General', kind: 'expense' });
  };

  const resolveMemberUid = (personName: string): { uid: string; name: string } => {
    const cleanName = clampStr(personName, 60) || actorName || 'Partner';
    const match = members.find(
      (m) => m.displayName.trim().toLowerCase() === cleanName.toLowerCase()
    );
    return {
      uid: match?.uid || actorUid,
      name: cleanName,
    };
  };

  const txOps: BatchOp[] = [];
  for (const tx of backup.transactions) {
    const resolvedCat = resolveCategoryForItem(tx.categoryId, tx.categoryName);
    const payer = resolveMemberUid(tx.paidByName);
    const txId = generateId('tx');
    const safeAmount = Math.max(0.01, Math.min(1e9, Number(tx.amount) || 1));

    txOps.push((b) => {
      const payload: Record<string, unknown> = {
        title: clampStr(tx.title, 100) || 'Imported Entry',
        amount: safeAmount,
        type: tx.type,
        scope: tx.scope,
        categoryId: resolvedCat.id,
        categoryName: resolvedCat.name,
        date: /^\d{4}-\d{2}-\d{2}$/.test(tx.date) ? tx.date : new Date().toISOString().slice(0, 10),
        paidByUid: payer.uid,
        paidByName: payer.name,
        notes: clampStr(tx.notes, 400),
        isTaxDeductible: Boolean(tx.isTaxDeductible),
        createdByUid: actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (tx.receiptSummary) {
        payload.receiptSummary = clampStr(tx.receiptSummary, 300);
      }
      b.set(doc(db, 'households', householdId, 'transactions', txId), payload);
    });
  }

  const recOps: BatchOp[] = [];
  for (const rec of backup.recurring) {
    const resolvedCat = resolveCategoryForItem(rec.categoryId, rec.categoryName);
    const owner = resolveMemberUid(rec.ownerName);
    const recId = generateId('rec');
    const safeAmount = Math.max(0.01, Math.min(1e9, Number(rec.amount) || 1));

    recOps.push((b) =>
      b.set(doc(db, 'households', householdId, 'recurring', recId), {
        title: clampStr(rec.title, 100) || 'Recurring Payment',
        amount: safeAmount,
        frequency: rec.frequency,
        type: rec.type,
        scope: rec.scope,
        categoryId: resolvedCat.id,
        categoryName: resolvedCat.name,
        nextDueDate: /^\d{4}-\d{2}-\d{2}$/.test(rec.nextDueDate)
          ? rec.nextDueDate
          : new Date().toISOString().slice(0, 10),
        ownerUid: owner.uid,
        ownerName: owner.name,
        isTaxDeductible: Boolean(rec.isTaxDeductible),
        isActive: rec.isActive !== false,
        notes: clampStr(rec.notes, 300),
        createdByUid: actorUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  // Commit categories before transactions/recurring so everything resolves cleanly
  if (createCatOps.length > 0) {
    await commitOps(createCatOps, `households/${householdId}/categories`);
  }
  if (txOps.length > 0) {
    await commitOps(txOps, `households/${householdId}/transactions`);
  }
  if (recOps.length > 0) {
    await commitOps(recOps, `households/${householdId}/recurring`);
  }

  if (mode === 'replace' && backup.household) {
    await updateHouseholdSettings(householdId, {
      ...(backup.household.currency ? { currency: backup.household.currency } : {}),
      ...(backup.household.name ? { name: backup.household.name } : {}),
      ...(typeof backup.household.bankBalance === 'number' && Number.isFinite(backup.household.bankBalance)
        ? { bankBalance: backup.household.bankBalance }
        : {}),
    });
  }

  return {
    categoriesAdded,
    transactionsAdded: txOps.length,
    recurringAdded: recOps.length,
  };
}

