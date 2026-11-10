/**
 * FairResolve Authentication, Session Security & RBAC Middleware
 *
 * Implements:
 * - Cryptographically secure password hashing (scrypt with N=16384, r=8, p=1, 32-byte salt)
 * - Timing-safe password verification to prevent side-channel timing attacks
 * - High-entropy session tokens with SHA-256 database token-hash storage
 * - Dual session delivery: HttpOnly, Secure, SameSite cookies + Bearer token fallback
 * - Explicit CSRF protection
 * - Fine-grained Role-Based Access Control (RBAC):
 *   OWNER > ADMIN > REVIEWER > ANALYST > VIEWER
 * - Safe invitation flow with member-established passwords
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, Session } from './database';
import { config } from './config';
import { User, UserRole } from '../types';
import { permissionService, Permission as GranularPermission, ROLE_PERMISSIONS as GRANULAR_PERMISSIONS } from './permissions';

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: Session;
  tenantId?: string;
  csrfToken?: string;
}

export type LegacyPermission =
  | 'MANAGE_TEAM'
  | 'PUBLISH_POLICY'
  | 'REVIEW_CASE'
  | 'AUTHORIZE_REFUND'
  | 'EXECUTE_REFUND'
  | 'RUN_AI_INVESTIGATION'
  | 'VIEW_AUDIT_LOGS'
  | 'VIEW_CASES'
  | 'MANAGE_INTEGRATIONS';

export type Permission = GranularPermission | LegacyPermission;

const LEGACY_MAP: Record<LegacyPermission, GranularPermission> = {
  MANAGE_TEAM: 'team.invite',
  PUBLISH_POLICY: 'policy.manage',
  REVIEW_CASE: 'cases.approve',
  AUTHORIZE_REFUND: 'refund.approve',
  EXECUTE_REFUND: 'refund.execute',
  RUN_AI_INVESTIGATION: 'cases.investigate',
  VIEW_AUDIT_LOGS: 'audit.view',
  VIEW_CASES: 'cases.view',
  MANAGE_INTEGRATIONS: 'integration.manage',
};

export class AuthService {
  /**
   * Hash password using Node.js crypto.scrypt with cryptographically random 32-byte salt
   */
  public hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  }

  /**
   * Timing-safe password verification to prevent side-channel timing attacks
   */
  public verifyPassword(password: string, salt: string, expectedHash: string): boolean {
    const computed = this.hashPassword(password, salt);
    const computedBuf = Buffer.from(computed, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (computedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, expectedBuf);
  }

  /**
   * Validate password complexity
   */
  public validatePasswordStrength(password: string): { isValid: boolean; message?: string } {
    if (password.length < 10) {
      return { isValid: false, message: 'Password must be at least 10 characters long' };
    }
    if (!/[A-Z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one lowercase letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { isValid: false, message: 'Password must contain at least one number' };
    }
    return { isValid: true };
  }

  /**
   * Create an authenticated session with 7-day expiration
   */
  public createSession(
    userId: string,
    tenantId: string,
    _req?: Request
  ): { session: Session; token: string; csrfToken: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sessionId = `sess-${crypto.randomUUID()}`;
    const csrfNonce = crypto.randomBytes(12).toString('hex');
    const csrfMac = crypto
      .createHmac('sha256', config.SESSION_SECRET)
      .update(`${sessionId}:${csrfNonce}`)
      .digest('hex');
    const csrfToken = `${csrfNonce}.${csrfMac}`;

    const session: Session = {
      id: sessionId,
      userId,
      tenantId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      isRevoked: false,
    };

    db.sessions[session.id] = session;
    db.scheduleSave();
    if (db.isPostgresActive()) {
      db.saveSessionPg(session).catch((err) => console.warn('[Auth] Postgres session save error:', err.message));
    }

    return { session, token, csrfToken };
  }

  /**
   * Validate a raw session token against the stored SHA-256 hash
   */
  public validateSessionToken(rawToken: string): { user: User; session: Session } | null {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const session = Object.values(db.sessions).find(
      (s) => s.tokenHash === tokenHash && !s.isRevoked && new Date(s.expiresAt).getTime() > Date.now()
    );
    if (!session) return null;

    const userAccount = db.users[session.userId];
    if (!userAccount) return null;

    const user: User = {
      id: userAccount.id,
      name: userAccount.name,
      email: userAccount.email,
      role: userAccount.role,
      tenantId: userAccount.tenantId,
      avatarUrl: userAccount.avatarUrl,
    };

    return { user, session };
  }

  /**
   * Revoke session by raw token
   */
  public revokeSession(rawToken: string): boolean {
    if (!rawToken) return false;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    for (const [id, s] of Object.entries(db.sessions)) {
      if (s.tokenHash === tokenHash) {
        delete db.sessions[id];
        db.scheduleSave();
        if (db.isPostgresActive()) {
          db.query('UPDATE sessions SET is_revoked = true WHERE token_hash = $1', [tokenHash]).catch(() => {});
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Set HttpOnly secure session cookie
   */
  public setAuthCookie(res: Response, rawToken: string) {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('fairresolve_session', rawToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  /**
   * Clear session cookie on signout
   */
  public clearAuthCookie(res: Response) {
    res.clearCookie('fairresolve_session', { path: '/' });
  }

  /**
   * Check if role has permission (supports granular and legacy permission keys)
   */
  public hasPermission(role: UserRole, permission: Permission): boolean {
    const granularKey: GranularPermission = (LEGACY_MAP[permission as LegacyPermission] || permission) as GranularPermission;
    return permissionService.hasPermission(role, granularKey);
  }
}

export const authService = new AuthService();

/**
 * Authentication Middleware:
 * Inspects HttpOnly cookies and Bearer headers.
 * Populates req.user, req.session, req.tenantId.
 */
export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  let rawToken: string | undefined;

  // 1. Try HttpOnly cookie
  if (req.cookies && req.cookies.fairresolve_session) {
    rawToken = req.cookies.fairresolve_session;
  }

  // 2. Fall back to Authorization Bearer header
  if (!rawToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.substring(7).trim();
    }
  }

  // 3. Fall back to X-Session-Token header
  if (!rawToken && req.headers['x-session-token']) {
    rawToken = req.headers['x-session-token'] as string;
  }

  if (!rawToken) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const result = authService.validateSessionToken(rawToken);
  if (!result) {
    // Clear invalid cookie if present
    res.clearCookie('fairresolve_session', { path: '/' });
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  req.user = result.user;
  req.session = result.session;
  req.tenantId = result.session.tenantId;

  // CSRF Protection: For mutating requests authenticated via cookie, require custom anti-CSRF header
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const hasBearerHeader = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    const hasCustomHeader = Boolean(req.headers['x-requested-with'] || req.headers['x-csrf-token']);
    if (!hasBearerHeader && req.cookies && req.cookies.fairresolve_session && !hasCustomHeader) {
      return res.status(403).json({ error: 'CSRF verification failed: Missing required anti-CSRF request header.' });
    }
  }

  next();
};

/**
 * RBAC Role Guard Middleware
 */
export const requireRoles = (allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Action requires one of: [${allowedRoles.join(', ')}]. Current role: ${req.user.role}.`,
      });
    }

    next();
  };
};

/**
 * RBAC Permission Guard Middleware
 */
export const requirePermission = (permission: Permission) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!authService.hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: `Access denied. Missing required permission: ${permission}.`,
      });
    }

    next();
  };
};
