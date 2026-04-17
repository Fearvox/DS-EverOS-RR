// Orders request handlers - pure function handleRequest(req: Request): Promise<Response>

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
  isPositiveInteger,
  isValidEnum,
  isArray,
  isObject,
  validate,
} from "../shared/validation";
import type { Order, OrderItem } from "../shared/types";
import { orderStore } from "./store";

const ORDER_STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"] as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

function calculateTotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function validateOrderItem(item: unknown): item is OrderItem {
  if (!isObject(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    isNonEmptyString(obj.productId) &&
    isNonEmptyString(obj.productName) &&
    isPositiveInteger(obj.quantity) &&
    isPositiveNumber(obj.unitPrice)
  );
}

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);
  const params = getQueryParams(req);

  // All routes start with /orders
  if (segments[0] !== "orders") {
    return errorResponse("Not found", 404);
  }

  // GET /orders/stats
  if (method === "GET" && segments[1] === "stats" && segments.length === 2) {
    const all = orderStore.getAll();
    const statusCounts = orderStore.getStatusCounts();
    const revenue = all
      .filter((o) => o.status !== "cancelled")
      .reduce((sum, o) => sum + o.total, 0);
    return jsonResponse({
      total: all.length,
      byStatus: statusCounts,
      revenue,
    });
  }

  // GET /orders/recent?hours=N
  if (method === "GET" && segments[1] === "recent" && segments.length === 2) {
    const hoursParam = params.get("hours");
    const hours = hoursParam ? Number(hoursParam) : 24;
    if (!Number.isFinite(hours) || hours <= 0) {
      return errorResponse("hours must be a positive number", 400);
    }
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const recent = orderStore.getOrdersByDateRange(cutoff, new Date().toISOString());
    return jsonResponse(recent);
  }

  // GET /orders/user/:userId
  if (method === "GET" && segments[1] === "user" && segments[2]) {
    const userId = segments[2];
    const orders = orderStore.findByUser(userId);
    return jsonResponse(orders);
  }

  // GET /orders - list with filters
  if (method === "GET" && segments.length === 1) {
    let orders = orderStore.getAll();

    const userId = params.get("userId");
    if (userId) {
      orders = orders.filter((o) => o.userId === userId);
    }

    const status = params.get("status");
    if (status) {
      if (!isValidEnum(status, ORDER_STATUSES)) {
        return errorResponse("Invalid status filter", 400);
      }
      orders = orders.filter((o) => o.status === status);
    }

    const page = Math.max(1, Number(params.get("page")) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 20));
    const total = orders.length;
    const start = (page - 1) * limit;
    const paged = orders.slice(start, start + limit);

    return metaResponse(paged, { total, page, limit });
  }

  // POST /orders - create order
  if (method === "POST" && segments.length === 1) {
    const body = await parseBody<{
      userId?: string;
      items?: unknown[];
      shippingAddress?: string;
    }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isNonEmptyString(body.userId), "userId", "userId is required"],
      [isArray(body.items), "items", "items must be an array"],
      [isNonEmptyString(body.shippingAddress), "shippingAddress", "shippingAddress is required"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    const items = body.items as unknown[];
    if (items.length === 0) {
      return errorResponse("Order must have at least one item", 400);
    }

    for (const item of items) {
      if (!validateOrderItem(item)) {
        return errorResponse("Each item must have productId, productName, quantity (positive integer), and unitPrice (positive number)", 400);
      }
    }

    const validItems = items as OrderItem[];
    const timestamp = now();
    const order: Order = {
      id: generateId(),
      userId: body.userId as string,
      items: validItems,
      status: "pending",
      total: calculateTotal(validItems),
      shippingAddress: body.shippingAddress as string,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    orderStore.create(order);
    return jsonResponse(order, 201);
  }

  // Routes with /orders/:id
  if (segments.length >= 2 && segments[1] !== "stats" && segments[1] !== "recent" && segments[1] !== "user") {
    const orderId = segments[1];

    // GET /orders/:id
    if (method === "GET" && segments.length === 2) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);
      return jsonResponse(order);
    }

    // PUT /orders/:id - update order (only pending)
    if (method === "PUT" && segments.length === 2) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);
      if (order.status !== "pending") {
        return errorResponse("Only pending orders can be modified", 400);
      }

      const body = await parseBody<{
        shippingAddress?: string;
        items?: unknown[];
      }>(req);
      if (!body) return errorResponse("Invalid JSON body", 400);

      const updates: Partial<Order> = { updatedAt: now() };

      if (body.shippingAddress !== undefined) {
        if (!isNonEmptyString(body.shippingAddress)) {
          return errorResponse("shippingAddress must be non-empty", 400);
        }
        updates.shippingAddress = body.shippingAddress;
      }

      if (body.items !== undefined) {
        if (!isArray(body.items) || body.items.length === 0) {
          return errorResponse("items must be a non-empty array", 400);
        }
        for (const item of body.items) {
          if (!validateOrderItem(item)) {
            return errorResponse("Each item must have productId, productName, quantity (positive integer), and unitPrice (positive number)", 400);
          }
        }
        updates.items = body.items as OrderItem[];
        updates.total = calculateTotal(updates.items);
      }

      const updated = orderStore.update(orderId, updates);
      return jsonResponse(updated);
    }

    // DELETE /orders/:id - cancel order (only pending/confirmed)
    if (method === "DELETE" && segments.length === 2) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);
      if (order.status !== "pending" && order.status !== "confirmed") {
        return errorResponse("Only pending or confirmed orders can be cancelled", 400);
      }
      const updated = orderStore.update(orderId, { status: "cancelled", updatedAt: now() });
      return jsonResponse(updated);
    }

    // PUT /orders/:id/status - transition status
    if (method === "PUT" && segments[2] === "status" && segments.length === 3) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);

      const body = await parseBody<{ status?: string }>(req);
      if (!body) return errorResponse("Invalid JSON body", 400);

      if (!isValidEnum(body.status, ORDER_STATUSES)) {
        return errorResponse("Invalid status value", 400);
      }

      const allowed = VALID_TRANSITIONS[order.status];
      if (!allowed || !allowed.includes(body.status)) {
        return errorResponse(
          `Cannot transition from '${order.status}' to '${body.status}'`,
          400
        );
      }

      const updated = orderStore.update(orderId, {
        status: body.status as Order["status"],
        updatedAt: now(),
      });
      return jsonResponse(updated);
    }

    // PUT /orders/:id/confirm - shortcut to confirm
    if (method === "PUT" && segments[2] === "confirm" && segments.length === 3) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);

      const allowed = VALID_TRANSITIONS[order.status];
      if (!allowed || !allowed.includes("confirmed")) {
        return errorResponse(
          `Cannot confirm order with status '${order.status}'`,
          400
        );
      }

      const updated = orderStore.update(orderId, {
        status: "confirmed",
        updatedAt: now(),
      });
      return jsonResponse(updated);
    }

    // POST /orders/:id/items - add item to order (only pending)
    if (method === "POST" && segments[2] === "items" && segments.length === 3) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);
      if (order.status !== "pending") {
        return errorResponse("Can only add items to pending orders", 400);
      }

      const body = await parseBody(req);
      if (!body || !validateOrderItem(body)) {
        return errorResponse(
          "Item must have productId, productName, quantity (positive integer), and unitPrice (positive number)",
          400
        );
      }

      const newItem = body as unknown as OrderItem;
      const updatedItems = [...order.items, newItem];
      const updated = orderStore.update(orderId, {
        items: updatedItems,
        total: calculateTotal(updatedItems),
        updatedAt: now(),
      });
      return jsonResponse(updated);
    }

    // DELETE /orders/:id/items/:productId - remove item (only pending)
    if (method === "DELETE" && segments[2] === "items" && segments[3] && segments.length === 4) {
      const order = orderStore.getById(orderId);
      if (!order) return errorResponse("Order not found", 404);
      if (order.status !== "pending") {
        return errorResponse("Can only remove items from pending orders", 400);
      }

      const productId = segments[3];
      const itemIndex = order.items.findIndex((i) => i.productId === productId);
      if (itemIndex === -1) {
        return errorResponse("Item not found in order", 404);
      }

      const updatedItems = order.items.filter((i) => i.productId !== productId);
      if (updatedItems.length === 0) {
        return errorResponse("Cannot remove the last item; cancel the order instead", 400);
      }

      const updated = orderStore.update(orderId, {
        items: updatedItems,
        total: calculateTotal(updatedItems),
        updatedAt: now(),
      });
      return jsonResponse(updated);
    }
  }

  return errorResponse("Not found", 404);
}
