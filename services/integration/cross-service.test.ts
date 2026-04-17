import { describe, test, expect } from "bun:test";
import { generateId, now } from "../shared/http";
import { MemoryStore } from "../shared/store";
import type { User, Product, Order, Payment, Notification, AnalyticsEvent, SearchDocument } from "../shared/types";

// End-to-end simulation using shared stores
describe("E2E: Complete Purchase Flow", () => {
  const users = new MemoryStore<User>();
  const products = new MemoryStore<Product>();
  const orders = new MemoryStore<Order>();
  const payments = new MemoryStore<Payment>();
  const notifications = new MemoryStore<Notification>();
  const analytics = new MemoryStore<AnalyticsEvent>();

  test("user registers → browses → orders → pays → gets notified", () => {
    // 1. Register user
    const user = users.create({
      id: generateId(), email: "e2e@example.com", name: "E2E User",
      role: "user", status: "active", createdAt: now(), updatedAt: now(),
    });
    expect(user.status).toBe("active");

    // 2. Products exist in catalog
    const product = products.create({
      id: generateId(), name: "Premium Widget", description: "A fine widget",
      price: 49.99, stock: 100, category: "widgets", status: "active",
      tags: ["premium", "widget"], createdAt: now(), updatedAt: now(),
    });

    // 3. Create order
    const orderTotal = product.price * 2;
    const order = orders.create({
      id: generateId(), userId: user.id,
      items: [{ productId: product.id, productName: product.name, quantity: 2, unitPrice: product.price }],
      status: "pending", total: orderTotal, shippingAddress: "123 E2E St",
      createdAt: now(), updatedAt: now(),
    });
    expect(order.total).toBeCloseTo(99.98, 2);

    // 4. Reduce stock
    const newStock = product.stock - 2;
    products.update(product.id, { stock: newStock, updatedAt: now() });
    expect(products.getById(product.id)!.stock).toBe(98);

    // 5. Confirm order
    orders.update(order.id, { status: "confirmed", updatedAt: now() });

    // 6. Process payment
    const payment = payments.create({
      id: generateId(), orderId: order.id, userId: user.id,
      amount: orderTotal, currency: "USD", method: "credit_card",
      status: "completed", transactionRef: `TXN-${generateId().slice(0, 8).toUpperCase()}`,
      createdAt: now(), updatedAt: now(),
    });
    expect(payment.status).toBe("completed");

    // 7. Update order to processing
    orders.update(order.id, { status: "processing", updatedAt: now() });
    expect(orders.getById(order.id)!.status).toBe("processing");

    // 8. Send confirmation notification
    const notif = notifications.create({
      id: generateId(), userId: user.id, type: "email",
      title: "Order Confirmed", message: `Order ${order.id} confirmed. Payment received.`,
      status: "sent", metadata: { orderId: order.id }, createdAt: now(),
    });
    expect(notif.status).toBe("sent");

    // 9. Track analytics
    analytics.create({
      id: generateId(), eventType: "purchase", userId: user.id,
      properties: { orderId: order.id, amount: orderTotal }, timestamp: now(),
    });

    // Verify full chain
    expect(users.count()).toBe(1);
    expect(orders.count()).toBe(1);
    expect(payments.count()).toBe(1);
    expect(notifications.count()).toBe(1);
    expect(analytics.count()).toBe(1);
  });
});

describe("E2E: Search and Discovery", () => {
  const searchDocs = new MemoryStore<SearchDocument>();

  test("index products and search", () => {
    const productData = [
      { name: "Blue Widget", category: "widgets", tags: ["blue", "widget"] },
      { name: "Red Gadget", category: "gadgets", tags: ["red", "gadget"] },
      { name: "Blue Gadget Pro", category: "gadgets", tags: ["blue", "gadget", "pro"] },
    ];

    for (const p of productData) {
      searchDocs.create({
        id: generateId(), collection: "products",
        content: { name: p.name, category: p.category },
        text: `${p.name} ${p.category}`.toLowerCase(),
        tags: p.tags, indexedAt: now(),
      });
    }

    // Search for "blue"
    const blueResults = searchDocs.find((d) => d.text.includes("blue"));
    expect(blueResults).toHaveLength(2);

    // Search for "gadget"
    const gadgetResults = searchDocs.find((d) => d.text.includes("gadget"));
    expect(gadgetResults).toHaveLength(2);

    // Filter by tag
    const proResults = searchDocs.find((d) => d.tags.includes("pro"));
    expect(proResults).toHaveLength(1);
    expect(proResults[0].content.name).toBe("Blue Gadget Pro");
  });
});

describe("E2E: Refund Flow", () => {
  test("complete order → refund → notification", () => {
    const payments = new MemoryStore<Payment>();
    const notifications = new MemoryStore<Notification>();
    const userId = generateId();
    const orderId = generateId();

    // Original payment
    const payment = payments.create({
      id: generateId(), orderId, userId, amount: 200, currency: "EUR",
      method: "paypal", status: "completed",
      transactionRef: `TXN-${generateId().slice(0, 8).toUpperCase()}`,
      createdAt: now(), updatedAt: now(),
    });

    // Process refund
    const refund = payments.create({
      id: generateId(), orderId, userId, amount: -200, currency: "EUR",
      method: "paypal", status: "refunded",
      transactionRef: `REF-${generateId().slice(0, 8).toUpperCase()}`,
      createdAt: now(), updatedAt: now(),
    });

    const orderPayments = payments.find((p) => p.orderId === orderId);
    expect(orderPayments).toHaveLength(2);
    const netAmount = orderPayments.reduce((sum, p) => sum + p.amount, 0);
    expect(netAmount).toBe(0);

    // Refund notification
    notifications.create({
      id: generateId(), userId, type: "email",
      title: "Refund Processed", message: `Refund of EUR 200 processed for order ${orderId}`,
      status: "sent", metadata: { orderId, refundId: refund.id },
      createdAt: now(),
    });

    expect(notifications.count()).toBe(1);
  });
});
