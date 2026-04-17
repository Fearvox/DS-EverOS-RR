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

function put(path: string, body: Record<string, unknown>): Request {
  return new Request(`${BASE}${path}`, {
    method: "PUT",
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

describe("Payments CRUD", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("creates a payment successfully", async () => {
    const res = await handleRequest(post("/payments", validPayment));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.orderId).toBe("order-1");
    expect(body.data.userId).toBe("user-1");
    expect(body.data.amount).toBe(99.99);
    expect(body.data.currency).toBe("USD");
    expect(body.data.method).toBe("credit_card");
    expect(body.data.status).toBe("pending");
  });

  test("generates a transaction ref on creation", async () => {
    const res = await handleRequest(post("/payments", validPayment));
    const body = await json(res);
    expect(body.data.transactionRef).toBeDefined();
    expect(body.data.transactionRef).toMatch(/^TXN-[A-Z0-9]{8}$/);
  });

  test("generates unique transaction refs", async () => {
    const res1 = await handleRequest(post("/payments", validPayment));
    const res2 = await handleRequest(post("/payments", { ...validPayment, orderId: "order-2" }));
    const b1 = await json(res1);
    const b2 = await json(res2);
    expect(b1.data.transactionRef).not.toBe(b2.data.transactionRef);
  });

  test("generates unique IDs", async () => {
    const res1 = await handleRequest(post("/payments", validPayment));
    const res2 = await handleRequest(post("/payments", { ...validPayment, orderId: "order-2" }));
    const b1 = await json(res1);
    const b2 = await json(res2);
    expect(b1.data.id).not.toBe(b2.data.id);
  });

  test("sets timestamps on creation", async () => {
    const res = await handleRequest(post("/payments", validPayment));
    const body = await json(res);
    expect(body.data.createdAt).toBeDefined();
    expect(body.data.updatedAt).toBeDefined();
  });

  test("gets a payment by id", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(get(`/payments/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(created.id);
    expect(body.data.amount).toBe(99.99);
  });

  test("returns 404 for non-existent payment", async () => {
    const res = await handleRequest(get("/payments/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("updates a payment status", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { status: "processing" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("processing");
  });

  test("updates a payment method", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { method: "paypal" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.method).toBe("paypal");
  });

  test("updates a payment amount", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { amount: 150 }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.amount).toBe(150);
  });

  test("updates payment currency", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { currency: "EUR" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.currency).toBe("EUR");
  });

  test("returns 404 when updating non-existent payment", async () => {
    const res = await handleRequest(put("/payments/nonexistent", { status: "completed" }));
    expect(res.status).toBe(404);
  });

  test("rejects invalid status on update", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { status: "invalid" }));
    expect(res.status).toBe(400);
  });

  test("rejects invalid method on update", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { method: "bitcoin" }));
    expect(res.status).toBe(400);
  });

  test("rejects invalid amount on update", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { amount: -5 }));
    expect(res.status).toBe(400);
  });

  test("rejects invalid currency on update", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/payments/${created.id}`, { currency: "BTC" }));
    expect(res.status).toBe(400);
  });

  test("lists all payments", async () => {
    await handleRequest(post("/payments", validPayment));
    await handleRequest(post("/payments", { ...validPayment, orderId: "order-2" }));

    const res = await handleRequest(get("/payments"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  test("lists with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await handleRequest(post("/payments", { ...validPayment, orderId: `order-${i}` }));
    }

    const res = await handleRequest(get("/payments?page=2&limit=2"));
    const body = await json(res);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.page).toBe(2);
    expect(body.meta.limit).toBe(2);
  });

  test("rejects creation with missing orderId", async () => {
    const res = await handleRequest(post("/payments", { ...validPayment, orderId: undefined }));
    expect(res.status).toBe(400);
  });

  test("rejects creation with missing userId", async () => {
    const res = await handleRequest(post("/payments", { ...validPayment, userId: undefined }));
    expect(res.status).toBe(400);
  });

  test("rejects creation with invalid amount", async () => {
    const res = await handleRequest(post("/payments", { ...validPayment, amount: -10 }));
    expect(res.status).toBe(400);
  });

  test("rejects creation with invalid currency", async () => {
    const res = await handleRequest(post("/payments", { ...validPayment, currency: "BTC" }));
    expect(res.status).toBe(400);
  });

  test("rejects creation with invalid method", async () => {
    const res = await handleRequest(post("/payments", { ...validPayment, method: "cash" }));
    expect(res.status).toBe(400);
  });

  test("returns 404 for unknown routes", async () => {
    const res = await handleRequest(get("/unknown"));
    expect(res.status).toBe(404);
  });

  test("rejects creation with invalid JSON", async () => {
    const req = new Request(`${BASE}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(400);
  });
});
