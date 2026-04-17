// Users-specific store with search, role filtering, soft delete, and activity log

import { MemoryStore } from "../shared/store";
import type { User } from "../shared/types";
import { generateId, now } from "../shared/http";

export interface ActivityEntry {
  id: string;
  userId: string;
  action: string;
  details?: string;
  timestamp: string;
}

class UserStore extends MemoryStore<User> {
  private activities = new Map<string, ActivityEntry[]>();

  findByEmail(email: string): User | undefined {
    return this.findOne((u) => u.email === email);
  }

  findByRole(role: "user" | "admin"): User[] {
    return this.find((u) => u.role === role);
  }

  search(query: string): User[] {
    const q = query.toLowerCase();
    return this.find(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }

  getActiveUsers(): User[] {
    return this.find((u) => u.status === "active");
  }

  softDelete(id: string): User | undefined {
    return this.update(id, { status: "deleted" as const, updatedAt: now() });
  }

  logActivity(userId: string, action: string, details?: string): ActivityEntry {
    const entry: ActivityEntry = {
      id: generateId(),
      userId,
      action,
      details,
      timestamp: now(),
    };
    const list = this.activities.get(userId) || [];
    list.push(entry);
    this.activities.set(userId, list);
    return entry;
  }

  getActivity(userId: string): ActivityEntry[] {
    return this.activities.get(userId) || [];
  }

  clearAll(): void {
    this.clear();
    this.activities.clear();
  }
}

export const userStore = new UserStore();
