import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { clearAllStores } from "../store";

const BASE = "http://localhost:3006";

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`);
}

async function json(res: Response) {
  return res.json();
}

function validNotification(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    type: "email",
    title: "Test Notification",
    message: "This is a test",
    ...overrides,
  };
}

describe("Notifications Business Logic", () => {
  beforeEach(() => {
    clearAllStores();
  });

  // === BULK SEND ===

  test("bulk sends to multiple users", async () => {
    const res = await handleRequest(
      post("/notifications/bulk-send", {
        userIds: ["user-1", "user-2", "user-3"],
        title: "System Update",
        message: "We have a new feature!",
        type: "push",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.sent).toBe(3);
    expect(body.data.notifications.length).toBe(3);
    expect(body.data.notifications[0].userId).toBe("user-1");
    expect(body.data.notifications[1].userId).toBe("user-2");
    expect(body.data.notifications[2].userId).toBe("user-3");
    expect(body.data.notifications.every((n: any) => n.type === "push")).toBe(true);
    expect(body.data.notifications.every((n: any) => n.status === "pending")).toBe(true);
  });

  test("bulk send creates retrievable notifications", async () => {
    await handleRequest(
      post("/notifications/bulk-send", {
        userIds: ["user-1", "user-2"],
        title: "Alert",
        message: "Check this out",
        type: "email",
      })
    );

    const res = await handleRequest(get("/notifications"));
    const body = await json(res);
    expect(body.meta.total).toBe(2);
  });

  test("bulk send rejects empty userIds", async () => {
    const res = await handleRequest(
      post("/notifications/bulk-send", {
        userIds: [],
        title: "T",
        message: "M",
        type: "email",
      })
    );
    expect(res.status).toBe(400);
  });

  test("bulk send rejects missing userIds", async () => {
    const res = await handleRequest(
      post("/notifications/bulk-send", {
        title: "T",
        message: "M",
        type: "email",
      })
    );
    expect(res.status).toBe(400);
  });

  test("bulk send rejects missing title", async () => {
    const res = await handleRequest(
      post("/notifications/bulk-send", {
        userIds: ["user-1"],
        message: "M",
        type: "email",
      })
    );
    expect(res.status).toBe(400);
  });

  test("bulk send rejects invalid type", async () => {
    const res = await handleRequest(
      post("/notifications/bulk-send", {
        userIds: ["user-1"],
        title: "T",
        message: "M",
        type: "fax",
      })
    );
    expect(res.status).toBe(400);
  });

  // === TEMPLATES ===

  test("creates notification from welcome template", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        variables: { name: "Alice" },
        userId: "user-1",
        type: "email",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.message).toBe("Welcome Alice!");
    expect(body.data.title).toBe("welcome");
    expect(body.data.metadata.templateName).toBe("welcome");
  });

  test("creates notification from order_confirmed template", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "order_confirmed",
        variables: { orderId: "ORD-123" },
        userId: "user-1",
        type: "push",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.message).toBe("Order ORD-123 confirmed");
  });

  test("creates notification from payment_received template", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "payment_received",
        variables: { amount: "$99.99" },
        userId: "user-1",
        type: "sms",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.message).toBe("Payment of $99.99 received");
  });

  test("template with missing variables leaves placeholders", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        variables: {},
        userId: "user-1",
        type: "email",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.message).toBe("Welcome {{name}}!");
  });

  test("template without variables object still works", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        userId: "user-1",
        type: "email",
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.message).toBe("Welcome {{name}}!");
  });

  test("rejects unknown template name", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "nonexistent",
        userId: "user-1",
        type: "email",
      })
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toContain("not found");
  });

  test("rejects template request without templateName", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        userId: "user-1",
        type: "email",
      })
    );
    expect(res.status).toBe(400);
  });

  test("rejects template request without userId", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        type: "email",
      })
    );
    expect(res.status).toBe(400);
  });

  test("rejects template request with invalid type", async () => {
    const res = await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        userId: "user-1",
        type: "pigeon",
      })
    );
    expect(res.status).toBe(400);
  });

  // === USER FILTERING ===

  test("filters by userId query param", async () => {
    await handleRequest(post("/notifications", validNotification({ userId: "user-1" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-2" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-1" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-3" })));

    const res = await handleRequest(get("/notifications?userId=user-1"));
    const body = await json(res);
    expect(body.meta.total).toBe(2);
    expect(body.data.every((n: any) => n.userId === "user-1")).toBe(true);
  });

  test("combines userId and type filters", async () => {
    await handleRequest(post("/notifications", validNotification({ userId: "user-1", type: "email" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-1", type: "sms" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-2", type: "email" })));

    const res = await handleRequest(get("/notifications?userId=user-1&type=email"));
    const body = await json(res);
    expect(body.meta.total).toBe(1);
    expect(body.data[0].userId).toBe("user-1");
    expect(body.data[0].type).toBe("email");
  });

  test("combines all three filters", async () => {
    await handleRequest(post("/notifications", validNotification({ userId: "user-1", type: "email" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-1", type: "email" })));

    const res = await handleRequest(get("/notifications?userId=user-1&type=email&status=pending"));
    const body = await json(res);
    expect(body.meta.total).toBe(2);
  });

  // === STATS / EDGE CASES ===

  test("empty list returns empty array with correct meta", async () => {
    const res = await handleRequest(get("/notifications"));
    const body = await json(res);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  test("pagination beyond results returns empty", async () => {
    await handleRequest(post("/notifications", validNotification()));

    const res = await handleRequest(get("/notifications?page=100&limit=10"));
    const body = await json(res);
    expect(body.data.length).toBe(0);
    expect(body.meta.total).toBe(1);
  });

  test("template notifications are stored and retrievable", async () => {
    await handleRequest(
      post("/notifications/template", {
        templateName: "welcome",
        variables: { name: "Bob" },
        userId: "user-1",
        type: "in_app",
      })
    );

    const res = await handleRequest(get("/notifications/user/user-1"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].message).toBe("Welcome Bob!");
    expect(body.data[0].type).toBe("in_app");
  });

  test("bulk send notifications appear in user endpoint", async () => {
    await handleRequest(
      post("/notifications/bulk-send", {
        userIds: ["user-1", "user-2"],
        title: "Bulk",
        message: "Hello all",
        type: "push",
      })
    );

    const res1 = await handleRequest(get("/notifications/user/user-1"));
    const body1 = await json(res1);
    expect(body1.data.length).toBe(1);

    const res2 = await handleRequest(get("/notifications/user/user-2"));
    const body2 = await json(res2);
    expect(body2.data.length).toBe(1);
  });
});
