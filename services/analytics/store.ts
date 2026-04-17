import { MemoryStore } from "../shared/store";
import type { AnalyticsEvent } from "../shared/types";

export class AnalyticsStore extends MemoryStore<AnalyticsEvent> {
  findByEventType(type: string): AnalyticsEvent[] {
    return this.find((e) => e.eventType === type);
  }

  findByUser(userId: string): AnalyticsEvent[] {
    return this.find((e) => e.userId === userId);
  }

  findBySession(sessionId: string): AnalyticsEvent[] {
    return this.find((e) => e.sessionId === sessionId);
  }

  findByDateRange(start: string, end: string): AnalyticsEvent[] {
    return this.find((e) => e.timestamp >= start && e.timestamp <= end);
  }

  getEventTypeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.getAll()) {
      counts[event.eventType] = (counts[event.eventType] || 0) + 1;
    }
    return counts;
  }

  getUniqueUsers(): string[] {
    const users = new Set<string>();
    for (const event of this.getAll()) {
      if (event.userId) users.add(event.userId);
    }
    return Array.from(users);
  }

  getUniqueSessions(): string[] {
    const sessions = new Set<string>();
    for (const event of this.getAll()) {
      if (event.sessionId) sessions.add(event.sessionId);
    }
    return Array.from(sessions);
  }
}

export const analyticsStore = new AnalyticsStore();
