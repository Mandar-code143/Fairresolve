/**
 * FairResolve Authentication & RBAC Middleware
 *
 * Implements:
 * - PBKDF2 password hashing with cryptographically secure random salts
 * - Session token issuance, storage, expiration, and revocation
 * - Real role-based access control (OWNER, ADMIN, REVIEWER, ANALYST, VIEWER)
 * - Safe demo login for testing without global simulated variables
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, Session, UserAccount } from './database';
import { User, UserRole } from '../types';

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: Session;
  tenantId?: string;
}

export class AuthService {
  /**
   * Hash password with PBKDF2
   */
  public hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  }

  /**
   * Create new authenticated session
   */
  public createSession(
    userId: string,
    tenantId: string,
    req?: Request
  ): { session: Session; token: string } {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionId = `sess-${crypto.randomUUID()}`;

    const session: Session = {
      id: sessionId,
      userId,
      tenantId,
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      userAgent: req?.headers['user-agent'] as string,
      ipAddress: req?.ip,
      isRevoked: false,
    };

    db.sessions[session.id] = session;
    db.scheduleSave();

    return { session, token: rawToken };
  }

  /**
   * Validate session token
   */
  public validateToken(rawToken: string): { user: User; session: Session } | null {
    if (!rawToken) return null;

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const session = Object.values(db.sessions).find(
      (s) => s.tokenHash === tokenHash && !s.isRevoked
    );

    if (!session) return null;

    // Check expiration
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.isRevoked = true;
      db.scheduleSave();
      return null;
    }

    const userAccount = db.users[session.userId];
    if (!userAccount) return null;

    // Strip password fields before returning user
    const user: User = {
      id: userAccount.id,
      name: userAccount.name,
      email: userAccount.email,
      role: userAccount.role,
      tenantId: session.tenantId,
      avatarUrl: userAccount.avatarUrl,
    };

    return { user, session };
  }

  /**
   * Revoke session
   */
  public revokeSession(rawToken: string): boolean {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const session = Object.values(db.sessions).find((s) => s.tokenHash === tokenHash);
    if (session) {
      session.isRevoked = true;
      db.scheduleSave();
      return true;
    }
    return false;
  }
}

export const authService = new AuthService();

/**
 * Authentication middleware: verifies Bearer token from header
 */
export const requireAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  let rawToken = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    rawToken = req.headers['x-session-token'] as string;
  }

  // If no token provided, return 401 Unauthorized
  if (!rawToken) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const result = authService.validateToken(rawToken);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  req.user = result.user;
  req.session = result.session;
  req.tenantId = result.session.tenantId;

  next();
};

/**
 * Role-Based Access Control middleware
 */
export const requireRoles = (allowedRoles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Your role (${req.user.role}) is not authorized to perform this operation. Requires ${allowedRoles.join(' or ')}.`,
      });
    }

    next();
  };
};
