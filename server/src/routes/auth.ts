import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth.js';

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  inviteCode: z.string().optional(),
});

authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { name, email, password, inviteCode } = parsed.data;

  if (config.inviteCode && inviteCode !== config.inviteCode) {
    res.status(403).json({ error: 'Invalid or missing invite code' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with that email already exists' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, passwordHash);

  const user = { id: Number(result.lastInsertRowid), name, email };
  res.status(201).json({ token: signToken(user), user });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your email and password' });
    return;
  }
  const { email, password } = parsed.data;
  const row = db
    .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?')
    .get(email) as { id: number; name: string; email: string; password_hash: string } | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    res.status(401).json({ error: 'Incorrect email or password' });
    return;
  }

  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: signToken(user), user });
});

// Returns the currently signed-in user (used to restore a session on load).
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Tells the client whether an invite code is needed, so the signup form can
// show the field only when relevant.
authRouter.get('/config', (_req, res) => {
  res.json({ inviteRequired: Boolean(config.inviteCode) });
});
