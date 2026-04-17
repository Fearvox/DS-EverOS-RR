// Shared types for all microservices

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: { total?: number; page?: number; limit?: number };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "deleted";
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  status: "active" | "inactive" | "archived";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  status: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
  total: number;
  shippingAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Payment {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  method: "credit_card" | "debit_card" | "paypal" | "bank_transfer";
  status: "pending" | "processing" | "completed" | "failed" | "refunded";
  transactionRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: "email" | "sms" | "push" | "in_app";
  title: string;
  message: string;
  status: "pending" | "sent" | "delivered" | "failed" | "read";
  metadata?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
}

export interface AnalyticsEvent {
  id: string;
  eventType: string;
  userId?: string;
  sessionId?: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export interface SearchDocument {
  id: string;
  collection: string;
  content: Record<string, unknown>;
  text: string;
  tags: string[];
  score?: number;
  indexedAt: string;
}
