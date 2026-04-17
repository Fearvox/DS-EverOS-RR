// Auth-specific store: credentials, sessions, password reset tokens

import { MemoryStore } from "../shared/store";
import type { User, AuthSession } from "../shared/types";
import { generateId, now } from "../shared/http";

export interface UserCredentials {
  id: string;
  userId: string;
  email: string;
  passwordHash: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  used: boolean;
  createdAt: string;
}

const hash = (s: string): string => Bun.hash(s).toString(36);

export const userStore = new MemoryStore<User>();
export const credentialStore = new MemoryStore<UserCredentials>();
export const sessionStore = new MemoryStore<AuthSession>();
export const resetTokenStore = new MemoryStore<PasswordResetToken>();

export function hashPassword(password: string): string {
  return hash(password);
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  return hash(password) === passwordHash;
}

export function createSession(userId: string): AuthSession {
  const session: AuthSession = {
    id: generateId(),
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now(),
  };
  return sessionStore.create(session);
}

export function findSessionByToken(token: string): AuthSession | undefined {
  return sessionStore.findOne((s) => s.token === token && new Date(s.expiresAt) > new Date());
}

export function createResetToken(userId: string): PasswordResetToken {
  const resetToken: PasswordResetToken = {
    id: generateId(),
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    used: false,
    createdAt: now(),
  };
  return resetTokenStore.create(resetToken);
}

export function findValidResetToken(token: string): PasswordResetToken | undefined {
  return resetTokenStore.findOne(
    (t) => t.token === token && !t.used && new Date(t.expiresAt) > new Date()
  );
}

export function clearAllStores(): void {
  userStore.clear();
  credentialStore.clear();
  sessionStore.clear();
  resetTokenStore.clear();
}
