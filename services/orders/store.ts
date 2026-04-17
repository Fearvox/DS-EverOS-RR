// Orders-specific store with user lookup, status filtering, date ranges, and aggregations

import { MemoryStore } from "../shared/store";
import type { Order } from "../shared/types";

class OrderStore extends MemoryStore<Order> {
  findByUser(userId: string): Order[] {
    return this.find((o) => o.userId === userId);
  }

  findByStatus(status: Order["status"]): Order[] {
    return this.find((o) => o.status === status);
  }

  getOrdersByDateRange(start: string, end: string): Order[] {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    return this.find((o) => {
      const t = new Date(o.createdAt).getTime();
      return t >= startTime && t <= endTime;
    });
  }

  calculateUserTotal(userId: string): number {
    return this.findByUser(userId).reduce((sum, o) => sum + o.total, 0);
  }

  getStatusCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const order of this.getAll()) {
      counts[order.status] = (counts[order.status] || 0) + 1;
    }
    return counts;
  }
}

export const orderStore = new OrderStore();
