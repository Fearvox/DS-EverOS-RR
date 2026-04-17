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

function del(path: string) {
  return handleRequest(new Request(`${BASE}${path}`, { method: "DELETE" }));
}

async function json(res: Response) {
  return res.json();
}

const validProduct = {
  name: "Widget",
  description: "A fine widget",
  price: 29.99,
  stock: 100,
  category: "gadgets",
  tags: ["sale", "new"],
};

describe("Products CRUD", () => {
  beforeEach(() => {
    productStore.clear();
  });

  test("POST /products creates a product", async () => {
    const res = await post("/products", validProduct);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Widget");
    expect(body.data.price).toBe(29.99);
    expect(body.data.stock).toBe(100);
    expect(body.data.category).toBe("gadgets");
    expect(body.data.status).toBe("active");
    expect(body.data.tags).toEqual(["sale", "new"]);
    expect(body.data.id).toBeDefined();
    expect(body.data.createdAt).toBeDefined();
  });

  test("POST /products with custom status", async () => {
    const res = await post("/products", { ...validProduct, status: "inactive" });
    const body = await json(res);
    expect(body.data.status).toBe("inactive");
  });

  test("POST /products rejects missing name", async () => {
    const res = await post("/products", { ...validProduct, name: "" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
  });

  test("POST /products rejects missing description", async () => {
    const res = await post("/products", { ...validProduct, description: "" });
    expect(res.status).toBe(400);
  });

  test("POST /products rejects negative price", async () => {
    const res = await post("/products", { ...validProduct, price: -5 });
    expect(res.status).toBe(400);
  });

  test("POST /products rejects negative stock", async () => {
    const res = await post("/products", { ...validProduct, stock: -1 });
    expect(res.status).toBe(400);
  });

  test("POST /products rejects invalid JSON", async () => {
    const res = await handleRequest(new Request(`${BASE}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }));
    expect(res.status).toBe(400);
  });

  test("POST /products defaults tags to empty array", async () => {
    const { tags, ...noTags } = validProduct;
    const res = await post("/products", noTags);
    const body = await json(res);
    expect(body.data.tags).toEqual([]);
  });

  test("GET /products/:id returns product", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await get(`/products/${created.id}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(created.id);
    expect(body.data.name).toBe("Widget");
  });

  test("GET /products/:id returns 404 for missing", async () => {
    const res = await get("/products/nonexistent");
    expect(res.status).toBe(404);
  });

  test("PUT /products/:id updates product", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await put(`/products/${created.id}`, { name: "Super Widget", price: 39.99 });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.name).toBe("Super Widget");
    expect(body.data.price).toBe(39.99);
    expect(body.data.stock).toBe(100); // unchanged
  });

  test("PUT /products/:id returns 404 for missing", async () => {
    const res = await put("/products/nonexistent", { name: "X" });
    expect(res.status).toBe(404);
  });

  test("PUT /products/:id rejects invalid price", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await put(`/products/${created.id}`, { price: -10 });
    expect(res.status).toBe(400);
  });

  test("PUT /products/:id rejects invalid stock", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await put(`/products/${created.id}`, { stock: -5 });
    expect(res.status).toBe(400);
  });

  test("PUT /products/:id updates tags", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await put(`/products/${created.id}`, { tags: ["premium"] });
    const body = await json(res);
    expect(body.data.tags).toEqual(["premium"]);
  });

  test("DELETE /products/:id deletes product", async () => {
    const createRes = await post("/products", validProduct);
    const { data: created } = await json(createRes);
    const res = await del(`/products/${created.id}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.deleted).toBe(true);
    // Verify deleted
    const getRes = await get(`/products/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  test("DELETE /products/:id returns 404 for missing", async () => {
    const res = await del("/products/nonexistent");
    expect(res.status).toBe(404);
  });

  test("GET /products returns empty list initially", async () => {
    const res = await get("/products");
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  test("GET /products returns all products", async () => {
    await post("/products", validProduct);
    await post("/products", { ...validProduct, name: "Gizmo" });
    const res = await get("/products");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(2);
  });

  test("unknown route returns 404", async () => {
    const res = await get("/unknown");
    expect(res.status).toBe(404);
  });
});
