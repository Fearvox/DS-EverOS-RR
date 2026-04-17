import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { orderStore } from "../store";
import { generateId, now } from "../../shared/http";
import type { Order } from "../../shared/types";

function req(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3004${path}`, opts);
}

async function json(r: Response) {
  return r.json();
}

const item1 = { productId: "prod-1", productName: "Widget", quantity: 2, unitPrice: 10.0 };
const item2 = { productId: "prod-2", productName: "Gadget", quantity: 1, unitPrice: 25.0 };
const item3 = { productId: "prod-3", productName: "Doohickey", quantity: 3, unitPrice: 5.0 };

async function createOrder(overrides: Record<string, unknown> = {}) {
  const res = await handleRequest(
    req("POST", "/orders", {
      userId: "user-1",
      items: [item1],
      shippingAddress: "123 Main St",
      ...overrides,
    })
  );
  return (await json(res)).data;
}

describe("Item Management", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("POST /orders/:id/items - adds item to pending order", async () => {
    const order = await createOrder();
    const res = await handleRequest(req("POST", `/orders/${order.id}/items`, item2));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.total).toBe(45.0); // 2*10 + 1*25
  });

  test("POST /orders/:id/items - rejects on non-pending order", async () => {
    const order = await createOrder();
    await handleRequest(req("PUT", `/orders/${order.id}/status`, { status: "confirmed" }));
    const res = await handleRequest(req("POST", `/orders/${order.id}/items`, item2));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("pending");
  });

  test("POST /orders/:id/items - rejects invalid item", async () => {
    const order = await createOrder();
    const res = await handleRequest(
      req("POST", `/orders/${order.id}/items`, { productId: "p1" })
    );
    expect(res.status).toBe(400);
  });

  test("POST /orders/:id/items - 404 for missing order", async () => {
    const res = await handleRequest(req("POST", "/orders/nonexistent/items", item2));
    expect(res.status).toBe(404);
  });

  test("DELETE /orders/:id/items/:productId - removes item", async () => {
    const order = await createOrder({ items: [item1, item2] });
    const res = await handleRequest(
      req("DELETE", `/orders/${order.id}/items/prod-1`)
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].productId).toBe("prod-2");
    expect(body.data.total).toBe(25.0);
  });

  test("DELETE /orders/:id/items/:productId - rejects removing last item", async () => {
    const order = await createOrder();
    const res = await handleRequest(
      req("DELETE", `/orders/${order.id}/items/prod-1`)
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("last item");
  });

  test("DELETE /orders/:id/items/:productId - rejects on non-pending", async () => {
    const order = await createOrder({ items: [item1, item2] });
    await handleRequest(req("PUT", `/orders/${order.id}/status`, { status: "confirmed" }));
    const res = await handleRequest(
      req("DELETE", `/orders/${order.id}/items/prod-1`)
    );
    expect(res.status).toBe(400);
  });

  test("DELETE /orders/:id/items/:productId - 404 for missing product", async () => {
    const order = await createOrder();
    const res = await handleRequest(
      req("DELETE", `/orders/${order.id}/items/nonexistent`)
    );
    expect(res.status).toBe(404);
  });

  test("DELETE /orders/:id/items/:productId - 404 for missing order", async () => {
    const res = await handleRequest(req("DELETE", "/orders/nonexistent/items/prod-1"));
    expect(res.status).toBe(404);
  });
});

describe("User Orders", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("GET /orders/user/:userId - returns user orders", async () => {
    await createOrder({ userId: "user-1" });
    await createOrder({ userId: "user-1" });
    await createOrder({ userId: "user-2" });

    const res = await handleRequest(req("GET", "/orders/user/user-1"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(2);
    expect(body.data.every((o: any) => o.userId === "user-1")).toBe(true);
  });

  test("GET /orders/user/:userId - returns empty for unknown user", async () => {
    const res = await handleRequest(req("GET", "/orders/user/unknown"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(0);
  });
});

describe("Order Statistics", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("GET /orders/stats - returns correct stats", async () => {
    await createOrder();
    await createOrder();
    const order3 = await createOrder();
    // Cancel one
    await handleRequest(req("PUT", `/orders/${order3.id}/status`, { status: "cancelled" }));

    const res = await handleRequest(req("GET", "/orders/stats"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.total).toBe(3);
    expect(body.data.byStatus.pending).toBe(2);
    expect(body.data.byStatus.cancelled).toBe(1);
    // Revenue excludes cancelled
    expect(body.data.revenue).toBe(40.0); // 2 * 20.0
  });

  test("GET /orders/stats - empty store returns zeros", async () => {
    const res = await handleRequest(req("GET", "/orders/stats"));
    const body = await json(res);
    expect(body.data.total).toBe(0);
    expect(body.data.revenue).toBe(0);
    expect(body.data.byStatus).toEqual({});
  });
});

describe("Recent Orders", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("GET /orders/recent - returns recent orders (default 24h)", async () => {
    await createOrder();
    const res = await handleRequest(req("GET", "/orders/recent"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(1);
  });

  test("GET /orders/recent?hours=1 - filters by hours", async () => {
    // Create an order now
    await createOrder();

    // Manually insert an old order
    const oldOrder: Order = {
      id: generateId(),
      userId: "user-old",
      items: [item1],
      status: "pending",
      total: 20.0,
      shippingAddress: "Old St",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };
    orderStore.create(oldOrder);

    const res = await handleRequest(req("GET", "/orders/recent?hours=1"));
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].userId).toBe("user-1");
  });

  test("GET /orders/recent?hours=invalid - rejects invalid hours", async () => {
    const res = await handleRequest(req("GET", "/orders/recent?hours=abc"));
    expect(res.status).toBe(400);
  });

  test("GET /orders/recent?hours=-1 - rejects negative hours", async () => {
    const res = await handleRequest(req("GET", "/orders/recent?hours=-1"));
    expect(res.status).toBe(400);
  });
});

describe("Store Methods", () => {
  beforeEach(() => {
    orderStore.clear();
  });

  test("findByUser returns correct orders", () => {
    const ts = now();
    orderStore.create({
      id: "o1", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "A", createdAt: ts, updatedAt: ts,
    });
    orderStore.create({
      id: "o2", userId: "u2", items: [item1], status: "pending",
      total: 20, shippingAddress: "B", createdAt: ts, updatedAt: ts,
    });
    expect(orderStore.findByUser("u1")).toHaveLength(1);
  });

  test("findByStatus returns correct orders", () => {
    const ts = now();
    orderStore.create({
      id: "o1", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "A", createdAt: ts, updatedAt: ts,
    });
    orderStore.create({
      id: "o2", userId: "u1", items: [item1], status: "confirmed",
      total: 20, shippingAddress: "B", createdAt: ts, updatedAt: ts,
    });
    expect(orderStore.findByStatus("pending")).toHaveLength(1);
    expect(orderStore.findByStatus("confirmed")).toHaveLength(1);
  });

  test("calculateUserTotal sums correctly", () => {
    const ts = now();
    orderStore.create({
      id: "o1", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "A", createdAt: ts, updatedAt: ts,
    });
    orderStore.create({
      id: "o2", userId: "u1", items: [item2], status: "confirmed",
      total: 25, shippingAddress: "B", createdAt: ts, updatedAt: ts,
    });
    expect(orderStore.calculateUserTotal("u1")).toBe(45);
    expect(orderStore.calculateUserTotal("unknown")).toBe(0);
  });

  test("getStatusCounts returns correct counts", () => {
    const ts = now();
    orderStore.create({
      id: "o1", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "A", createdAt: ts, updatedAt: ts,
    });
    orderStore.create({
      id: "o2", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "B", createdAt: ts, updatedAt: ts,
    });
    orderStore.create({
      id: "o3", userId: "u1", items: [item1], status: "shipped",
      total: 20, shippingAddress: "C", createdAt: ts, updatedAt: ts,
    });
    const counts = orderStore.getStatusCounts();
    expect(counts.pending).toBe(2);
    expect(counts.shipped).toBe(1);
  });

  test("getOrdersByDateRange filters correctly", () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    const ts = now();
    orderStore.create({
      id: "o1", userId: "u1", items: [item1], status: "pending",
      total: 20, shippingAddress: "A", createdAt: ts, updatedAt: ts,
    });
    const results = orderStore.getOrdersByDateRange(past, future);
    expect(results).toHaveLength(1);
    const empty = orderStore.getOrdersByDateRange(future, future);
    expect(empty).toHaveLength(0);
  });
});
