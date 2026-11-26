import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { PushSubscription } from 'web-push';

const require = createRequire(import.meta.url);
const webPush = require('web-push');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Load Firebase projectId for ID token verification
let FIREBASE_PROJECT_ID = 'gcp-nestledger';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsedCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
    if (parsedCfg.projectId) {
      FIREBASE_PROJECT_ID = parsedCfg.projectId;
    }
  }
} catch {
  // Keep default projectId
}

// Configure VAPID keys from environment secrets (never hardcode private keys in source)
let VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
let VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
let isEphemeralVapid = false;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const generated = webPush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = generated.publicKey;
  VAPID_PRIVATE_KEY = generated.privateKey;
  isEphemeralVapid = true;
  console.warn(
    '[MoneyLedger Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in environment. Using ephemeral in-memory VAPID keys — set both in Secrets for persistent lock-screen delivery across server restarts.'
  );
}

webPush.setVapidDetails(
  'mailto:support@moneyledger.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// High-priority push options so iOS APNs (apns-priority: 10) and Android FCM (Doze bypass) wake locked screens immediately
const HIGH_PRIORITY_PUSH_OPTIONS = {
  TTL: 86400,
  urgency: 'high' as const,
};

// --- Firebase Auth ID Token Verification (using Google's public X.509 certificates) ---
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(GOOGLE_CERTS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase auth certificates (${resp.status})`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await resp.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + Math.max(300, maxAgeSec) * 1000;
  return cachedCerts;
}

function decodeBase64Url(str: string): Buffer {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email?: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(decodeBase64Url(parts[0]).toString('utf-8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf-8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
    };

    if (header.alg !== 'RS256' || !header.kid) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

    const certs = await getFirebasePublicCerts();
    const cert = certs[header.kid];
    if (!cert) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();

    const sigBuf = decodeBase64Url(parts[2]);
    if (!verifier.verify(cert, sigBuf)) return null;

    return { uid: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

interface AuthedRequest extends express.Request {
  authUid?: string;
}

async function requireFirebaseAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7).trim();
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
  req.authUid = decoded.uid;
  next();
}

// --- Push Endpoint Host Allowlist ---
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.webpush.microsoft.com',
];

const ALLOWED_PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'jmt17.google.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

function isAllowedPushEndpoint(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length < 16 || rawUrl.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
      return false;
    }
    if (ALLOWED_PUSH_EXACT_HOSTS.has(host)) return true;
    return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

function isValidPushSubscription(sub: unknown): sub is PushSubscription {
  if (!sub || typeof sub !== 'object') return false;
  const candidate = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(candidate.endpoint)) return false;
  if (
    !candidate.keys ||
    typeof candidate.keys.p256dh !== 'string' ||
    candidate.keys.p256dh.length < 20 ||
    candidate.keys.p256dh.length > 256 ||
    typeof candidate.keys.auth !== 'string' ||
    candidate.keys.auth.length < 10 ||
    candidate.keys.auth.length > 128
  ) {
    return false;
  }
  return true;
}

interface StoredSubscription {
  id: string;
  householdId: string;
  uid: string;
  subscription: PushSubscription;
  updatedAt: string;
}

const SUBSCRIPTIONS_FILE = path.resolve(__dirname, 'data', 'subscriptions.json');

function ensureDataDir() {
  const dir = path.dirname(SUBSCRIPTIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSubscriptions(): StoredSubscription[] {
  try {
    ensureDataDir();
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const content = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // fallback
  }
  return [];
}

function saveSubscriptions(subs: StoredSubscription[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MoneyLedger Push] Failed saving local cache:', err);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'moneyledger-api' });
  });

  // VAPID Public Key endpoint (public key is safe to expose to authenticated/unauthenticated PWA clients)
  app.get('/api/push/public-key', (_req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY, isEphemeralVapid });
  });

  // Push diagnostics status for Settings panel
  app.get('/api/push/status', requireFirebaseAuth, (req: AuthedRequest, res) => {
    const householdId = typeof req.query.householdId === 'string' ? req.query.householdId.trim() : '';
    const subs = loadSubscriptions();
    const householdCount = householdId
      ? subs.filter((s) => s.householdId === householdId).length
      : 0;
    res.json({
      ok: true,
      serverCachedCount: householdCount,
      isEphemeralVapid,
    });
  });

  // Register or update a device Web Push subscription in warm server cache
  app.post('/api/push/subscribe', requireFirebaseAuth, (req: AuthedRequest, res) => {
    const { householdId, subscription } = req.body as {
      householdId?: string;
      subscription?: unknown;
    };

    if (
      !householdId ||
      typeof householdId !== 'string' ||
      householdId.length > 128 ||
      !isValidPushSubscription(subscription)
    ) {
      return res.status(400).json({ error: 'Invalid or missing subscription details' });
    }

    const uid = req.authUid!;
    const subs = loadSubscriptions();
    const endpoint = subscription.endpoint;
    const existingIdx = subs.findIndex((s) => s.subscription.endpoint === endpoint);

    const record: StoredSubscription = {
      id: `${uid}_${Date.now()}`,
      householdId,
      uid,
      subscription,
      updatedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      subs[existingIdx] = record;
    } else {
      subs.push(record);
    }

    saveSubscriptions(subs);
    const householdCount = subs.filter((s) => s.householdId === householdId).length;
    res.json({ ok: true, count: householdCount, isEphemeralVapid });
  });

  // Direct test push to the current device subscription (supports delay so user can lock screen)
  app.post('/api/push/test', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const { subscription, delaySeconds } = req.body as {
      subscription?: unknown;
      delaySeconds?: number;
    };

    if (!isValidPushSubscription(subscription)) {
      return res.status(400).json({ error: 'Invalid push subscription details' });
    }

    const payload = JSON.stringify({
      title: 'MoneyLedger Alert',
      body: 'Lock-screen push is working! Your phone will wake when partner entries or nudges arrive.',
      tag: `ml-test-${Date.now()}`,
      data: { url: '/' },
    });

    const delay = Math.max(0, Math.min(10, Number(delaySeconds) || 0)) * 1000;
    if (delay > 0) {
      setTimeout(async () => {
        try {
          await webPush.sendNotification(subscription, payload, HIGH_PRIORITY_PUSH_OPTIONS);
        } catch (err: unknown) {
          const pushErr = err as { statusCode?: number; body?: string; message?: string };
          console.warn(
            '[MoneyLedger Push] Delayed test push failed:',
            pushErr.statusCode || '',
            pushErr.body || pushErr.message || err
          );
        }
      }, delay);
      return res.json({ ok: true, scheduledInSeconds: delay / 1000 });
    }

    try {
      await webPush.sendNotification(subscription, payload, HIGH_PRIORITY_PUSH_OPTIONS);
      return res.json({ ok: true });
    } catch (err: unknown) {
      const pushErr = err as { statusCode?: number; body?: string; message?: string };
      console.warn(
        '[MoneyLedger Push] Immediate test push failed:',
        pushErr.statusCode || '',
        pushErr.body || pushErr.message || err
      );
      return res.status(500).json({ error: pushErr.message || 'Push delivery failed' });
    }
  });

  // Trigger real-time high-priority Web Push to partner/other devices (merges Firestore-persisted subscriptions + local cache)
  app.post('/api/push/notify', requireFirebaseAuth, async (req: AuthedRequest, res) => {
    const {
      householdId,
      senderEndpoint,
      title,
      body,
      tag,
      data,
      subscriptions: clientSubscriptions,
    } = req.body as {
      householdId?: string;
      senderEndpoint?: string | null;
      title?: string;
      body?: string;
      tag?: string;
      data?: Record<string, unknown>;
      subscriptions?: Array<{ uid?: string; subscription?: unknown }>;
    };

    if (!householdId || typeof householdId !== 'string' || !title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Missing notification payload' });
    }

    const senderUid = req.authUid!;
    const localSubs = loadSubscriptions();

    // Merge local warm cache + Firestore-backed subscriptions sent by the client (deduplicated by endpoint)
    const mergedByEndpoint = new Map<string, { uid: string; subscription: PushSubscription }>();

    for (const s of localSubs) {
      if (s.householdId === householdId && isValidPushSubscription(s.subscription)) {
        mergedByEndpoint.set(s.subscription.endpoint, {
          uid: s.uid,
          subscription: s.subscription,
        });
      }
    }

    if (Array.isArray(clientSubscriptions)) {
      for (const entry of clientSubscriptions.slice(0, 25)) {
        if (entry && isValidPushSubscription(entry.subscription)) {
          mergedByEndpoint.set(entry.subscription.endpoint, {
            uid: typeof entry.uid === 'string' ? entry.uid : '',
            subscription: entry.subscription,
          });
        }
      }
    }

    const allHouseholdTargets = Array.from(mergedByEndpoint.values());
    const hasOtherMembers = allHouseholdTargets.some((t) => t.uid && t.uid !== senderUid);

    const targets = allHouseholdTargets
      .filter((t) => {
        // Exclude only the exact sending device so users with two phones on the same account still receive alerts
        if (senderEndpoint && t.subscription.endpoint === senderEndpoint) {
          return false;
        }
        if (!senderEndpoint && hasOtherMembers && t.uid === senderUid) {
          return false;
        }
        return true;
      })
      .slice(0, 20);

    if (targets.length === 0) {
      return res.json({
        sent: 0,
        failed: 0,
        totalTargets: 0,
        deadEndpoints: [],
        reason: 'No other subscribed devices found for this household',
      });
    }

    const safeTitle = title.trim().slice(0, 120);
    const safeBody = (typeof body === 'string' ? body.trim() : 'New partner finance activity').slice(0, 320);
    const safeTag =
      typeof tag === 'string' && tag.trim()
        ? tag.trim().slice(0, 80)
        : `ml-alert-${Date.now()}`;

    const payload = JSON.stringify({
      title: safeTitle,
      body: safeBody,
      data: data && typeof data === 'object' ? data : { url: '/' },
      tag: safeTag,
    });

    const deadEndpoints = new Set<string>();
    let sentCount = 0;
    let failedCount = 0;

    const sends = targets.map(async (target) => {
      try {
        await webPush.sendNotification(target.subscription, payload, HIGH_PRIORITY_PUSH_OPTIONS);
        sentCount++;
      } catch (err: unknown) {
        failedCount++;
        const pushErr = err as { statusCode?: number; body?: string; message?: string };
        const statusCode = pushErr?.statusCode;
        console.warn(
          `[MoneyLedger Push] Delivery failed (${statusCode || 'err'}) for endpoint ${target.subscription.endpoint.slice(0, 48)}...:`,
          pushErr?.body || pushErr?.message || err
        );
        // 404/410 = expired/uninstalled subscription; 403/401 with VAPID mismatch also invalidates old subscription
        if (statusCode === 410 || statusCode === 404) {
          deadEndpoints.add(target.subscription.endpoint);
        }
      }
    });

    await Promise.allSettled(sends);

    if (deadEndpoints.size > 0) {
      const cleaned = localSubs.filter((s) => !deadEndpoints.has(s.subscription.endpoint));
      saveSubscriptions(cleaned);
    }

    res.json({
      sent: sentCount,
      failed: failedCount,
      totalTargets: targets.length,
      deadEndpoints: Array.from(deadEndpoints),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MoneyLedger server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MoneyLedger server:', err);
  process.exit(1);
});
