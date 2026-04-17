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
  amount: 100,
  currency: "USD",
  method: "credit_card",
};

async function createAndProcess(overrides: Record<string, unknown> = {}) {
  const createRes = await handleRequest(post("/payments", { ...validPayment, ...overrides }));
  const { data } = await json(createRes);
  await handleRequest(post(`/payments/${data.id}/process`, {}));
  return data;
}

describe("Payment Stats", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("returns stats with zero payments", async () => {
    const res = await handleRequest(get("/payments/stats"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.totalTransactions).toBe(0);
    expect(body.data.totalRevenue).toBe(0);
  });

  test("counts transactions by status", async () => {
    await createAndProcess(); // completed
    await createAndProcess({ orderId: "o2" }); // completed
    const createRes = await handleRequest(post("/payments", { ...validPayment, orderId: "o3" }));
    // leave as pending

    const res = await handleRequest(get("/payments/stats"));
    const body = await json(res);
    expect(body.data.totalTransactions).toBe(3);
    expect(body.data.byStatus.completed).toBe(2);
    expect(body.data.byStatus.pending).toBe(1);
  });

  test("counts transactions by method", async () => {
    await createAndProcess({ method: "credit_card" });
    await createAndProcess({ orderId: "o2", method: "paypal" });
    await createAndProcess({ orderId: "o3", method: "paypal" });

    const res = await handleRequest(get("/payments/stats"));
    const body = await json(res);
    expect(body.data.byMethod.credit_card).toBe(1);
    expect(body.data.byMethod.paypal).toBe(2);
  });

  test("counts transactions by currency", async () => {
    await createAndProcess({ currency: "USD" });
    await createAndProcess({ orderId: "o2", currency: "EUR" });

    const res = await handleRequest(get("/payments/stats"));
    const body = await json(res);
    expect(body.data.byCurrency.USD).toBe(1);
    expect(body.data.byCurrency.EUR).toBe(1);
  });

  test("calculates total revenue from completed payments only", async () => {
    await createAndProcess({ amount: 200 }); // completed
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", amount: 50 })); // pending

    const res = await handleRequest(get("/payments/stats"));
    const body = await json(res);
    expect(body.data.totalRevenue).toBe(200);
  });
});

describe("Payment Revenue", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("returns revenue breakdown by currency", async () => {
    await createAndProcess({ amount: 100, currency: "USD" });
    await createAndProcess({ orderId: "o2", amount: 200, currency: "EUR" });
    await createAndProcess({ orderId: "o3", amount: 50, currency: "USD" });

    const res = await handleRequest(get("/payments/revenue"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.byCurrency.USD).toBe(150);
    expect(body.data.byCurrency.EUR).toBe(200);
  });

  test("returns revenue breakdown by method", async () => {
    await createAndProcess({ amount: 100, method: "credit_card" });
    await createAndProcess({ orderId: "o2", amount: 200, method: "paypal" });

    const res = await handleRequest(get("/payments/revenue"));
    const body = await json(res);
    expect(body.data.byMethod.credit_card).toBe(100);
    expect(body.data.byMethod.paypal).toBe(200);
    expect(body.data.total).toBe(300);
  });

  test("excludes non-completed payments from revenue", async () => {
    await createAndProcess({ amount: 100 });
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", amount: 999 })); // pending

    const res = await handleRequest(get("/payments/revenue"));
    const body = await json(res);
    expect(body.data.total).toBe(100);
  });
});

describe("Payment Receipts", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("generates receipt for completed payment", async () => {
    const payment = await createAndProcess({ amount: 250, currency: "EUR" });
    const res = await handleRequest(get(`/payments/${payment.id}/receipt`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.receiptId).toMatch(/^RCP-/);
    expect(body.data.transactionRef).toBe(payment.transactionRef);
    expect(body.data.amount).toBe(250);
    expect(body.data.currency).toBe("EUR");
    expect(body.data.issuedAt).toBeDefined();
  });

  test("receipt includes order and user info", async () => {
    const payment = await createAndProcess({ orderId: "ord-55", userId: "usr-12" });
    const res = await handleRequest(get(`/payments/${payment.id}/receipt`));
    const body = await json(res);
    expect(body.data.orderId).toBe("ord-55");
    expect(body.data.userId).toBe("usr-12");
  });

  test("rejects receipt for pending payment", async () => {
    const createRes = await handleRequest(post("/payments", validPayment));
    const { data } = await json(createRes);

    const res = await handleRequest(get(`/payments/${data.id}/receipt`));
    expect(res.status).toBe(400);
  });

  test("returns 404 for receipt of non-existent payment", async () => {
    const res = await handleRequest(get("/payments/nonexistent/receipt"));
    expect(res.status).toBe(404);
  });
});

describe("Card Validation", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("validates a correct 16-digit card number", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "4111111111111111" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.valid).toBe(true);
  });

  test("validates card with spaces", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "4111 1111 1111 1111" }));
    const body = await json(res);
    expect(body.data.valid).toBe(true);
  });

  test("validates card with dashes", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "4111-1111-1111-1111" }));
    const body = await json(res);
    expect(body.data.valid).toBe(true);
  });

  test("rejects too-short card number", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "411111" }));
    const body = await json(res);
    expect(body.data.valid).toBe(false);
  });

  test("rejects card with letters", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "4111abcd11111111" }));
    const body = await json(res);
    expect(body.data.valid).toBe(false);
  });

  test("masks card number in response", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "4111111111111111" }));
    const body = await json(res);
    expect(body.data.cardNumber).toContain("*");
    expect(body.data.cardNumber).toEndWith("1111");
  });

  test("rejects empty card number", async () => {
    const res = await handleRequest(post("/payments/validate-card", { cardNumber: "" }));
    expect(res.status).toBe(400);
  });

  test("rejects missing card number", async () => {
    const res = await handleRequest(post("/payments/validate-card", {}));
    expect(res.status).toBe(400);
  });
});

describe("Payment Filtering", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("filters by userId", async () => {
    await handleRequest(post("/payments", { ...validPayment, userId: "user-a" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", userId: "user-b" }));

    const res = await handleRequest(get("/payments?userId=user-a"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].userId).toBe("user-a");
  });

  test("filters by orderId", async () => {
    await handleRequest(post("/payments", { ...validPayment, orderId: "ord-x" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "ord-y" }));

    const res = await handleRequest(get("/payments?orderId=ord-x"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].orderId).toBe("ord-x");
  });

  test("filters by currency", async () => {
    await handleRequest(post("/payments", { ...validPayment, currency: "JPY" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", currency: "USD" }));

    const res = await handleRequest(get("/payments?currency=JPY"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].currency).toBe("JPY");
  });

  test("filters by method", async () => {
    await handleRequest(post("/payments", { ...validPayment, method: "paypal" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", method: "bank_transfer" }));

    const res = await handleRequest(get("/payments?method=paypal"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].method).toBe("paypal");
  });

  test("gets payments by order endpoint", async () => {
    await handleRequest(post("/payments", { ...validPayment, orderId: "ord-multi" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "ord-multi", amount: 50 }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "ord-other" }));

    const res = await handleRequest(get("/payments/order/ord-multi"));
    const body = await json(res);
    expect(body.data).toHaveLength(2);
  });

  test("gets payments by user endpoint", async () => {
    await handleRequest(post("/payments", { ...validPayment, userId: "usr-multi" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "o2", userId: "usr-multi" }));
    await handleRequest(post("/payments", { ...validPayment, orderId: "o3", userId: "usr-other" }));

    const res = await handleRequest(get("/payments/user/usr-multi"));
    const body = await json(res);
    expect(body.data).toHaveLength(2);
  });

  test("returns empty array for user with no payments", async () => {
    const res = await handleRequest(get("/payments/user/nobody"));
    const body = await json(res);
    expect(body.data).toHaveLength(0);
  });
});
