import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// List all member accounts (owner only).
usersRouter.get('/', requireAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, email, is_admin AS isAdmin, created_at AS createdAt FROM users ORDER BY created_at')
    .all() as Array<{ id: number; name: string; email: string; isAdmin: number; createdAt: string }>;
  res.json(rows.map((r) => ({ ...r, isAdmin: Boolean(r.isAdmin) })));
});

// Remove a member account (owner only). Their events/calendars are kept
// (created_by is set to null); their reminders and devices are removed.
usersRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) {
    res.status(400).json({ error: "You can't remove your own account here." });
    return;
  }
  const target = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id) as { is_admin: number } | undefined;
  if (!target) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (target.is_admin) {
    res.status(400).json({ error: "You can't remove another owner." });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.status(204).end();
});
