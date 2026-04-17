import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { orderStore } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3004${path}`, opts);
}

async function json(r: Response) {
  return r.json();
}

const sampleItem = {
  productId: "prod-1",
  productName: "Widget",
  quantity: 1,
  unitPrice: 10.0,
};

async function createOrder() {
  const res = await handleRequest(
    req("POST", "/orders", {
      userId: "user-1",
      items: [sampleItem],
      shippingAddress: "123 Main St",
    })
  );
  return (await json(res)).data;
}

async function transitionTo(orderId: string, status: string) {
  return handleRequest(req("PUT", `/orders/${orderId}/status`, { status }));
}

describe("Status Transitions - Valid", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("pending -> confirmed", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "confirmed");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("confirmed");
  });

  test("confirmed -> processing", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    const res = await transitionTo(order.id, "processing");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("processing");
  });

  test("processing -> shipped", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    const res = await transitionTo(order.id, "shipped");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("shipped");
  });

  test("shipped -> delivered", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    await transitionTo(order.id, "shipped");
    const res = await transitionTo(order.id, "delivered");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("delivered");
  });

  test("pending -> cancelled", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "cancelled");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("cancelled");
  });

  test("confirmed -> cancelled", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    const res = await transitionTo(order.id, "cancelled");
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("cancelled");
  });

  test("full lifecycle: pending -> confirmed -> processing -> shipped -> delivered", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    await transitionTo(order.id, "shipped");
    const res = await transitionTo(order.id, "delivered");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("delivered");
    expect(body.data.updatedAt).toBeDefined();
  });
});

describe("Status Transitions - Invalid", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("pending -> processing (skip confirmed)", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "processing");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("Cannot transition");
  });

  test("pending -> shipped (skip multiple)", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "shipped");
    expect(res.status).toBe(400);
  });

  test("pending -> delivered (skip all)", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "delivered");
    expect(res.status).toBe(400);
  });

  test("confirmed -> shipped (skip processing)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    const res = await transitionTo(order.id, "shipped");
    expect(res.status).toBe(400);
  });

  test("confirmed -> delivered (skip processing+shipped)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    const res = await transitionTo(order.id, "delivered");
    expect(res.status).toBe(400);
  });

  test("processing -> cancelled (too late)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    const res = await transitionTo(order.id, "cancelled");
    expect(res.status).toBe(400);
  });

  test("shipped -> cancelled (too late)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    await transitionTo(order.id, "shipped");
    const res = await transitionTo(order.id, "cancelled");
    expect(res.status).toBe(400);
  });

  test("delivered -> anything (terminal state)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    await transitionTo(order.id, "processing");
    await transitionTo(order.id, "shipped");
    await transitionTo(order.id, "delivered");

    for (const s of ["pending", "confirmed", "processing", "shipped", "cancelled"]) {
      const res = await transitionTo(order.id, s);
      expect(res.status).toBe(400);
    }
  });

  test("cancelled -> anything (terminal state)", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "cancelled");

    for (const s of ["pending", "confirmed", "processing", "shipped", "delivered"]) {
      const res = await transitionTo(order.id, s);
      expect(res.status).toBe(400);
    }
  });

  test("invalid status value", async () => {
    const order = await createOrder();
    const res = await transitionTo(order.id, "bogus");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("Invalid status");
  });

  test("status transition on missing order", async () => {
    const res = await transitionTo("nonexistent", "confirmed");
    expect(res.status).toBe(404);
  });

  test("status transition with invalid JSON", async () => {
    const order = await createOrder();
    const r = new Request(`http://localhost:3004/orders/${order.id}/status`, {
      method: "PUT",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleRequest(r);
    expect(res.status).toBe(400);
  });
});

describe("Confirm Shortcut", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("PUT /orders/:id/confirm - confirms pending order", async () => {
    const order = await createOrder();
    const res = await handleRequest(req("PUT", `/orders/${order.id}/confirm`));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("confirmed");
  });

  test("PUT /orders/:id/confirm - rejects non-pending", async () => {
    const order = await createOrder();
    await transitionTo(order.id, "confirmed");
    const res = await handleRequest(req("PUT", `/orders/${order.id}/confirm`));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("Cannot confirm");
  });

  test("PUT /orders/:id/confirm - 404 for missing order", async () => {
    const res = await handleRequest(req("PUT", "/orders/nonexistent/confirm"));
    expect(res.status).toBe(404);
  });
});
