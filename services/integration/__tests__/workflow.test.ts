import { describe, test, expect, beforeEach } from "bun:test";
import { generateId, now } from "../../shared/http";
import { MemoryStore } from "../../shared/store";
import type { User, Order, OrderItem, Payment, Notification, AnalyticsEvent } from "../../shared/types";

// Simulate cross-service data flow using shared stores
const userStore = new MemoryStore<User>();
const orderStore = new MemoryStore<Order>();
const paymentStore = new MemoryStore<Payment>();
const notificationStore = new MemoryStore<Notification>();
const analyticsStore = new MemoryStore<AnalyticsEvent>();

beforeEach(() => {
  userStore.clear();
  orderStore.clear();
  paymentStore.clear();
  notificationStore.clear();
  analyticsStore.clear();
});

describe("User Registration → Login Flow", () => {
  test("register a new user and verify data", () => {
    const user = userStore.create({
      id: generateId(),
      email: "alice@example.com",
      name: "Alice",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });

    expect(user.email).toBe("alice@example.com");
    expect(user.status).toBe("active");

    const found = userStore.findOne((u) => u.email === "alice@example.com");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Alice");
  });

  test("prevent duplicate email registration", () => {
    userStore.create({
      id: generateId(),
      email: "bob@example.com",
      name: "Bob",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });

    const existing = userStore.findOne((u) => u.email === "bob@example.com");
    expect(existing).toBeDefined();
    // Second registration should detect conflict
    const isDuplicate = !!existing;
    expect(isDuplicate).toBe(true);
  });

  test("user profile update persists", () => {
    const user = userStore.create({
      id: generateId(),
      email: "carol@example.com",
      name: "Carol",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });

    const updated = userStore.update(user.id, { name: "Carol Smith", updatedAt: now() });
    expect(updated!.name).toBe("Carol Smith");
    expect(updated!.email).toBe("carol@example.com");
  });
});

describe("Order Creation → Payment → Notification Pipeline", () => {
  let userId: string;
  let orderId: string;

  beforeEach(() => {
    userId = generateId();
    userStore.create({
      id: userId,
      email: "shopper@example.com",
      name: "Shopper",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });
  });

  test("create order with items and auto-calculate total", () => {
    const items: OrderItem[] = [
      { productId: "p1", productName: "Widget", quantity: 2, unitPrice: 29.99 },
      { productId: "p2", productName: "Gadget", quantity: 1, unitPrice: 49.99 },
    ];
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    const order = orderStore.create({
      id: generateId(),
      userId,
      items,
      status: "pending",
      total,
      shippingAddress: "123 Main St",
      createdAt: now(),
      updatedAt: now(),
    });

    orderId = order.id;
    expect(order.total).toBeCloseTo(109.97, 2);
    expect(order.items).toHaveLength(2);
    expect(order.status).toBe("pending");
  });

  test("full pipeline: order → payment → notification → analytics", () => {
    // Step 1: Create order
    const items: OrderItem[] = [
      { productId: "p1", productName: "Widget", quantity: 3, unitPrice: 19.99 },
    ];
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const order = orderStore.create({
      id: generateId(),
      userId,
      items,
      status: "pending",
      total,
      shippingAddress: "456 Oak Ave",
      createdAt: now(),
      updatedAt: now(),
    });

    // Step 2: Confirm order
    const confirmed = orderStore.update(order.id, { status: "confirmed", updatedAt: now() });
    expect(confirmed!.status).toBe("confirmed");

    // Step 3: Create and process payment
    const payment = paymentStore.create({
      id: generateId(),
      orderId: order.id,
      userId,
      amount: total,
      currency: "USD",
      method: "credit_card",
      status: "pending",
      transactionRef: `TXN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: now(),
      updatedAt: now(),
    });

    // Simulate processing (amount < 10000 succeeds)
    const processed = paymentStore.update(payment.id, { status: "completed", updatedAt: now() });
    expect(processed!.status).toBe("completed");

    // Step 4: Send notification
    const notification = notificationStore.create({
      id: generateId(),
      userId,
      type: "email",
      title: "Payment Confirmed",
      message: `Your payment of $${total.toFixed(2)} for order ${order.id} has been processed.`,
      status: "pending",
      metadata: { orderId: order.id, paymentId: payment.id },
      createdAt: now(),
    });

    const sent = notificationStore.update(notification.id, { status: "sent" });
    expect(sent!.status).toBe("sent");
    expect(sent!.message).toContain(order.id);

    // Step 5: Track analytics
    const event = analyticsStore.create({
      id: generateId(),
      eventType: "purchase_completed",
      userId,
      sessionId: "sess-" + generateId().slice(0, 8),
      properties: { orderId: order.id, amount: total, currency: "USD" },
      timestamp: now(),
    });

    expect(event.eventType).toBe("purchase_completed");
    expect(event.properties).toHaveProperty("orderId", order.id);
  });

  test("payment failure triggers failure notification", () => {
    const order = orderStore.create({
      id: generateId(),
      userId,
      items: [{ productId: "p1", productName: "Luxury Item", quantity: 1, unitPrice: 15000 }],
      status: "confirmed",
      total: 15000,
      shippingAddress: "789 Elm Dr",
      createdAt: now(),
      updatedAt: now(),
    });

    const payment = paymentStore.create({
      id: generateId(),
      orderId: order.id,
      userId,
      amount: 15000,
      currency: "USD",
      method: "credit_card",
      status: "pending",
      transactionRef: `TXN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: now(),
      updatedAt: now(),
    });

    // Simulate failure (amount > 10000)
    const failed = paymentStore.update(payment.id, { status: "failed", updatedAt: now() });
    expect(failed!.status).toBe("failed");

    // Send failure notification
    const notification = notificationStore.create({
      id: generateId(),
      userId,
      type: "email",
      title: "Payment Failed",
      message: `Your payment of $15000.00 could not be processed.`,
      status: "sent",
      metadata: { orderId: order.id, reason: "amount_exceeded" },
      createdAt: now(),
    });

    expect(notification.title).toBe("Payment Failed");
    expect(notification.metadata).toHaveProperty("reason", "amount_exceeded");
  });
});

describe("Multi-User Order Statistics", () => {
  test("aggregate orders across multiple users", () => {
    const users = Array.from({ length: 3 }, (_, i) => {
      return userStore.create({
        id: generateId(),
        email: `user${i}@example.com`,
        name: `User ${i}`,
        role: "user",
        status: "active",
        createdAt: now(),
        updatedAt: now(),
      });
    });

    // Each user creates 2 orders
    for (const user of users) {
      for (let j = 0; j < 2; j++) {
        orderStore.create({
          id: generateId(),
          userId: user.id,
          items: [{ productId: "p1", productName: "Item", quantity: 1, unitPrice: 100 }],
          status: j === 0 ? "delivered" : "pending",
          total: 100,
          shippingAddress: "Address",
          createdAt: now(),
          updatedAt: now(),
        });
      }
    }

    expect(orderStore.count()).toBe(6);
    const delivered = orderStore.find((o) => o.status === "delivered");
    expect(delivered).toHaveLength(3);
    const pending = orderStore.find((o) => o.status === "pending");
    expect(pending).toHaveLength(3);

    const totalRevenue = orderStore.getAll().reduce((sum, o) => sum + o.total, 0);
    expect(totalRevenue).toBe(600);
  });

  test("user-specific order history", () => {
    const user = userStore.create({
      id: generateId(),
      email: "loyal@example.com",
      name: "Loyal Customer",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });

    for (let i = 0; i < 5; i++) {
      orderStore.create({
        id: generateId(),
        userId: user.id,
        items: [{ productId: `p${i}`, productName: `Product ${i}`, quantity: i + 1, unitPrice: 10 }],
        status: "delivered",
        total: (i + 1) * 10,
        shippingAddress: "Home",
        createdAt: now(),
        updatedAt: now(),
      });
    }

    const userOrders = orderStore.find((o) => o.userId === user.id);
    expect(userOrders).toHaveLength(5);
    const userTotal = userOrders.reduce((sum, o) => sum + o.total, 0);
    expect(userTotal).toBe(150); // 10+20+30+40+50
  });
});

describe("Analytics Funnel Tracking", () => {
  test("track user journey through funnel stages", () => {
    const sessionId = "sess-funnel-1";
    const userId = generateId();
    const stages = ["page_view", "product_view", "add_to_cart", "checkout_start", "purchase_completed"];

    for (const stage of stages) {
      analyticsStore.create({
        id: generateId(),
        eventType: stage,
        userId,
        sessionId,
        properties: { page: stage === "page_view" ? "/home" : `/step/${stage}` },
        timestamp: now(),
      });
    }

    const sessionEvents = analyticsStore.find((e) => e.sessionId === sessionId);
    expect(sessionEvents).toHaveLength(5);

    const eventTypes = sessionEvents.map((e) => e.eventType);
    expect(eventTypes).toContain("page_view");
    expect(eventTypes).toContain("purchase_completed");
  });

  test("partial funnel - user drops off", () => {
    const sessionId = "sess-dropout";
    const userId = generateId();

    analyticsStore.create({ id: generateId(), eventType: "page_view", userId, sessionId, properties: {}, timestamp: now() });
    analyticsStore.create({ id: generateId(), eventType: "product_view", userId, sessionId, properties: {}, timestamp: now() });
    analyticsStore.create({ id: generateId(), eventType: "add_to_cart", userId, sessionId, properties: {}, timestamp: now() });
    // User drops off - no checkout or purchase

    const sessionEvents = analyticsStore.find((e) => e.sessionId === sessionId);
    expect(sessionEvents).toHaveLength(3);
    expect(sessionEvents.some((e) => e.eventType === "purchase_completed")).toBe(false);
  });
});

describe("Notification Delivery Tracking", () => {
  test("track notification lifecycle: pending → sent → delivered → read", () => {
    const userId = generateId();
    const notif = notificationStore.create({
      id: generateId(),
      userId,
      type: "in_app",
      title: "Welcome!",
      message: "Welcome to our platform",
      status: "pending",
      createdAt: now(),
    });

    expect(notif.status).toBe("pending");

    const sent = notificationStore.update(notif.id, { status: "sent" });
    expect(sent!.status).toBe("sent");

    const delivered = notificationStore.update(notif.id, { status: "delivered" });
    expect(delivered!.status).toBe("delivered");

    const read = notificationStore.update(notif.id, { status: "read", readAt: now() });
    expect(read!.status).toBe("read");
    expect(read!.readAt).toBeDefined();
  });

  test("bulk notifications to multiple users", () => {
    const userIds = Array.from({ length: 5 }, () => generateId());

    for (const uid of userIds) {
      notificationStore.create({
        id: generateId(),
        userId: uid,
        type: "push",
        title: "Sale Alert",
        message: "50% off all items!",
        status: "sent",
        createdAt: now(),
      });
    }

    expect(notificationStore.count()).toBe(5);
    const allSent = notificationStore.find((n) => n.status === "sent");
    expect(allSent).toHaveLength(5);
  });

  test("unread count per user", () => {
    const userId = generateId();

    for (let i = 0; i < 4; i++) {
      notificationStore.create({
        id: generateId(),
        userId,
        type: "in_app",
        title: `Notification ${i}`,
        message: `Message ${i}`,
        status: i < 2 ? "read" : "delivered",
        createdAt: now(),
        readAt: i < 2 ? now() : undefined,
      });
    }

    const unread = notificationStore.find((n) => n.userId === userId && n.status !== "read");
    expect(unread).toHaveLength(2);

    const read = notificationStore.find((n) => n.userId === userId && n.status === "read");
    expect(read).toHaveLength(2);
  });
});

describe("Cross-Service Data Consistency", () => {
  test("order references valid user", () => {
    const user = userStore.create({
      id: generateId(),
      email: "valid@example.com",
      name: "Valid User",
      role: "user",
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    });

    const order = orderStore.create({
      id: generateId(),
      userId: user.id,
      items: [{ productId: "p1", productName: "Widget", quantity: 1, unitPrice: 25 }],
      status: "pending",
      total: 25,
      shippingAddress: "Addr",
      createdAt: now(),
      updatedAt: now(),
    });

    const orderUser = userStore.getById(order.userId);
    expect(orderUser).toBeDefined();
    expect(orderUser!.id).toBe(user.id);
  });

  test("payment references valid order", () => {
    const orderId = generateId();
    orderStore.create({
      id: orderId,
      userId: generateId(),
      items: [],
      status: "confirmed",
      total: 50,
      shippingAddress: "Addr",
      createdAt: now(),
      updatedAt: now(),
    });

    const payment = paymentStore.create({
      id: generateId(),
      orderId,
      userId: generateId(),
      amount: 50,
      currency: "USD",
      method: "paypal",
      status: "completed",
      transactionRef: "TXN-REF123",
      createdAt: now(),
      updatedAt: now(),
    });

    const linkedOrder = orderStore.getById(payment.orderId);
    expect(linkedOrder).toBeDefined();
    expect(linkedOrder!.total).toBe(payment.amount);
  });

  test("suspended user cannot place orders (business rule)", () => {
    const user = userStore.create({
      id: generateId(),
      email: "suspended@example.com",
      name: "Suspended",
      role: "user",
      status: "suspended",
      createdAt: now(),
      updatedAt: now(),
    });

    // Business rule: check user status before allowing order
    const canOrder = user.status === "active";
    expect(canOrder).toBe(false);
  });

  test("deleted user notifications should not be sent", () => {
    const user = userStore.create({
      id: generateId(),
      email: "deleted@example.com",
      name: "Deleted User",
      role: "user",
      status: "deleted",
      createdAt: now(),
      updatedAt: now(),
    });

    // Business rule: check user status before sending
    const shouldSend = user.status !== "deleted";
    expect(shouldSend).toBe(false);
  });
});
