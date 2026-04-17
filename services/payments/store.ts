// Payments-specific store with query helpers

import { MemoryStore } from "../shared/store";
import type { Payment } from "../shared/types";

export const paymentStore = new MemoryStore<Payment>();

export function findByOrder(orderId: string): Payment[] {
  return paymentStore.find((p) => p.orderId === orderId);
}

export function findByUser(userId: string): Payment[] {
  return paymentStore.find((p) => p.userId === userId);
}

export function findByStatus(status: Payment["status"]): Payment[] {
  return paymentStore.find((p) => p.status === status);
}

export function findByMethod(method: Payment["method"]): Payment[] {
  return paymentStore.find((p) => p.method === method);
}

export function getTotalRevenue(currency?: string): number {
  const completed = paymentStore.find((p) => p.status === "completed");
  const filtered = currency ? completed.filter((p) => p.currency === currency) : completed;
  return filtered.reduce((sum, p) => sum + p.amount, 0);
}

export function getRevenueByMethod(): Record<string, number> {
  const completed = paymentStore.find((p) => p.status === "completed");
  const result: Record<string, number> = {};
  for (const p of completed) {
    result[p.method] = (result[p.method] || 0) + p.amount;
  }
  return result;
}

export function generateTransactionRef(): string {
  return "TXN-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

export function clearAllStores(): void {
  paymentStore.clear();
}
