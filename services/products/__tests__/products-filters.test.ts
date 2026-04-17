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

async function json(res: Response) {
  return res.json();
}

async function seedProducts() {
  await post("/products", { name: "Laptop", description: "Powerful laptop", price: 999, stock: 50, category: "electronics", tags: ["tech", "sale"] });
  await post("/products", { name: "Phone", description: "Smart phone", price: 599, stock: 200, category: "electronics", tags: ["tech", "mobile"] });
  await post("/products", { name: "T-Shirt", description: "Cotton t-shirt", price: 25, stock: 500, category: "clothing", tags: ["apparel", "sale"] });
  await post("/products", { name: "Jeans", description: "Denim jeans", price: 60, stock: 300, category: "clothing", tags: ["apparel"] });
  await post("/products", { name: "Coffee Mug", description: "Ceramic mug for coffee lovers", price: 15, stock: 1000, category: "kitchen", tags: ["home", "sale"] });
}

describe("Products Filtering", () => {
  beforeEach(async () => {
    productStore.clear();
    await seedProducts();
  });

  test("filter by category", async () => {
    const res = await get("/products?category=electronics");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((p: any) => p.category === "electronics")).toBe(true);
  });

  test("filter by status", async () => {
    const res = await get("/products?status=active");
    const body = await json(res);
    expect(body.data.length).toBe(5);
  });

  test("filter by minPrice", async () => {
    const res = await get("/products?minPrice=100");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((p: any) => p.price >= 100)).toBe(true);
  });

  test("filter by maxPrice", async () => {
    const res = await get("/products?maxPrice=30");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((p: any) => p.price <= 30)).toBe(true);
  });

  test("filter by price range", async () => {
    const res = await get("/products?minPrice=20&maxPrice=100");
    const body = await json(res);
    expect(body.data.length).toBe(2); // T-Shirt (25) and Jeans (60)
  });

  test("filter by search in name", async () => {
    const res = await get("/products?search=laptop");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Laptop");
  });

  test("filter by search in description", async () => {
    const res = await get("/products?search=coffee lovers");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Coffee Mug");
  });

  test("filter by tag", async () => {
    const res = await get("/products?tag=sale");
    const body = await json(res);
    expect(body.data.length).toBe(3);
  });

  test("combine category and tag filters", async () => {
    const res = await get("/products?category=electronics&tag=mobile");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Phone");
  });

  test("combine category and price filters", async () => {
    const res = await get("/products?category=electronics&maxPrice=700");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Phone");
  });

  test("no results for non-matching filter", async () => {
    const res = await get("/products?category=furniture");
    const body = await json(res);
    expect(body.data.length).toBe(0);
    expect(body.meta.total).toBe(0);
  });
});

describe("Products Pagination", () => {
  beforeEach(async () => {
    productStore.clear();
    await seedProducts();
  });

  test("default pagination returns all within limit", async () => {
    const res = await get("/products");
    const body = await json(res);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(20);
    expect(body.data.length).toBe(5);
    expect(body.meta.total).toBe(5);
  });

  test("pagination with limit=2", async () => {
    const res = await get("/products?limit=2");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.limit).toBe(2);
  });

  test("pagination page 2", async () => {
    const res = await get("/products?limit=2&page=2");
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.page).toBe(2);
  });

  test("pagination page 3 with limit=2 returns 1 item", async () => {
    const res = await get("/products?limit=2&page=3");
    const body = await json(res);
    expect(body.data.length).toBe(1);
  });

  test("pagination beyond data returns empty", async () => {
    const res = await get("/products?limit=2&page=10");
    const body = await json(res);
    expect(body.data.length).toBe(0);
  });
});

describe("Products Search Endpoint", () => {
  beforeEach(async () => {
    productStore.clear();
    await seedProducts();
  });

  test("GET /products/search?q= searches name", async () => {
    const res = await get("/products/search?q=laptop");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Laptop");
  });

  test("GET /products/search?q= searches description", async () => {
    const res = await get("/products/search?q=ceramic");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Coffee Mug");
  });

  test("GET /products/search?q= searches tags", async () => {
    const res = await get("/products/search?q=mobile");
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Phone");
  });

  test("GET /products/search?q= with empty query returns empty", async () => {
    const res = await get("/products/search?q=");
    const body = await json(res);
    expect(body.data).toEqual([]);
  });

  test("GET /products/search?q= case insensitive", async () => {
    const res = await get("/products/search?q=LAPTOP");
    const body = await json(res);
    expect(body.data.length).toBe(1);
  });
});
