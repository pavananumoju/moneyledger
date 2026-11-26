// MoneyLedger Web Push Service Worker Extension
self.addEventListener('push', (event) => {
  let payload = {
    title: 'MoneyLedger',
    body: 'New partner finance activity',
    tag: '',
    data: {},
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        ...payload,
        ...parsed,
      };
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  const uniqueTag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim()
      : `ml-push-${Date.now()}`;

  const options = {
    body: payload.body || 'New partner finance activity',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: {
      url: '/',
      ...(payload.data || {}),
    },
    vibrate: [150, 75, 150],
    tag: uniqueTag,
    renotify: true,
    timestamp: Date.now(),
  };

  event.waitUntil(
    Promise.allSettled([
      self.registration.showNotification(payload.title || 'MoneyLedger', options),
      self.navigator && typeof self.navigator.setAppBadge === 'function'
        ? self.navigator.setAppBadge()
        : Promise.resolve(),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = typeof notifData.url === 'string' && notifData.url.startsWith('/') ? notifData.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && 'focus' in client) {
          try {
            client.postMessage({
              type: 'MONEYLEDGER_NOTIFICATION_CLICK',
              data: notifData,
            });
          } catch {
            // Ignore messaging failures
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Renew subscription automatically if Apple APNs or Android FCM rotates keys in background
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/push/public-key');
        if (!res.ok) return;
        const { publicKey } = await res.json();
        if (!publicKey) return;

        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: outputArray,
        });

        // Notify any open client windows so they sync the rotated endpoint to Firestore
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
          client.postMessage({
            type: 'MONEYLEDGER_PUSH_SUBSCRIPTION_ROTATED',
            subscription: newSub.toJSON ? newSub.toJSON() : null,
          });
        }
      } catch {
        // Client will re-sync on next open
      }
    })()
  );
});
