import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { clearAllStores } from "../store";

const BASE = "http://localhost:3005";

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`);
}

async function json(res: Response) {
  return res.json();
}

const validPayment = {
  orderId: "order-1",
  userId: "user-1",
  amount: 99.99,
  currency: "USD",
  method: "credit_card",
};

async function createPayment(overrides: Record<string, unknown> = {}) {
  const res = await handleRequest(post("/payments", { ...validPayment, ...overrides }));
  const body = await json(res);
  return body.data;
}

describe("Payment Processing", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("processes a pending payment successfully", async () => {
    const payment = await createPayment();
    const res = await handleRequest(post(`/payments/${payment.id}/process`, {}));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.payment.status).toBe("completed");
    expect(body.data.message).toContain("successfully");
  });

  test("fails processing for amounts over 10000", async () => {
    const payment = await createPayment({ amount: 15000 });
    const res = await handleRequest(post(`/payments/${payment.id}/process`, {}));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.payment.status).toBe("failed");
    expect(body.data.message).toContain("failed");
  });

  test("succeeds processing for amount exactly 10000", async () => {
    const payment = await createPayment({ amount: 10000 });
    const res = await handleRequest(post(`/payments/${payment.id}/process`, {}));
    const body = await json(res);
    expect(body.data.payment.status).toBe("completed");
  });

  test("fails processing for amount 10001", async () => {
    const payment = await createPayment({ amount: 10001 });
    const res = await handleRequest(post(`/payments/${payment.id}/process`, {}));
    const body = await json(res);
    expect(body.data.payment.status).toBe("failed");
  });

  test("rejects processing non-pending payment", async () => {
    const payment = await createPayment();
    // Process it first
    await handleRequest(post(`/payments/${payment.id}/process`, {}));
    // Try again
    const res = await handleRequest(post(`/payments/${payment.id}/process`, {}));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("pending");
  });

  test("returns 404 when processing non-existent payment", async () => {
    const res = await handleRequest(post("/payments/nonexistent/process", {}));
    expect(res.status).toBe(404);
  });
});

describe("Payment Refunds", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("refunds a completed payment", async () => {
    const payment = await createPayment();
    await handleRequest(post(`/payments/${payment.id}/process`, {}));

    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.payment.status).toBe("refunded");
    expect(body.data.refund).toBeDefined();
    expect(body.data.refund.amount).toBe(-99.99);
    expect(body.data.refund.status).toBe("completed");
  });

  test("refund creates a new payment record", async () => {
    const payment = await createPayment();
    await handleRequest(post(`/payments/${payment.id}/process`, {}));
    await handleRequest(post(`/payments/${payment.id}/refund`, {}));

    const listRes = await handleRequest(get("/payments"));
    const listBody = await json(listRes);
    // Original + refund record
    expect(listBody.data).toHaveLength(2);
  });

  test("refund record has its own transaction ref", async () => {
    const payment = await createPayment();
    await handleRequest(post(`/payments/${payment.id}/process`, {}));

    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    const body = await json(res);
    expect(body.data.refund.transactionRef).toMatch(/^TXN-[A-Z0-9]{8}$/);
    expect(body.data.refund.transactionRef).not.toBe(payment.transactionRef);
  });

  test("refund preserves order and user IDs", async () => {
    const payment = await createPayment({ orderId: "ord-42", userId: "usr-7" });
    await handleRequest(post(`/payments/${payment.id}/process`, {}));

    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    const body = await json(res);
    expect(body.data.refund.orderId).toBe("ord-42");
    expect(body.data.refund.userId).toBe("usr-7");
  });

  test("rejects refund for pending payment", async () => {
    const payment = await createPayment();
    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("completed");
  });

  test("rejects refund for failed payment", async () => {
    const payment = await createPayment({ amount: 20000 });
    await handleRequest(post(`/payments/${payment.id}/process`, {}));

    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    expect(res.status).toBe(400);
  });

  test("rejects double refund", async () => {
    const payment = await createPayment();
    await handleRequest(post(`/payments/${payment.id}/process`, {}));
    await handleRequest(post(`/payments/${payment.id}/refund`, {}));

    const res = await handleRequest(post(`/payments/${payment.id}/refund`, {}));
    expect(res.status).toBe(400);
  });

  test("returns 404 when refunding non-existent payment", async () => {
    const res = await handleRequest(post("/payments/nonexistent/refund", {}));
    expect(res.status).toBe(404);
  });
});
