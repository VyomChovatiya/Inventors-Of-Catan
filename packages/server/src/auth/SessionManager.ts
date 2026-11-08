import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { AuthenticatedUser } from '@catan/shared';

export interface ServerSession {
  sessionId: string;
  user: AuthenticatedUser;
  createdAt: number;
  expiresAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SECRET_FILE = path.join(DATA_DIR, 'session_secret.key');

// Load .env files from workspace root or server package if present
function loadEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const rawLine of content.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const eqIdx = line.indexOf('=');
          if (eqIdx <= 0) continue;
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      } catch (e) {
        console.error(`Failed to parse ${envPath}:`, e);
      }
    }
  }
}

loadEnvFiles();

function getOrCreateSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 });
  return generated;
}

export const SESSION_COOKIE_NAME = 'catan_sid';
export const OAUTH_STATE_COOKIE_NAME = 'catan_oauth_state';
export const OAUTH_RETURN_COOKIE_NAME = 'catan_oauth_return';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export class SessionManager {
  private sessions = new Map<string, ServerSession>();
  private secret: string;

  constructor() {
    this.secret = getOrCreateSessionSecret();
    this.loadSessions();
  }

  private loadSessions() {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    try {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const parsed: ServerSession[] = JSON.parse(raw);
      const now = Date.now();
      for (const s of parsed) {
        if (s && s.sessionId && s.user && s.expiresAt > now) {
          this.sessions.set(s.sessionId, s);
        }
      }
    } catch (e) {
      console.error('Error loading persisted sessions:', e);
    }
  }

  private persistSessions() {
    try {
      const now = Date.now();
      const active = Array.from(this.sessions.values()).filter((s) => s.expiresAt > now);
      fs.promises
        .writeFile(SESSIONS_FILE, JSON.stringify(active), 'utf-8')
        .catch((err) => console.error('Failed to persist sessions:', err));
    } catch (e) {
      console.error('Error serializing sessions:', e);
    }
  }

  public isOAuthConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  public getCallbackUrl(req?: IncomingMessage): string {
    if (process.env.GOOGLE_CALLBACK_URL) {
      return process.env.GOOGLE_CALLBACK_URL.trim();
    }
    if (process.env.PUBLIC_BASE_URL) {
      return `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/auth/google/callback`;
    }
    if (req && req.headers.host) {
      const proto =
        (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
        (req.headers.host.includes('ngrok') ? 'https' : 'http');
      return `${proto}://${req.headers.host}/api/auth/google/callback`;
    }
    return 'https://flakily-vaseline-catchy.ngrok-free.dev/api/auth/google/callback';
  }

  public signSessionId(sessionId: string): string {
    const hmac = crypto.createHmac('sha256', this.secret).update(sessionId).digest('base64url');
    return `${sessionId}.${hmac}`;
  }

  public verifySignedToken(token: string | undefined | null): ServerSession | null {
    if (!token || typeof token !== 'string') return null;
    const dotIdx = token.indexOf('.');
    if (dotIdx <= 0) return null;
    const sessionId = token.slice(0, dotIdx);
    const providedSig = token.slice(dotIdx + 1);
    const expectedSig = crypto
      .createHmac('sha256', this.secret)
      .update(sessionId)
      .digest('base64url');

    const a = Buffer.from(providedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      this.persistSessions();
      return null;
    }
    return session;
  }

  public createSession(user: AuthenticatedUser): { session: ServerSession; signedToken: string } {
    const sessionId = `sess_${crypto.randomBytes(24).toString('hex')}`;
    const now = Date.now();
    const session: ServerSession = {
      sessionId,
      user,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(sessionId, session);
    this.persistSessions();
    return { session, signedToken: this.signSessionId(sessionId) };
  }

  public updateSessionUserName(sessionId: string, newName: string): AuthenticatedUser | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const clean = newName.trim().slice(0, 20);
    if (!clean) return session.user;
    session.user.name = clean;
    this.persistSessions();
    return session.user;
  }

  public destroySession(sessionId: string) {
    if (this.sessions.delete(sessionId)) {
      this.persistSessions();
    }
  }

  public parseCookies(cookieHeader: string | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieHeader) return result;
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        const k = part.slice(0, eq).trim();
        const v = decodeURIComponent(part.slice(eq + 1).trim());
        result[k] = v;
      }
    }
    return result;
  }

  public getSessionFromRequest(req: IncomingMessage): ServerSession | null {
    const cookies = this.parseCookies(req.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    if (cookieToken) {
      const sess = this.verifySignedToken(cookieToken);
      if (sess) return sess;
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return this.verifySignedToken(authHeader.slice(7).trim());
    }
    return null;
  }

  public getSessionFromCookieHeader(
    cookieHeader: string | undefined,
    fallbackAuthToken?: string,
  ): ServerSession | null {
    const cookies = this.parseCookies(cookieHeader);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    if (cookieToken) {
      const sess = this.verifySignedToken(cookieToken);
      if (sess) return sess;
    }
    if (fallbackAuthToken) {
      return this.verifySignedToken(fallbackAuthToken);
    }
    return null;
  }

  public setSessionCookie(res: ServerResponse, signedToken: string, isSecure: boolean) {
    const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
    const cookieParts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedToken)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSec}`,
    ];
    if (isSecure) cookieParts.push('Secure');
    res.setHeader('Set-Cookie', cookieParts.join('; '));
  }

  public clearSessionCookie(res: ServerResponse) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }
}
