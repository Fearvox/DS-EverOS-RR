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
import {
  isNonEmptyString,
  isPositiveNumber,
  isNonNegativeNumber,
  isNonNegativeInteger,
  isValidEnum,
  isArray,
  validate,
} from "../shared/validation";
import type { Product } from "../shared/types";
import { productStore } from "./store";

const PRODUCT_STATUSES = ["active", "inactive", "archived"] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);
  const params = getQueryParams(req);

  // segments: ["products", ...rest]
  if (segments[0] !== "products") {
    return errorResponse("Not found", 404);
  }

  const rest = segments.slice(1);

  // GET /products/categories
  if (method === "GET" && rest.length === 1 && rest[0] === "categories") {
    return handleGetCategories();
  }

  // GET /products/stats
  if (method === "GET" && rest.length === 1 && rest[0] === "stats") {
    return handleGetStats();
  }

  // GET /products/low-stock?threshold=N
  if (method === "GET" && rest.length === 1 && rest[0] === "low-stock") {
    const threshold = Number(params.get("threshold") || "10");
    return handleGetLowStock(threshold);
  }

  // GET /products/search?q=query
  if (method === "GET" && rest.length === 1 && rest[0] === "search") {
    const q = params.get("q") || "";
    return handleSearch(q);
  }

  // POST /products/bulk-price
  if (method === "POST" && rest.length === 1 && rest[0] === "bulk-price") {
    return handleBulkPrice(req);
  }

  // PUT /products/:id/stock
  if (method === "PUT" && rest.length === 2 && rest[1] === "stock") {
    return handleAdjustStock(req, rest[0]);
  }

  // PUT /products/:id/status
  if (method === "PUT" && rest.length === 2 && rest[1] === "status") {
    return handleChangeStatus(req, rest[0]);
  }

  // GET /products/:id
  if (method === "GET" && rest.length === 1) {
    return handleGetById(rest[0]);
  }

  // PUT /products/:id
  if (method === "PUT" && rest.length === 1) {
    return handleUpdate(req, rest[0]);
  }

  // DELETE /products/:id
  if (method === "DELETE" && rest.length === 1) {
    return handleDelete(rest[0]);
  }

  // GET /products
  if (method === "GET" && rest.length === 0) {
    return handleList(params);
  }

  // POST /products
  if (method === "POST" && rest.length === 0) {
    return handleCreate(req);
  }

  return errorResponse("Not found", 404);
}

function handleList(params: URLSearchParams): Response {
  let products = productStore.getAll();

  const category = params.get("category");
  if (category) {
    products = products.filter((p) => p.category === category);
  }

  const status = params.get("status");
  if (status) {
    products = products.filter((p) => p.status === status);
  }

  const minPrice = params.get("minPrice");
  if (minPrice) {
    const min = Number(minPrice);
    if (!Number.isNaN(min)) products = products.filter((p) => p.price >= min);
  }

  const maxPrice = params.get("maxPrice");
  if (maxPrice) {
    const max = Number(maxPrice);
    if (!Number.isNaN(max)) products = products.filter((p) => p.price <= max);
  }

  const search = params.get("search");
  if (search) {
    const lower = search.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower),
    );
  }

  const tag = params.get("tag");
  if (tag) {
    products = products.filter((p) => p.tags.includes(tag));
  }

  const total = products.length;
  const page = Math.max(1, Number(params.get("page") || "1"));
  const limit = Math.max(1, Math.min(100, Number(params.get("limit") || "20")));
  const start = (page - 1) * limit;
  const paged = products.slice(start, start + limit);

  return metaResponse(paged, { total, page, limit });
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseBody<Partial<Product>>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const errors = validate([
    [isNonEmptyString(body.name), "name", "Name is required"],
    [isNonEmptyString(body.description), "description", "Description is required"],
    [isPositiveNumber(body.price), "price", "Price must be a positive number"],
    [isNonNegativeInteger(body.stock), "stock", "Stock must be a non-negative integer"],
    [isNonEmptyString(body.category), "category", "Category is required"],
  ]);

  if (errors.length > 0) {
    return errorResponse(errors.map((e) => e.message).join("; "), 400);
  }

  const timestamp = now();
  const product: Product = {
    id: generateId(),
    name: body.name!,
    description: body.description!,
    price: body.price!,
    stock: body.stock!,
    category: body.category!,
    status: isValidEnum(body.status, PRODUCT_STATUSES) ? body.status : "active",
    tags: isArray(body.tags) ? (body.tags as string[]).filter((t) => typeof t === "string") : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const created = productStore.create(product);
  return jsonResponse(created, 201);
}

function handleGetById(id: string): Response {
  const product = productStore.getById(id);
  if (!product) return errorResponse("Product not found", 404);
  return jsonResponse(product);
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const existing = productStore.getById(id);
  if (!existing) return errorResponse("Product not found", 404);

  const body = await parseBody<Partial<Product>>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const updates: Partial<Product> = { updatedAt: now() };

  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name)) return errorResponse("Name must be a non-empty string", 400);
    updates.name = body.name;
  }
  if (body.description !== undefined) {
    if (!isNonEmptyString(body.description)) return errorResponse("Description must be a non-empty string", 400);
    updates.description = body.description;
  }
  if (body.price !== undefined) {
    if (!isPositiveNumber(body.price)) return errorResponse("Price must be a positive number", 400);
    updates.price = body.price;
  }
  if (body.stock !== undefined) {
    if (!isNonNegativeInteger(body.stock)) return errorResponse("Stock must be a non-negative integer", 400);
    updates.stock = body.stock;
  }
  if (body.category !== undefined) {
    if (!isNonEmptyString(body.category)) return errorResponse("Category must be a non-empty string", 400);
    updates.category = body.category;
  }
  if (body.status !== undefined) {
    if (!isValidEnum(body.status, PRODUCT_STATUSES)) return errorResponse("Invalid status", 400);
    updates.status = body.status;
  }
  if (body.tags !== undefined) {
    if (!isArray(body.tags)) return errorResponse("Tags must be an array", 400);
    updates.tags = (body.tags as string[]).filter((t) => typeof t === "string");
  }

  const updated = productStore.update(id, updates);
  return jsonResponse(updated);
}

function handleDelete(id: string): Response {
  const exists = productStore.has(id);
  if (!exists) return errorResponse("Product not found", 404);
  productStore.delete(id);
  return jsonResponse({ deleted: true });
}

async function handleAdjustStock(req: Request, id: string): Promise<Response> {
  const product = productStore.getById(id);
  if (!product) return errorResponse("Product not found", 404);

  const body = await parseBody<{ delta: number }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (typeof body.delta !== "number" || !Number.isInteger(body.delta)) {
    return errorResponse("Delta must be an integer", 400);
  }

  const updated = productStore.adjustStock(id, body.delta);
  if (!updated) return errorResponse("Stock cannot go below zero", 400);

  return jsonResponse(updated);
}

async function handleChangeStatus(req: Request, id: string): Promise<Response> {
  const product = productStore.getById(id);
  if (!product) return errorResponse("Product not found", 404);

  const body = await parseBody<{ status: string }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isValidEnum(body.status, PRODUCT_STATUSES)) {
    return errorResponse("Invalid status. Must be: active, inactive, archived", 400);
  }

  const updated = productStore.update(id, { status: body.status, updatedAt: now() } as Partial<Product>);
  return jsonResponse(updated);
}

function handleGetCategories(): Response {
  const categories = productStore.getCategories();
  return jsonResponse(categories);
}

function handleGetStats(): Response {
  const all = productStore.getAll();
  const total = all.length;
  const byStatus = {
    active: all.filter((p) => p.status === "active").length,
    inactive: all.filter((p) => p.status === "inactive").length,
    archived: all.filter((p) => p.status === "archived").length,
  };
  const avgPrice = total > 0 ? all.reduce((sum, p) => sum + p.price, 0) / total : 0;
  const totalStockValue = all.reduce((sum, p) => sum + p.price * p.stock, 0);

  return jsonResponse({ total, byStatus, avgPrice, totalStockValue });
}

function handleGetLowStock(threshold: number): Response {
  const products = productStore.getLowStock(threshold);
  return jsonResponse(products);
}

function handleSearch(q: string): Response {
  if (!q.trim()) return jsonResponse([]);
  const results = productStore.searchByName(q);
  return jsonResponse(results);
}

async function handleBulkPrice(req: Request): Promise<Response> {
  const body = await parseBody<{ productIds: string[]; percentage: number }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isArray(body.productIds) || body.productIds.length === 0) {
    return errorResponse("productIds must be a non-empty array", 400);
  }

  if (typeof body.percentage !== "number" || !Number.isFinite(body.percentage)) {
    return errorResponse("percentage must be a finite number", 400);
  }

  const updated: Product[] = [];
  const notFound: string[] = [];

  for (const pid of body.productIds) {
    const product = productStore.getById(pid as string);
    if (!product) {
      notFound.push(pid as string);
      continue;
    }
    const newPrice = Math.round(product.price * (1 + body.percentage / 100) * 100) / 100;
    if (newPrice <= 0) continue;
    const result = productStore.update(pid as string, { price: newPrice, updatedAt: now() } as Partial<Product>);
    if (result) updated.push(result);
  }

  return jsonResponse({ updated: updated.length, notFound, products: updated });
}
