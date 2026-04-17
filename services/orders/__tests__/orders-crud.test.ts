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
  quantity: 2,
  unitPrice: 10.5,
};

const sampleItem2 = {
  productId: "prod-2",
  productName: "Gadget",
  quantity: 1,
  unitPrice: 25.0,
};

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    items: [sampleItem],
    shippingAddress: "123 Main St",
    ...overrides,
  };
}

describe("Orders CRUD", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("POST /orders - creates order with auto-calculated total", async () => {
    const res = await handleRequest(req("POST", "/orders", createPayload()));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe("user-1");
    expect(body.data.status).toBe("pending");
    expect(body.data.total).toBe(21.0); // 2 * 10.5
    expect(body.data.items).toHaveLength(1);
    expect(body.data.id).toBeDefined();
    expect(body.data.createdAt).toBeDefined();
  });

  test("POST /orders - multiple items total calculation", async () => {
    const res = await handleRequest(
      req("POST", "/orders", createPayload({ items: [sampleItem, sampleItem2] }))
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.total).toBe(46.0); // 2*10.5 + 1*25.0
    expect(body.data.items).toHaveLength(2);
  });

  test("POST /orders - rejects empty items", async () => {
    const res = await handleRequest(req("POST", "/orders", createPayload({ items: [] })));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("at least one item");
  });

  test("POST /orders - rejects missing userId", async () => {
    const res = await handleRequest(
      req("POST", "/orders", { items: [sampleItem], shippingAddress: "123 Main St" })
    );
    expect(res.status).toBe(400);
  });

  test("POST /orders - rejects invalid item (missing fields)", async () => {
    const res = await handleRequest(
      req("POST", "/orders", createPayload({ items: [{ productId: "p1" }] }))
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("item");
  });

  test("POST /orders - rejects invalid item (negative quantity)", async () => {
    const res = await handleRequest(
      req("POST", "/orders", createPayload({ items: [{ ...sampleItem, quantity: -1 }] }))
    );
    expect(res.status).toBe(400);
  });

  test("POST /orders - rejects invalid JSON", async () => {
    const r = new Request("http://localhost:3004/orders", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleRequest(r);
    expect(res.status).toBe(400);
  });

  test("GET /orders/:id - returns existing order", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;

    const res = await handleRequest(req("GET", `/orders/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(created.id);
  });

  test("GET /orders/:id - returns 404 for missing", async () => {
    const res = await handleRequest(req("GET", "/orders/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("GET /orders - lists all orders", async () => {
    await handleRequest(req("POST", "/orders", createPayload()));
    await handleRequest(req("POST", "/orders", createPayload({ userId: "user-2" })));

    const res = await handleRequest(req("GET", "/orders"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  test("GET /orders?userId - filters by user", async () => {
    await handleRequest(req("POST", "/orders", createPayload()));
    await handleRequest(req("POST", "/orders", createPayload({ userId: "user-2" })));

    const res = await handleRequest(req("GET", "/orders?userId=user-1"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].userId).toBe("user-1");
  });

  test("GET /orders?status - filters by status", async () => {
    await handleRequest(req("POST", "/orders", createPayload()));
    const res = await handleRequest(req("GET", "/orders?status=pending"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
  });

  test("GET /orders?status - rejects invalid status", async () => {
    const res = await handleRequest(req("GET", "/orders?status=bogus"));
    expect(res.status).toBe(400);
  });

  test("GET /orders - pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await handleRequest(req("POST", "/orders", createPayload()));
    }
    const res = await handleRequest(req("GET", "/orders?page=2&limit=2"));
    const body = await json(res);
    expect(body.data).toHaveLength(2);
    expect(body.meta.page).toBe(2);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.total).toBe(5);
  });

  test("PUT /orders/:id - updates pending order", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;

    const res = await handleRequest(
      req("PUT", `/orders/${created.id}`, { shippingAddress: "456 Oak Ave" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.shippingAddress).toBe("456 Oak Ave");
  });

  test("PUT /orders/:id - updates items and recalculates total", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;

    const res = await handleRequest(
      req("PUT", `/orders/${created.id}`, { items: [sampleItem2] })
    );
    const body = await json(res);
    expect(body.data.total).toBe(25.0);
    expect(body.data.items).toHaveLength(1);
  });

  test("PUT /orders/:id - rejects update on non-pending", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;
    // Confirm order first
    await handleRequest(req("PUT", `/orders/${created.id}/status`, { status: "confirmed" }));

    const res = await handleRequest(
      req("PUT", `/orders/${created.id}`, { shippingAddress: "new" })
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("pending");
  });

  test("DELETE /orders/:id - cancels pending order", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;

    const res = await handleRequest(req("DELETE", `/orders/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("cancelled");
  });

  test("DELETE /orders/:id - cancels confirmed order", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;
    await handleRequest(req("PUT", `/orders/${created.id}/status`, { status: "confirmed" }));

    const res = await handleRequest(req("DELETE", `/orders/${created.id}`));
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("cancelled");
  });

  test("DELETE /orders/:id - rejects cancel on processing order", async () => {
    const createRes = await handleRequest(req("POST", "/orders", createPayload()));
    const created = (await json(createRes)).data;
    await handleRequest(req("PUT", `/orders/${created.id}/status`, { status: "confirmed" }));
    await handleRequest(req("PUT", `/orders/${created.id}/status`, { status: "processing" }));

    const res = await handleRequest(req("DELETE", `/orders/${created.id}`));
    expect(res.status).toBe(400);
  });

  test("DELETE /orders/:id - 404 for missing order", async () => {
    const res = await handleRequest(req("DELETE", "/orders/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("unknown route returns 404", async () => {
    const res = await handleRequest(req("GET", "/unknown"));
    expect(res.status).toBe(404);
  });
});
