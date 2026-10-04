import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { db } from './db.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

// Extend Express's Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: '30d' });
}

/**
 * Express middleware that requires a valid bearer token. Attaches req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & AuthUser;
    req.user = { id: payload.id, name: payload.name, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

/** True if the given user id is the account owner/admin. */
export function isAdmin(userId: number): boolean {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
  return Boolean(row?.is_admin);
}

/** Middleware that requires the signed-in user to be an admin. Runs after requireAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !isAdmin(req.user.id)) {
    res.status(403).json({ error: 'Only the account owner can manage members' });
    return;
  }
  next();
}
