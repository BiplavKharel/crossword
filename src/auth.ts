export interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  /** Google ID token. A backend must verify this; the client only decodes it. */
  credential?: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

export const CLIENT_ID = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID as string | undefined;
const KEY = 'crossword.user';
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** Ask the server to verify a Google credential. Throws if it's rejected. */
export async function verifyCredential(credential: string): Promise<User> {
  const res = await fetch(`${API}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Google token rejected by server' : 'Server error');
  const { user } = await res.json();
  return { ...user, credential };
}

/** Re-verify a stored session. Only an explicit rejection counts as invalid; a down server doesn't sign you out. */
export async function sessionStillValid(u: User): Promise<boolean> {
  if (!u.credential) return true; // guest (dev only)
  try {
    const res = await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${u.credential}` } });
    return res.status !== 401;
  } catch {
    return true;
  }
}

export const guestUser = (): User => ({ id: 'guest', name: 'Guest', email: '', credential: 'guest', exp: Number.MAX_SAFE_INTEGER });

export function loadUser(): User | null {
  try {
    const u: User | null = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return u && u.exp * 1000 > Date.now() ? u : null;
  } catch {
    return null;
  }
}

export function saveUser(u: User | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable; the session just won't persist */
  }
}

let gsi: Promise<void> | undefined;
export function loadGsi(): Promise<void> {
  gsi ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsi = undefined; reject(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return gsi;
}
