import type { VideoInfo } from '../services/types';

export interface UserSession {
  token: string;
  videoInfo: VideoInfo;
  chatId: number;
  messageId: number;
  createdAt: number;
  expiresAt: number;
}

/** Estado por usuário, mantido apenas em memória. */
export class StateManager {
  private readonly sessions = new Map<number, UserSession>();
  private readonly requests = new Map<number, number[]>();

  set(userId: number, session: UserSession): void {
    this.sessions.set(userId, session);
  }

  get(userId: number): UserSession | undefined {
    const session = this.sessions.get(userId);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(userId);
      return undefined;
    }
    return session;
  }

  delete(userId: number): void {
    this.sessions.delete(userId);
  }

  allowRequest(userId: number, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.requests.get(userId) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      this.requests.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(userId, recent);
    return true;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [userId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(userId);
        removed += 1;
      }
    }
    for (const [userId, times] of this.requests) {
      const recent = times.filter((time) => now - time < 60_000);
      if (recent.length === 0) this.requests.delete(userId);
      else this.requests.set(userId, recent);
    }
    return removed;
  }

  get size(): number {
    return this.sessions.size;
  }
}
