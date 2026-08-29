import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Read-only access to the user's calendars, plus their email for display.
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];

export interface GoogleAccount {
  id: number;
  user_id: number | null;
  email: string | null;
  refresh_token: string;
  access_token: string | null;
  token_expiry: string | null;
}

/** A short-lived signed value tying the OAuth round-trip to an app user. */
export function signState(userId: number): string {
  return jwt.sign({ userId, kind: 'google-oauth' }, config.jwtSecret, { expiresIn: '10m' });
}

export function verifyState(state: string): number | null {
  try {
    const payload = jwt.verify(state, config.jwtSecret) as jwt.JwtPayload & { userId: number; kind: string };
    return payload.kind === 'google-oauth' ? payload.userId : null;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  if (!config.google) throw new Error('Google is not configured');
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent', // ensure a refresh token is returned on reconnect
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

function expiryIso(expiresIn: number): string {
  // Refresh a minute early to avoid edge-of-expiry failures.
  return new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
}

/**
 * Exchange an authorization code for tokens, look up the account email, and
 * store (or replace) the single shared Google connection.
 */
export async function exchangeCodeAndStore(code: string, userId: number): Promise<GoogleAccount> {
  if (!config.google) throw new Error('Google is not configured');
  const token = await postToken({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!token.refresh_token) {
    // Google only returns a refresh token on first consent; prompt=consent
    // above should force one. If missing, the user must revoke and retry.
    throw new Error('Google did not return a refresh token. Please try connecting again.');
  }

  let email: string | null = null;
  try {
    const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (res.ok) email = ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    /* email is best-effort */
  }

  // This is a family app: keep a single shared connection. Replace any prior one.
  db.prepare('DELETE FROM google_accounts').run();
  const result = db
    .prepare(
      `INSERT INTO google_accounts (user_id, email, refresh_token, access_token, token_expiry)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, email, token.refresh_token, token.access_token, expiryIso(token.expires_in));

  return getAccountById(Number(result.lastInsertRowid))!;
}

export function getConnectedAccount(): GoogleAccount | undefined {
  return db.prepare('SELECT * FROM google_accounts ORDER BY id DESC LIMIT 1').get() as GoogleAccount | undefined;
}

export function getAccountById(id: number): GoogleAccount | undefined {
  return db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(id) as GoogleAccount | undefined;
}

/**
 * Return a currently-valid access token for an account, refreshing it (and
 * persisting the new one) if it has expired.
 */
export async function getValidAccessToken(account: GoogleAccount): Promise<string> {
  if (!config.google) throw new Error('Google is not configured');
  const stillValid = account.access_token && account.token_expiry && new Date(account.token_expiry) > new Date();
  if (stillValid) return account.access_token!;

  const token = await postToken({
    refresh_token: account.refresh_token,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    grant_type: 'refresh_token',
  });
  db.prepare('UPDATE google_accounts SET access_token = ?, token_expiry = ? WHERE id = ?').run(
    token.access_token,
    expiryIso(token.expires_in),
    account.id,
  );
  return token.access_token;
}

export function disconnectGoogle(): void {
  // Removing the account cascades to its google-sourced feeds.
  db.prepare('DELETE FROM google_accounts').run();
}
