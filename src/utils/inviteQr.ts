const PENDING_INVITE_STORAGE_KEY = 'moneyledger_pending_invite';

export function normalizeInviteCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z0-9]{6,12}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export function buildInviteUrl(inviteCode: string): string {
  const code = normalizeInviteCode(inviteCode) || inviteCode.trim().toUpperCase();
  if (typeof window === 'undefined') {
    return `/?join=${encodeURIComponent(code)}`;
  }
  return `${window.location.origin}/?join=${encodeURIComponent(code)}`;
}

export function extractInviteCodeFromScan(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Direct invite code (e.g. ML7K4P9M)
  const direct = normalizeInviteCode(trimmed);
  if (direct && !trimmed.includes('://') && !trimmed.includes('{')) {
    return direct;
  }

  // 2. URL with ?join= or ?code= or #join= or /join/CODE
  try {
    const parsed = new URL(trimmed);
    const paramCode =
      parsed.searchParams.get('join') ||
      parsed.searchParams.get('code') ||
      parsed.searchParams.get('invite');
    if (paramCode) {
      const normalized = normalizeInviteCode(paramCode);
      if (normalized) return normalized;
    }

    if (parsed.hash) {
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const hashCode = hashParams.get('join') || hashParams.get('code');
      if (hashCode) {
        const normalized = normalizeInviteCode(hashCode);
        if (normalized) return normalized;
      }
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart) {
      const normalized = normalizeInviteCode(lastPart);
      if (normalized) return normalized;
    }
  } catch {
    // Not a standard URL; continue checking other formats
  }

  // 3. JSON payload (e.g. {"inviteCode":"ML7K4P9M"})
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate = obj.inviteCode ?? obj.code ?? obj.join;
      if (typeof candidate === 'string') {
        const normalized = normalizeInviteCode(candidate);
        if (normalized) return normalized;
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // 4. Text snippet containing MoneyLedger code pattern (e.g. MLXXXXXX)
  const codeMatch = trimmed.toUpperCase().match(/\b(ML[A-Z0-9]{4,10})\b/);
  if (codeMatch?.[1]) {
    return normalizeInviteCode(codeMatch[1]);
  }

  return null;
}

export function capturePendingInviteFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const joinParam =
      url.searchParams.get('join') ||
      url.searchParams.get('code') ||
      url.searchParams.get('invite') ||
      '';
    const normalized = joinParam ? normalizeInviteCode(joinParam) : null;

    if (normalized) {
      sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, normalized);
      url.searchParams.delete('join');
      url.searchParams.delete('code');
      url.searchParams.delete('invite');
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', nextUrl || '/');
      return normalized;
    }

    return sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function clearPendingInvite(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
