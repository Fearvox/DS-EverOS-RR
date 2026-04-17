import { MemoryStore } from "../shared/store";
import type { Notification } from "../shared/types";
import { now } from "../shared/http";

export class NotificationStore extends MemoryStore<Notification> {
  findByUser(userId: string): Notification[] {
    return this.find((n) => n.userId === userId);
  }

  findByType(type: string): Notification[] {
    return this.find((n) => n.type === type);
  }

  findByStatus(status: string): Notification[] {
    return this.find((n) => n.status === status);
  }

  getUnreadCount(userId: string): number {
    return this.find((n) => n.userId === userId && n.status !== "read").length;
  }

  markAsRead(id: string): Notification | undefined {
    return this.update(id, { status: "read", readAt: now() } as Partial<Notification>);
  }

  markAllRead(userId: string): number {
    const unread = this.find((n) => n.userId === userId && n.status !== "read");
    const timestamp = now();
    let count = 0;
    for (const n of unread) {
      this.update(n.id, { status: "read", readAt: timestamp } as Partial<Notification>);
      count++;
    }
    return count;
  }

  getByUserAndType(userId: string, type: string): Notification[] {
    return this.find((n) => n.userId === userId && n.type === type);
  }
}

export const notificationStore = new NotificationStore();

export function clearAllStores(): void {
  notificationStore.clear();
}
