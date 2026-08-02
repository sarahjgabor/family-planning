import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const childrenRouter = Router();
childrenRouter.use(requireAuth);

const childSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #3b82f6')
    .default('#3b82f6'),
});

childrenRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id, name, color FROM children ORDER BY name').all();
  res.json(rows);
});

childrenRouter.post('/', (req, res) => {
  const parsed = childSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { name, color } = parsed.data;
  const result = db.prepare('INSERT INTO children (name, color) VALUES (?, ?)').run(name, color);
  res.status(201).json({ id: Number(result.lastInsertRowid), name, color });
});

childrenRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = childSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { name, color } = parsed.data;
  const result = db.prepare('UPDATE children SET name = ?, color = ? WHERE id = ?').run(name, color, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Child not found' });
    return;
  }
  res.json({ id, name, color });
});

childrenRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM children WHERE id = ?').run(id);
  res.status(204).end();
});
