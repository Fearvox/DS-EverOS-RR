import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { productStore } from "../store";

const BASE = "http://localhost:3003";

function post(path: string, body: unknown) {
  return handleRequest(new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function get(path: string) {
  return handleRequest(new Request(`${BASE}${path}`));
}

function put(path: string, body: unknown) {
  return handleRequest(new Request(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function json(res: Response) {
  return res.json();
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await post("/products", {
    name: "Widget",
    description: "A fine widget",
    price: 29.99,
    stock: 100,
    category: "gadgets",
    tags: ["sale"],
    ...overrides,
  });
  const body = await json(res);
  return body.data;
}

describe("Stock Management", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("PUT /products/:id/stock increases stock", async () => {
    const product = await createProduct({ stock: 50 });
    const res = await put(`/products/${product.id}/stock`, { delta: 20 });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.stock).toBe(70);
  });

  test("PUT /products/:id/stock decreases stock", async () => {
    const product = await createProduct({ stock: 50 });
    const res = await put(`/products/${product.id}/stock`, { delta: -20 });
    const body = await json(res);
    expect(body.data.stock).toBe(30);
  });

  test("PUT /products/:id/stock rejects stock below zero", async () => {
    const product = await createProduct({ stock: 10 });
    const res = await put(`/products/${product.id}/stock`, { delta: -20 });
    expect(res.status).toBe(400);
  });

  test("PUT /products/:id/stock returns 404 for missing product", async () => {
    const res = await put("/products/nonexistent/stock", { delta: 5 });
    expect(res.status).toBe(404);
  });

  test("PUT /products/:id/stock rejects non-integer delta", async () => {
    const product = await createProduct();
    const res = await put(`/products/${product.id}/stock`, { delta: 5.5 });
    expect(res.status).toBe(400);
  });

  test("PUT /products/:id/stock rejects invalid body", async () => {
    const product = await createProduct();
    const res = await handleRequest(new Request(`${BASE}/products/${product.id}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    }));
    expect(res.status).toBe(400);
  });
});

describe("Status Management", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("PUT /products/:id/status changes status", async () => {
    const product = await createProduct();
    const res = await put(`/products/${product.id}/status`, { status: "inactive" });
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.status).toBe("inactive");
  });

  test("PUT /products/:id/status to archived", async () => {
    const product = await createProduct();
    const res = await put(`/products/${product.id}/status`, { status: "archived" });
    const body = await json(res);
    expect(body.data.status).toBe("archived");
  });

  test("PUT /products/:id/status rejects invalid status", async () => {
    const product = await createProduct();
    const res = await put(`/products/${product.id}/status`, { status: "deleted" });
    expect(res.status).toBe(400);
  });

  test("PUT /products/:id/status returns 404 for missing", async () => {
    const res = await put("/products/nonexistent/status", { status: "active" });
    expect(res.status).toBe(404);
  });
});

describe("Categories", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("GET /products/categories returns categories with counts", async () => {
    await createProduct({ category: "electronics" });
    await createProduct({ category: "electronics" });
    await createProduct({ category: "clothing" });
    const res = await get("/products/categories");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    const electronics = body.data.find((c: any) => c.category === "electronics");
    const clothing = body.data.find((c: any) => c.category === "clothing");
    expect(electronics.count).toBe(2);
    expect(clothing.count).toBe(1);
  });

  test("GET /products/categories returns empty when no products", async () => {
    const res = await get("/products/categories");
    const body = await json(res);
    expect(body.data).toEqual([]);
  });
});

describe("Statistics", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("GET /products/stats returns statistics", async () => {
    await createProduct({ price: 100, stock: 10 });
    await createProduct({ price: 200, stock: 5, status: "inactive" });
    const res = await get("/products/stats");
    const body = await json(res);
    expect(body.data.total).toBe(2);
    expect(body.data.byStatus.active).toBe(1);
    expect(body.data.byStatus.inactive).toBe(1);
    expect(body.data.avgPrice).toBe(150);
    expect(body.data.totalStockValue).toBe(100 * 10 + 200 * 5); // 2000
  });

  test("GET /products/stats with no products", async () => {
    const res = await get("/products/stats");
    const body = await json(res);
    expect(body.data.total).toBe(0);
    expect(body.data.avgPrice).toBe(0);
    expect(body.data.totalStockValue).toBe(0);
  });
});

describe("Low Stock", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("GET /products/low-stock returns products below threshold", async () => {
    await createProduct({ name: "Low", stock: 3 });
    await createProduct({ name: "High", stock: 500 });
    const res = await get("/products/low-stock?threshold=10");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Low");
  });

  test("GET /products/low-stock excludes inactive products", async () => {
    await createProduct({ name: "Low Inactive", stock: 3, status: "inactive" });
    await createProduct({ name: "Low Active", stock: 5 });
    const res = await get("/products/low-stock?threshold=10");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Low Active");
  });

  test("GET /products/low-stock with default threshold", async () => {
    await createProduct({ stock: 5 });
    const res = await get("/products/low-stock");
    const body = await json(res);
    expect(body.data.length).toBe(1); // default threshold is 10
  });
});

describe("Bulk Price Update", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("POST /products/bulk-price increases prices by percentage", async () => {
    const p1 = await createProduct({ name: "A", price: 100 });
    const p2 = await createProduct({ name: "B", price: 200 });
    const res = await post("/products/bulk-price", {
      productIds: [p1.id, p2.id],
      percentage: 10,
    });
    const body = await json(res);
    expect(body.data.updated).toBe(2);
    expect(body.data.products[0].price).toBe(110);
    expect(body.data.products[1].price).toBe(220);
  });

  test("POST /products/bulk-price decreases prices", async () => {
    const p1 = await createProduct({ price: 100 });
    const res = await post("/products/bulk-price", {
      productIds: [p1.id],
      percentage: -20,
    });
    const body = await json(res);
    expect(body.data.products[0].price).toBe(80);
  });

  test("POST /products/bulk-price reports not found IDs", async () => {
    const p1 = await createProduct({ price: 100 });
    const res = await post("/products/bulk-price", {
      productIds: [p1.id, "nonexistent"],
      percentage: 10,
    });
    const body = await json(res);
    expect(body.data.updated).toBe(1);
    expect(body.data.notFound).toEqual(["nonexistent"]);
  });

  test("POST /products/bulk-price rejects empty productIds", async () => {
    const res = await post("/products/bulk-price", { productIds: [], percentage: 10 });
    expect(res.status).toBe(400);
  });

  test("POST /products/bulk-price rejects invalid percentage", async () => {
    const p1 = await createProduct();
    const res = await post("/products/bulk-price", {
      productIds: [p1.id],
      percentage: "ten",
    });
    expect(res.status).toBe(400);
  });

  test("POST /products/bulk-price rejects invalid body", async () => {
    const res = await handleRequest(new Request(`${BASE}/products/bulk-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    }));
    expect(res.status).toBe(400);
  });
});
