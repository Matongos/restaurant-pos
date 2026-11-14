/**
 * Small client for the restaurant's online account (Supabase): sign-up / sign-in and database calls.
 * Plain fetch, no extra library. The address can be overridden for tests with
 * localStorage 'restaurant-pos.cloud-url' (only on localhost).
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../cloudConfig';

const AUTH_KEY = 'restaurant-pos.auth';

function baseUrl(): string {
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      const o = localStorage.getItem('restaurant-pos.cloud-url');
      if (o) return o.replace(/\/$/, '');
    }
  } catch {
    /* ignore */
  }
  return SUPABASE_URL;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // seconds since 1970
  userId: string;
  email: string;
}

export class CloudError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

let session: AuthSession | null = readSession();
function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}
function saveSession(s: AuthSession | null) {
  session = s;
  try {
    if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}
export const getSession = () => session;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sessionFrom(j: any): AuthSession {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
    userId: j.user?.id,
    email: j.user?.email ?? '',
  };
}

/** Turn the service's error replies into one plain sentence. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageOf(j: any, status: number): string {
  const raw: string = j?.msg || j?.error_description || j?.message || j?.error || '';
  const code: string = j?.error_code || j?.code || '';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) return 'Wrong email or password.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) return 'Please confirm your email first: open the link we emailed you.';
  if (code === 'email_exists' || /already been registered/i.test(raw)) return 'Another account already uses that email. Choose a different one.';
  if (code === 'same_password' || /should be different from the old/i.test(raw)) return 'The new password is the same as the old one.';
  if (code === 'reauthentication_needed' || /reauthentication/i.test(raw)) return 'For safety, sign out and sign in again, then change the password.';
  if (code === 'user_already_exists' || /already registered/i.test(raw)) return 'There is already an account with this email. Sign in instead.';
  if (code === 'weak_password' || /password should be/i.test(raw)) return 'Choose a longer password (at least 8 characters).';
  if (code === 'over_email_send_rate_limit' || /rate limit/i.test(raw)) return 'Too many emails sent. Please wait a few minutes and try again.';
  if (code === '23505' || /duplicate key.*slug/i.test(raw)) return 'That web address is taken. Choose another.';
  if (status === 0) return 'No connection to the online account. Check the internet and try again.';
  return raw || `Online account error (${status}).`;
}

async function call(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<unknown> {
  const headers: Record<string, string> = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
  if (init.auth !== false && session) {
    if (session.expiresAt - 60 < Date.now() / 1000) await refresh();
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  }
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new CloudError(messageOf(null, 0), 0);
  }
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  if (!res.ok) throw new CloudError(messageOf(j, res.status), res.status);
  return j;
}

let refreshing: Promise<void> | null = null;
async function refresh(): Promise<void> {
  if (!session) return;
  if (!refreshing) {
    const token = session.refreshToken;
    refreshing = (async () => {
      try {
        const j = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: JSON.stringify({ refresh_token: token }) });
        saveSession(sessionFrom(j));
      } catch (e) {
        // Only forget the sign-in when the service says it is no longer valid (not when offline).
        if (e instanceof CloudError && e.status >= 400 && e.status < 500) saveSession(null);
        throw e;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/* ------------------------------------------------------------------ accounts */

/** Returns 'confirm' when the service wants the email address confirmed before the first sign-in. */
export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm'> {
  const back = encodeURIComponent(location.origin + location.pathname);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await call(`/auth/v1/signup?redirect_to=${back}`, { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim(), password }) });
  if (j?.access_token) {
    saveSession(sessionFrom(j));
    return 'signed-in';
  }
  return 'confirm';
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const j = await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim(), password }) });
  const s = sessionFrom(j);
  saveSession(s);
  return s;
}

export async function signOut(): Promise<void> {
  try {
    if (session) await call('/auth/v1/logout', { method: 'POST' });
  } catch {
    /* signed out here either way */
  }
  saveSession(null);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const back = encodeURIComponent(location.origin + location.pathname);
  await call(`/auth/v1/recover?redirect_to=${back}`, { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim() }) });
}

/**
 * The confirmation / password-reset link brings the person back with the sign-in in the address
 * (#access_token=…). Keep it and clean the address so the app's own pages work. Returns the link type.
 */
export function takeSessionFromLink(): string | null {
  const h = location.hash;
  if (!/access_token=/.test(h) && !/error_description=/.test(h)) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error_description')) return 'error:' + p.get('error_description');
  const token = p.get('access_token')!;
  let userId = '';
  let email = '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    userId = payload.sub;
    email = payload.email ?? '';
  } catch {
    /* not a readable token */
  }
  saveSession({
    accessToken: token,
    refreshToken: p.get('refresh_token') ?? '',
    expiresAt: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
    userId,
    email,
  });
  return p.get('type') ?? 'signin';
}

export async function setNewPassword(password: string): Promise<void> {
  await call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) });
}

/** Check the current password by signing in again (also gives a fresh login, which the service wants before changes). */
async function confirmPassword(password: string): Promise<void> {
  if (!session) throw new CloudError('Sign in first.');
  try {
    await signIn(session.email, password);
  } catch (e) {
    if (e instanceof CloudError && /wrong email or password/i.test(e.message)) throw new CloudError('Your current password is not right.');
    throw e;
  }
}

/** Change the online account's password (the current one is asked for first). */
export async function changePassword(current: string, next: string): Promise<void> {
  if (next.length < 8) throw new CloudError('Choose a new password of at least 8 characters.');
  if (next === current) throw new CloudError('The new password is the same as the old one.');
  await confirmPassword(current);
  await setNewPassword(next);
}

/** Change the online account's email. 'changed' = done now; 'confirm' = the service sent a link that must be opened first. */
export async function changeEmail(newEmail: string, password: string): Promise<'changed' | 'confirm'> {
  const email = newEmail.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CloudError('Type the new email address.');
  if (session && email === session.email.toLowerCase()) throw new CloudError('That is already the email of this account.');
  await confirmPassword(password);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = (await call('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ email }) })) as any;
  if (u?.email && u.email.toLowerCase() === email) {
    if (session) saveSession({ ...session, email: u.email });
    return 'changed';
  }
  return 'confirm';
}

/* ------------------------------------------------------------------ database */

export function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }) as Promise<T>;
}

export function select<T = unknown>(table: string, query: string): Promise<T> {
  return call(`/rest/v1/${table}?${query}`, { method: 'GET' }) as Promise<T>;
}

export interface Membership {
  restaurant_id: string;
  role: 'owner' | 'manager' | 'device';
  restaurants: { name: string; slug: string; plan: string; trial_ends_at: string } | null;
}

export function myRestaurants(): Promise<Membership[]> {
  if (!session) return Promise.resolve([]);
  return select<Membership[]>('members', `select=restaurant_id,role,restaurants(name,slug,plan,trial_ends_at)&user_id=eq.${session.userId}`);
}

export function slugAvailable(slug: string): Promise<boolean> {
  return rpc<boolean>('slug_available', { p_slug: slug });
}

export function createRestaurant(name: string, slug: string, town: string, currency: string): Promise<string> {
  return rpc<string>('create_restaurant', { p_name: name, p_slug: slug, p_town: town || null, p_country: 'ZW', p_currency: currency });
}

/** A web address from a restaurant name: "Mama's Kitchen, Harare" → "mamas-kitchen-harare". */
export function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** Change rows; returns the rows that were changed (empty when the filter matched nothing). */
export function patch<T = unknown>(table: string, query: string, body: Record<string, unknown>): Promise<T[]> {
  return call(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } }) as Promise<T[]>;
}

/** Add a row without reading it back (used for website / app events, allowed without signing in). */
export function insertQuiet(table: string, body: Record<string, unknown>): Promise<unknown> {
  return call(`/rest/v1/${table}`, { method: 'POST', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } });
}

/* ------------------------------------------------------------------ branches */

export interface BranchSummary {
  id: string;
  name: string;
  slug: string;
  town: string | null;
  last_seen_at: string | null;
  is_main: boolean;
  orders_today: number;
  sales_today: number;
  orders_week: number;
  sales_week: number;
}

/** Every branch this login owns, with today's and this week's sales (worked out on the server). */
export function groupSummary(): Promise<BranchSummary[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = new Date(Date.now() - 6 * 864e5);
  week.setHours(0, 0, 0, 0);
  return rpc<BranchSummary[]>('group_summary', { p_today: today.toISOString(), p_week: week.toISOString() });
}

/** Add a branch to the group of `mainId` (the owner only; Group plan or trial; 5 at most). */
export function createBranch(mainId: string, name: string, slug: string, town: string): Promise<string> {
  return rpc<string>('create_branch', { p_main: mainId, p_name: name.trim(), p_slug: slug, p_town: town.trim() || null });
}
