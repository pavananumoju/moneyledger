import { useCallback, useEffect, useState } from 'react';
import {
  getFirebaseAuthHeaders,
  saveHouseholdPushSubscription,
  setActiveClientPushEndpoint,
} from '../services/householdService';

interface PushNotificationOptions {
  tag?: string;
  vibrate?: number[];
  data?: Record<string, unknown>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function detectDeviceLabel(isIOS: boolean, isStandalone: boolean): string {
  if (typeof navigator === 'undefined') return 'Web Device';
  const ua = navigator.userAgent;
  if (isIOS) {
    return isStandalone ? 'iPhone / iPad (Home Screen App)' : 'iPhone / iPad (Safari)';
  }
  if (/android/i.test(ua)) {
    return isStandalone ? 'Android (Installed App)' : 'Android (Browser)';
  }
  if (/macintosh|mac os x/i.test(ua)) return 'Mac Desktop';
  if (/windows/i.test(ua)) return 'Windows Desktop';
  return 'Desktop Browser';
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'denied';
  });

  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isEphemeralVapid, setIsEphemeralVapid] = useState(false);
  const [firestoreSyncOk, setFirestoreSyncOk] = useState<boolean | null>(null);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    ('PushManager' in window ||
      (typeof ServiceWorkerRegistration !== 'undefined' &&
        'pushManager' in ServiceWorkerRegistration.prototype));

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Check if push subscription is already active on this device and set active endpoint
  useEffect(() => {
    if (!pushSupported) return;
    let mounted = true;

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (mounted) {
          setIsPushSubscribed(Boolean(sub));
          const ep = sub?.endpoint || null;
          setPushEndpoint(ep);
          setActiveClientPushEndpoint(ep);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [pushSupported]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return 'denied';
    }
  }, []);

  const subscribeToWebPush = useCallback(
    async (
      householdId: string,
      uid: string,
      options?: { forceRefresh?: boolean }
    ): Promise<{ ok: boolean; reason?: string; firestoreSynced?: boolean }> => {
      if (!pushSupported) {
        if (isIOS && !isStandalone) {
          return {
            ok: false,
            reason: 'ios_install_required',
          };
        }
        return { ok: false, reason: 'unsupported' };
      }

      setIsSubscribing(true);
      try {
        let currentPerm = Notification.permission;
        if (currentPerm !== 'granted') {
          currentPerm = await Notification.requestPermission();
          setPermission(currentPerm);
        }

        if (currentPerm !== 'granted') {
          return { ok: false, reason: 'permission_denied' };
        }

        // Fetch server VAPID public key
        const keyRes = await fetch('/api/push/public-key');
        if (!keyRes.ok) {
          throw new Error('Failed to retrieve push server key');
        }
        const { publicKey, isEphemeralVapid: ephemeral } = (await keyRes.json()) as {
          publicKey?: string;
          isEphemeralVapid?: boolean;
        };
        setIsEphemeralVapid(Boolean(ephemeral));

        if (!publicKey) {
          throw new Error('Push public key not configured');
        }

        const expectedKeyBytes = urlBase64ToUint8Array(publicKey);
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();

        // Detect VAPID key mismatch or explicit forceRefresh and cleanly re-subscribe
        if (sub) {
          const existingKeyBuf = sub.options?.applicationServerKey;
          const keyMatches =
            existingKeyBuf instanceof ArrayBuffer
              ? uint8ArraysEqual(new Uint8Array(existingKeyBuf), expectedKeyBytes)
              : false;

          if (options?.forceRefresh || !keyMatches) {
            try {
              await sub.unsubscribe();
            } catch {
              // Proceed to re-subscribe
            }
            sub = null;
          }
        }

        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKeyBytes,
          });
        }

        setPushEndpoint(sub.endpoint);
        setActiveClientPushEndpoint(sub.endpoint);

        const subPayload = sub.toJSON ? sub.toJSON() : (sub as unknown as PushSubscriptionJSON);
        const deviceLabel = detectDeviceLabel(isIOS, isStandalone);

        // 1. Persist subscription to Firestore so partner devices always receive lock-screen push even after Cloud Run restarts
        const firestoreResult = await saveHouseholdPushSubscription(
          householdId,
          uid,
          subPayload,
          deviceLabel
        );
        setFirestoreSyncOk(firestoreResult.ok);

        // 2. Also register in the backend warm cache with authenticated Firebase ID token
        const headers = await getFirebaseAuthHeaders();
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            householdId,
            uid,
            subscription: subPayload,
          }),
        });

        if (!res.ok && !firestoreResult.ok) {
          throw new Error('Failed to save push subscription on server');
        }

        setIsPushSubscribed(true);
        return { ok: true, firestoreSynced: firestoreResult.ok };
      } catch (err) {
        console.warn('Web push subscription failed:', err);
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'subscription_failed',
        };
      } finally {
        setIsSubscribing(false);
      }
    },
    [pushSupported, isIOS, isStandalone]
  );

  const reRegisterWebPush = useCallback(
    (householdId: string, uid: string) =>
      subscribeToWebPush(householdId, uid, { forceRefresh: true }),
    [subscribeToWebPush]
  );

  const sendTestPush = useCallback(
    async (delaySeconds: number = 0): Promise<{ ok: boolean; reason?: string }> => {
      if (!pushSupported) {
        return { ok: false, reason: 'unsupported' };
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          return { ok: false, reason: 'not_subscribed' };
        }
        const headers = await getFirebaseAuthHeaders();
        const res = await fetch('/api/push/test', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            subscription: sub.toJSON ? sub.toJSON() : sub,
            delaySeconds,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Test push failed');
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'test_failed',
        };
      }
    },
    [pushSupported]
  );

  const syncAppBadge = useCallback(async (unreadCount: number) => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (unreadCount > 0 && typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(unreadCount);
      } else if (unreadCount <= 0 && typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge();
      }
    } catch {
      // App Badging API is optional across browsers
    }
  }, []);

  const showNotification = useCallback(
    async (title: string, body: string, options?: PushNotificationOptions) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      const payload: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: options?.tag || `ml-local-${Date.now()}`,
        renotify: true,
        vibrate: options?.vibrate || [100, 50, 100],
        data: options?.data,
      };

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.showNotification(title, payload);
            return;
          }
        }
        new Notification(title, {
          body,
          icon: '/pwa-192x192.png',
          tag: payload.tag,
        });
      } catch {
        // Ignore browser notification suppression
      }
    },
    []
  );

  return {
    supported: typeof window !== 'undefined' && 'Notification' in window,
    pushSupported,
    isIOS,
    isStandalone,
    isPushSubscribed,
    isSubscribing,
    isEphemeralVapid,
    firestoreSyncOk,
    pushEndpoint,
    permission,
    requestPermission,
    subscribeToWebPush,
    reRegisterWebPush,
    sendTestPush,
    showNotification,
    syncAppBadge,
  };
}
