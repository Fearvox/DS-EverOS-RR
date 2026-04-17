// Payment request handlers - pure function handleRequest(req: Request): Promise<Response>

import {
  jsonResponse,
  errorResponse,
  metaResponse,
  parseBody,
  getPathSegments,
  getQueryParams,
  generateId,
  now,
} from "../shared/http";
import { isNonEmptyString, isPositiveNumber, isValidEnum, validate } from "../shared/validation";
import type { Payment } from "../shared/types";
import {
  paymentStore,
  findByOrder,
  findByUser,
  findByStatus,
  findByMethod,
  getTotalRevenue,
  getRevenueByMethod,
  generateTransactionRef,
} from "./store";

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY"] as const;
const PAYMENT_METHODS = ["credit_card", "debit_card", "paypal", "bank_transfer"] as const;
const PAYMENT_STATUSES = ["pending", "processing", "completed", "failed", "refunded"] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);

  // All routes start with /payments
  if (segments[0] !== "payments") {
    return errorResponse("Not found", 404);
  }

  // GET /payments/stats
  if (method === "GET" && segments[1] === "stats" && segments.length === 2) {
    return handleStats();
  }

  // GET /payments/revenue
  if (method === "GET" && segments[1] === "revenue" && segments.length === 2) {
    return handleRevenue();
  }

  // POST /payments/validate-card
  if (method === "POST" && segments[1] === "validate-card" && segments.length === 2) {
    return handleValidateCard(req);
  }

  // GET /payments/order/:orderId
  if (method === "GET" && segments[1] === "order" && segments[2]) {
    return jsonResponse(findByOrder(segments[2]));
  }

  // GET /payments/user/:userId
  if (method === "GET" && segments[1] === "user" && segments[2]) {
    return jsonResponse(findByUser(segments[2]));
  }

  // POST /payments/:id/process
  if (method === "POST" && segments[2] === "process" && segments[1]) {
    return handleProcess(segments[1]);
  }

  // POST /payments/:id/refund
  if (method === "POST" && segments[2] === "refund" && segments[1]) {
    return handleRefund(segments[1]);
  }

  // GET /payments/:id/receipt
  if (method === "GET" && segments[2] === "receipt" && segments[1]) {
    return handleReceipt(segments[1]);
  }

  // GET /payments - list with filters
  if (method === "GET" && segments.length === 1) {
    return handleList(req);
  }

  // POST /payments - create
  if (method === "POST" && segments.length === 1) {
    return handleCreate(req);
  }

  // GET /payments/:id
  if (method === "GET" && segments.length === 2) {
    const payment = paymentStore.getById(segments[1]);
    if (!payment) return errorResponse("Payment not found", 404);
    return jsonResponse(payment);
  }

  // PUT /payments/:id
  if (method === "PUT" && segments.length === 2) {
    return handleUpdate(req, segments[1]);
  }

  return errorResponse("Not found", 404);
}

function handleList(req: Request): Response {
  const params = getQueryParams(req);
  let payments = paymentStore.getAll();

  const userId = params.get("userId");
  const orderId = params.get("orderId");
  const status = params.get("status");
  const paymentMethod = params.get("method");
  const currency = params.get("currency");

  if (userId) payments = payments.filter((p) => p.userId === userId);
  if (orderId) payments = payments.filter((p) => p.orderId === orderId);
  if (status) payments = payments.filter((p) => p.status === status);
  if (paymentMethod) payments = payments.filter((p) => p.method === paymentMethod);
  if (currency) payments = payments.filter((p) => p.currency === currency);

  const total = payments.length;
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(params.get("limit") || "20", 10) || 20));
  const start = (page - 1) * limit;
  const paged = payments.slice(start, start + limit);

  return metaResponse(paged, { total, page, limit });
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseBody<{
    orderId?: string;
    userId?: string;
    amount?: number;
    currency?: string;
    method?: string;
  }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const errors = validate([
    [isNonEmptyString(body.orderId), "orderId", "Order ID is required"],
    [isNonEmptyString(body.userId), "userId", "User ID is required"],
    [isPositiveNumber(body.amount), "amount", "Amount must be a positive number"],
    [isValidEnum(body.currency, SUPPORTED_CURRENCIES), "currency", "Currency must be one of: USD, EUR, GBP, JPY, CNY"],
    [isValidEnum(body.method, PAYMENT_METHODS), "method", "Method must be one of: credit_card, debit_card, paypal, bank_transfer"],
  ]);
  if (errors.length > 0) {
    return errorResponse(errors[0].message, 400);
  }

  const timestamp = now();
  const payment: Payment = {
    id: generateId(),
    orderId: body.orderId as string,
    userId: body.userId as string,
    amount: body.amount as number,
    currency: body.currency as string,
    method: body.method as Payment["method"],
    status: "pending",
    transactionRef: generateTransactionRef(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  paymentStore.create(payment);
  return jsonResponse(payment, 201);
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const existing = paymentStore.getById(id);
  if (!existing) return errorResponse("Payment not found", 404);

  const body = await parseBody<{
    status?: string;
    method?: string;
    amount?: number;
    currency?: string;
  }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const updates: Partial<Payment> = { updatedAt: now() };

  if (body.status !== undefined) {
    if (!isValidEnum(body.status, PAYMENT_STATUSES)) {
      return errorResponse("Invalid status", 400);
    }
    updates.status = body.status as Payment["status"];
  }

  if (body.method !== undefined) {
    if (!isValidEnum(body.method, PAYMENT_METHODS)) {
      return errorResponse("Invalid method", 400);
    }
    updates.method = body.method as Payment["method"];
  }

  if (body.amount !== undefined) {
    if (!isPositiveNumber(body.amount)) {
      return errorResponse("Amount must be a positive number", 400);
    }
    updates.amount = body.amount;
  }

  if (body.currency !== undefined) {
    if (!isValidEnum(body.currency, SUPPORTED_CURRENCIES)) {
      return errorResponse("Invalid currency", 400);
    }
    updates.currency = body.currency;
  }

  const updated = paymentStore.update(id, updates);
  if (!updated) return errorResponse("Failed to update payment", 500);
  return jsonResponse(updated);
}

function handleProcess(id: string): Response {
  const payment = paymentStore.getById(id);
  if (!payment) return errorResponse("Payment not found", 404);

  if (payment.status !== "pending") {
    return errorResponse("Only pending payments can be processed", 400);
  }

  // Simulate processing: set to "processing" first
  paymentStore.update(id, { status: "processing", updatedAt: now() });

  // Simulate outcome: amounts > 10000 fail
  if (payment.amount > 10000) {
    const failed = paymentStore.update(id, { status: "failed", updatedAt: now() });
    return jsonResponse({ payment: failed, message: "Payment failed: amount exceeds limit" });
  }

  const completed = paymentStore.update(id, { status: "completed", updatedAt: now() });
  return jsonResponse({ payment: completed, message: "Payment processed successfully" });
}

function handleRefund(id: string): Response {
  const payment = paymentStore.getById(id);
  if (!payment) return errorResponse("Payment not found", 404);

  if (payment.status !== "completed") {
    return errorResponse("Only completed payments can be refunded", 400);
  }

  // Mark original as refunded
  paymentStore.update(id, { status: "refunded", updatedAt: now() });

  // Create refund record
  const timestamp = now();
  const refund: Payment = {
    id: generateId(),
    orderId: payment.orderId,
    userId: payment.userId,
    amount: -payment.amount,
    currency: payment.currency,
    method: payment.method,
    status: "completed",
    transactionRef: generateTransactionRef(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  paymentStore.create(refund);

  const refundedOriginal = paymentStore.getById(id);
  return jsonResponse({ payment: refundedOriginal, refund });
}

function handleReceipt(id: string): Response {
  const payment = paymentStore.getById(id);
  if (!payment) return errorResponse("Payment not found", 404);

  if (payment.status !== "completed") {
    return errorResponse("Receipts are only available for completed payments", 400);
  }

  const receipt = {
    receiptId: "RCP-" + payment.id.slice(0, 8).toUpperCase(),
    transactionRef: payment.transactionRef,
    orderId: payment.orderId,
    userId: payment.userId,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paidAt: payment.updatedAt,
    issuedAt: now(),
  };

  return jsonResponse(receipt);
}

function handleStats(): Response {
  const all = paymentStore.getAll();

  const byStatus: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const byCurrency: Record<string, number> = {};

  for (const p of all) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byMethod[p.method] = (byMethod[p.method] || 0) + 1;
    byCurrency[p.currency] = (byCurrency[p.currency] || 0) + 1;
  }

  return jsonResponse({
    totalTransactions: all.length,
    byStatus,
    byMethod,
    byCurrency,
    totalRevenue: getTotalRevenue(),
  });
}

function handleRevenue(): Response {
  const revenueByCurrency: Record<string, number> = {};
  const completed = paymentStore.find((p) => p.status === "completed");

  for (const p of completed) {
    revenueByCurrency[p.currency] = (revenueByCurrency[p.currency] || 0) + p.amount;
  }

  return jsonResponse({
    byCurrency: revenueByCurrency,
    byMethod: getRevenueByMethod(),
    total: getTotalRevenue(),
  });
}

async function handleValidateCard(req: Request): Promise<Response> {
  const body = await parseBody<{ cardNumber?: string }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isNonEmptyString(body.cardNumber)) {
    return errorResponse("Card number is required", 400);
  }

  const digits = (body.cardNumber as string).replace(/\s|-/g, "");
  const valid = digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);

  return jsonResponse({
    valid,
    cardNumber: digits.slice(-4).padStart(digits.length, "*"),
    message: valid ? "Card number format is valid" : "Invalid card number length or format",
  });
}
