import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the repository root (one level above the server package).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databasePath: process.env.DATABASE_PATH ?? path.resolve(__dirname, '../../data/family.sqlite'),
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  inviteCode: process.env.INVITE_CODE?.trim() || null,
  feedRefreshMinutes: Number(process.env.FEED_REFRESH_MINUTES ?? 30),
  isProduction: process.env.NODE_ENV === 'production',
};
