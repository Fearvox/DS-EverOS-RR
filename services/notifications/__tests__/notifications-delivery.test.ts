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

function put(path: string, body: Record<string, unknown> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

async function createNotification(overrides: Record<string, unknown> = {}) {
  const res = await handleRequest(post("/notifications", validNotification(overrides)));
  const body = await json(res);
  return body.data;
}

describe("Notifications Delivery", () => {
  beforeEach(() => {
    clearAllStores();
  });

  // === SEND ===

  test("sends a notification (simulated)", async () => {
    const n = await createNotification();
    expect(n.status).toBe("pending");

    const res = await handleRequest(post(`/notifications/${n.id}/send`, {}));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("sent");
  });

  test("returns 404 when sending non-existent notification", async () => {
    const res = await handleRequest(post("/notifications/fake-id/send", {}));
    expect(res.status).toBe(404);
  });

  test("rejects sending already sent notification", async () => {
    const n = await createNotification();
    await handleRequest(post(`/notifications/${n.id}/send`, {}));

    const res = await handleRequest(post(`/notifications/${n.id}/send`, {}));
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toContain("already sent");
  });

  test("rejects sending already delivered notification", async () => {
    const n = await createNotification();
    // Manually set to delivered via update
    await handleRequest(put(`/notifications/${n.id}`, { status: "delivered" }));

    const res = await handleRequest(post(`/notifications/${n.id}/send`, {}));
    expect(res.status).toBe(409);
  });

  // === MARK AS READ ===

  test("marks a notification as read", async () => {
    const n = await createNotification();

    const res = await handleRequest(put(`/notifications/${n.id}/read`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("read");
    expect(body.data.readAt).toBeDefined();
    expect(typeof body.data.readAt).toBe("string");
  });

  test("marks a sent notification as read", async () => {
    const n = await createNotification();
    await handleRequest(post(`/notifications/${n.id}/send`, {}));

    const res = await handleRequest(put(`/notifications/${n.id}/read`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("read");
    expect(body.data.readAt).toBeDefined();
  });

  test("returns 404 when marking non-existent notification as read", async () => {
    const res = await handleRequest(put("/notifications/fake-id/read"));
    expect(res.status).toBe(404);
  });

  // === UNREAD TRACKING ===

  test("gets unread count and list for user", async () => {
    await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-2" });

    const res = await handleRequest(get("/notifications/user/user-1/unread"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.userId).toBe("user-1");
    expect(body.data.unreadCount).toBe(2);
    expect(body.data.notifications.length).toBe(2);
  });

  test("unread count decreases after marking as read", async () => {
    const n1 = await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-1" });

    await handleRequest(put(`/notifications/${n1.id}/read`));

    const res = await handleRequest(get("/notifications/user/user-1/unread"));
    const body = await json(res);
    expect(body.data.unreadCount).toBe(1);
  });

  test("unread count is zero for user with no notifications", async () => {
    const res = await handleRequest(get("/notifications/user/user-999/unread"));
    const body = await json(res);
    expect(body.data.unreadCount).toBe(0);
    expect(body.data.notifications.length).toBe(0);
  });

  // === MARK ALL READ ===

  test("marks all notifications as read for a user", async () => {
    await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-2" }); // should not be affected

    const res = await handleRequest(put("/notifications/user/user-1/read-all"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.userId).toBe("user-1");
    expect(body.data.markedAsRead).toBe(3);

    // Verify unread count is now 0
    const unreadRes = await handleRequest(get("/notifications/user/user-1/unread"));
    const unreadBody = await json(unreadRes);
    expect(unreadBody.data.unreadCount).toBe(0);

    // Verify user-2 is unaffected
    const user2Res = await handleRequest(get("/notifications/user/user-2/unread"));
    const user2Body = await json(user2Res);
    expect(user2Body.data.unreadCount).toBe(1);
  });

  test("mark-all-read returns 0 when no unread notifications", async () => {
    const res = await handleRequest(put("/notifications/user/user-999/read-all"));
    const body = await json(res);
    expect(body.data.markedAsRead).toBe(0);
  });

  test("mark-all-read skips already-read notifications", async () => {
    const n1 = await createNotification({ userId: "user-1" });
    await createNotification({ userId: "user-1" });
    // Mark one as read first
    await handleRequest(put(`/notifications/${n1.id}/read`));

    const res = await handleRequest(put("/notifications/user/user-1/read-all"));
    const body = await json(res);
    expect(body.data.markedAsRead).toBe(1); // only the unread one
  });

  // === GET USER NOTIFICATIONS ===

  test("gets all notifications for a user", async () => {
    await createNotification({ userId: "user-1", title: "First" });
    await createNotification({ userId: "user-1", title: "Second" });
    await createNotification({ userId: "user-2", title: "Other" });

    const res = await handleRequest(get("/notifications/user/user-1"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((n: any) => n.userId === "user-1")).toBe(true);
  });

  test("returns empty array for user with no notifications", async () => {
    const res = await handleRequest(get("/notifications/user/user-999"));
    const body = await json(res);
    expect(body.data.length).toBe(0);
  });
});
