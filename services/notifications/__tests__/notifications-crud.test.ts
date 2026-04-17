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

function put(path: string, body: Record<string, unknown>): Request {
  return new Request(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del(path: string): Request {
  return new Request(`${BASE}${path}`, { method: "DELETE" });
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

describe("Notifications CRUD", () => {
  beforeEach(() => {
    clearAllStores();
  });

  // === CREATE ===

  test("creates a notification successfully", async () => {
    const res = await handleRequest(post("/notifications", validNotification()));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe("user-1");
    expect(body.data.type).toBe("email");
    expect(body.data.title).toBe("Test Notification");
    expect(body.data.message).toBe("This is a test");
    expect(body.data.status).toBe("pending");
    expect(body.data.id).toBeDefined();
    expect(body.data.createdAt).toBeDefined();
  });

  test("creates notification with metadata", async () => {
    const res = await handleRequest(
      post("/notifications", validNotification({ metadata: { priority: "high", category: "alert" } }))
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.metadata.priority).toBe("high");
    expect(body.data.metadata.category).toBe("alert");
  });

  test("creates notification with each valid type", async () => {
    for (const type of ["email", "sms", "push", "in_app"]) {
      const res = await handleRequest(post("/notifications", validNotification({ type })));
      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.data.type).toBe(type);
    }
  });

  test("rejects notification without userId", async () => {
    const res = await handleRequest(post("/notifications", { type: "email", title: "T", message: "M" }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("User ID");
  });

  test("rejects notification without title", async () => {
    const res = await handleRequest(post("/notifications", { userId: "u1", type: "email", message: "M" }));
    expect(res.status).toBe(400);
  });

  test("rejects notification without message", async () => {
    const res = await handleRequest(post("/notifications", { userId: "u1", type: "email", title: "T" }));
    expect(res.status).toBe(400);
  });

  test("rejects notification with invalid type", async () => {
    const res = await handleRequest(post("/notifications", validNotification({ type: "telegram" })));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("Type");
  });

  test("rejects notification with invalid JSON", async () => {
    const req = new Request(`${BASE}/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(400);
  });

  // === READ ===

  test("gets a notification by id", async () => {
    const createRes = await handleRequest(post("/notifications", validNotification()));
    const { data: created } = await json(createRes);

    const res = await handleRequest(get(`/notifications/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(created.id);
    expect(body.data.title).toBe("Test Notification");
  });

  test("returns 404 for non-existent notification", async () => {
    const res = await handleRequest(get("/notifications/non-existent-id"));
    expect(res.status).toBe(404);
  });

  test("lists all notifications", async () => {
    await handleRequest(post("/notifications", validNotification()));
    await handleRequest(post("/notifications", validNotification({ userId: "user-2", title: "Second" })));

    const res = await handleRequest(get("/notifications"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(2);
  });

  test("lists notifications with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await handleRequest(post("/notifications", validNotification({ title: `Notif ${i}` })));
    }

    const res = await handleRequest(get("/notifications?page=2&limit=2"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.page).toBe(2);
    expect(body.meta.limit).toBe(2);
  });

  test("filters notifications by userId", async () => {
    await handleRequest(post("/notifications", validNotification({ userId: "user-1" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-2" })));
    await handleRequest(post("/notifications", validNotification({ userId: "user-1" })));

    const res = await handleRequest(get("/notifications?userId=user-1"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((n: any) => n.userId === "user-1")).toBe(true);
  });

  test("filters notifications by type", async () => {
    await handleRequest(post("/notifications", validNotification({ type: "email" })));
    await handleRequest(post("/notifications", validNotification({ type: "sms" })));
    await handleRequest(post("/notifications", validNotification({ type: "email" })));

    const res = await handleRequest(get("/notifications?type=email"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
  });

  test("filters notifications by status", async () => {
    await handleRequest(post("/notifications", validNotification()));
    await handleRequest(post("/notifications", validNotification()));

    const res = await handleRequest(get("/notifications?status=pending"));
    const body = await json(res);
    expect(body.data.length).toBe(2);

    const res2 = await handleRequest(get("/notifications?status=sent"));
    const body2 = await json(res2);
    expect(body2.data.length).toBe(0);
  });

  // === UPDATE ===

  test("updates a notification", async () => {
    const createRes = await handleRequest(post("/notifications", validNotification()));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/notifications/${created.id}`, { title: "Updated Title" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.title).toBe("Updated Title");
    expect(body.data.message).toBe("This is a test"); // unchanged
  });

  test("updates notification type", async () => {
    const createRes = await handleRequest(post("/notifications", validNotification()));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/notifications/${created.id}`, { type: "push" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.type).toBe("push");
  });

  test("rejects update with invalid type", async () => {
    const createRes = await handleRequest(post("/notifications", validNotification()));
    const { data: created } = await json(createRes);

    const res = await handleRequest(put(`/notifications/${created.id}`, { type: "carrier_pigeon" }));
    expect(res.status).toBe(400);
  });

  test("returns 404 when updating non-existent notification", async () => {
    const res = await handleRequest(put("/notifications/fake-id", { title: "Nope" }));
    expect(res.status).toBe(404);
  });

  // === DELETE ===

  test("deletes a notification", async () => {
    const createRes = await handleRequest(post("/notifications", validNotification()));
    const { data: created } = await json(createRes);

    const res = await handleRequest(del(`/notifications/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.deleted).toBe(true);

    const getRes = await handleRequest(get(`/notifications/${created.id}`));
    expect(getRes.status).toBe(404);
  });

  test("returns 404 when deleting non-existent notification", async () => {
    const res = await handleRequest(del("/notifications/fake-id"));
    expect(res.status).toBe(404);
  });

  // === ROUTING ===

  test("returns 404 for unknown base path", async () => {
    const res = await handleRequest(get("/unknown"));
    expect(res.status).toBe(404);
  });
});
