import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { userStore } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3002${path}`, opts);
}

async function json(r: Response) {
  return r.json();
}

async function createUser(name: string, email: string, role: "user" | "admin" = "user") {
  const res = await handleRequest(req("POST", "/users", { name, email, role }));
  return (await json(res)).data;
}

beforeEach(() => {
  userStore.clearAll();
});

// --- Role changes ---

describe("PUT /users/:id/role - change role", () => {
  test("changes role from user to admin", async () => {
    const user = await createUser("Alice", "a@t.com");
    const res = await handleRequest(req("PUT", `/users/${user.id}/role`, { role: "admin" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.role).toBe("admin");
  });

  test("changes role from admin to user", async () => {
    const user = await createUser("Bob", "b@t.com", "admin");
    const res = await handleRequest(req("PUT", `/users/${user.id}/role`, { role: "user" }));
    const body = await json(res);
    expect(body.data.role).toBe("user");
  });

  test("rejects invalid role", async () => {
    const user = await createUser("X", "x@t.com");
    const res = await handleRequest(req("PUT", `/users/${user.id}/role`, { role: "superadmin" }));
    expect(res.status).toBe(400);
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("PUT", "/users/nope/role", { role: "admin" }));
    expect(res.status).toBe(404);
  });

  test("rejects missing role in body", async () => {
    const user = await createUser("X", "x@t.com");
    const res = await handleRequest(req("PUT", `/users/${user.id}/role`, {}));
    expect(res.status).toBe(400);
  });
});

// --- Suspend / Activate ---

describe("PUT /users/:id/suspend", () => {
  test("suspends an active user", async () => {
    const user = await createUser("Alice", "a@t.com");
    const res = await handleRequest(req("PUT", `/users/${user.id}/suspend`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("suspended");
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("PUT", "/users/nope/suspend"));
    expect(res.status).toBe(404);
  });

  test("cannot suspend a deleted user", async () => {
    const user = await createUser("D", "d@t.com");
    await handleRequest(req("DELETE", `/users/${user.id}`));
    const res = await handleRequest(req("PUT", `/users/${user.id}/suspend`));
    expect(res.status).toBe(400);
  });
});

describe("PUT /users/:id/activate", () => {
  test("activates a suspended user", async () => {
    const user = await createUser("Alice", "a@t.com");
    await handleRequest(req("PUT", `/users/${user.id}/suspend`));

    const res = await handleRequest(req("PUT", `/users/${user.id}/activate`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("active");
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("PUT", "/users/nope/activate"));
    expect(res.status).toBe(404);
  });

  test("cannot activate a deleted user", async () => {
    const user = await createUser("D", "d@t.com");
    await handleRequest(req("DELETE", `/users/${user.id}`));
    const res = await handleRequest(req("PUT", `/users/${user.id}/activate`));
    expect(res.status).toBe(400);
  });
});

// --- Stats ---

describe("GET /users/stats", () => {
  test("returns correct stats for empty store", async () => {
    const res = await handleRequest(req("GET", "/users/stats"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.total).toBe(0);
    expect(body.data.byRole.user).toBe(0);
    expect(body.data.byRole.admin).toBe(0);
    expect(body.data.byStatus.active).toBe(0);
  });

  test("returns correct stats after operations", async () => {
    const u1 = await createUser("A", "a@t.com", "user");
    await createUser("B", "b@t.com", "admin");
    await createUser("C", "c@t.com", "user");
    await handleRequest(req("PUT", `/users/${u1.id}/suspend`));

    const res = await handleRequest(req("GET", "/users/stats"));
    const body = await json(res);
    expect(body.data.total).toBe(3);
    expect(body.data.byRole.user).toBe(2);
    expect(body.data.byRole.admin).toBe(1);
    expect(body.data.byStatus.active).toBe(2);
    expect(body.data.byStatus.suspended).toBe(1);
  });

  test("counts deleted users", async () => {
    const u = await createUser("A", "a@t.com");
    await handleRequest(req("DELETE", `/users/${u.id}`));

    const res = await handleRequest(req("GET", "/users/stats"));
    const body = await json(res);
    expect(body.data.byStatus.deleted).toBe(1);
  });
});

// --- Bulk status ---

describe("POST /users/bulk-status", () => {
  test("updates multiple users status", async () => {
    const u1 = await createUser("A", "a@t.com");
    const u2 = await createUser("B", "b@t.com");

    const res = await handleRequest(
      req("POST", "/users/bulk-status", { userIds: [u1.id, u2.id], status: "suspended" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((r: any) => r.success)).toBe(true);

    // Verify
    const check = await handleRequest(req("GET", `/users/${u1.id}`));
    const checkBody = await json(check);
    expect(checkBody.data.status).toBe("suspended");
  });

  test("reports errors for nonexistent users", async () => {
    const u1 = await createUser("A", "a@t.com");
    const res = await handleRequest(
      req("POST", "/users/bulk-status", { userIds: [u1.id, "fake-id"], status: "suspended" })
    );
    const body = await json(res);
    expect(body.data[0].success).toBe(true);
    expect(body.data[1].success).toBe(false);
    expect(body.data[1].error).toBe("User not found");
  });

  test("rejects empty userIds", async () => {
    const res = await handleRequest(
      req("POST", "/users/bulk-status", { userIds: [], status: "active" })
    );
    expect(res.status).toBe(400);
  });

  test("rejects invalid status", async () => {
    const res = await handleRequest(
      req("POST", "/users/bulk-status", { userIds: ["a"], status: "invalid" })
    );
    expect(res.status).toBe(400);
  });

  test("rejects missing body", async () => {
    const r = new Request("http://localhost:3002/users/bulk-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    });
    const res = await handleRequest(r);
    expect(res.status).toBe(400);
  });
});

// --- Activity log ---

describe("activity log", () => {
  test("create user auto-logs activity", async () => {
    const user = await createUser("Alice", "a@t.com");
    const res = await handleRequest(req("GET", `/users/${user.id}/activity`));
    const body = await json(res);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].action).toBe("created");
  });

  test("POST /users/:id/activity logs custom activity", async () => {
    const user = await createUser("A", "a@t.com");
    const res = await handleRequest(
      req("POST", `/users/${user.id}/activity`, { action: "login", details: "From web" })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.action).toBe("login");
    expect(body.data.details).toBe("From web");
  });

  test("rejects activity without action", async () => {
    const user = await createUser("A", "a@t.com");
    const res = await handleRequest(req("POST", `/users/${user.id}/activity`, {}));
    expect(res.status).toBe(400);
  });

  test("returns 404 for activity on nonexistent user", async () => {
    const res = await handleRequest(req("GET", "/users/nope/activity"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for logging activity on nonexistent user", async () => {
    const res = await handleRequest(
      req("POST", "/users/nope/activity", { action: "test" })
    );
    expect(res.status).toBe(404);
  });

  test("tracks multiple activities in order", async () => {
    const user = await createUser("A", "a@t.com");
    await handleRequest(req("PUT", `/users/${user.id}/suspend`));
    await handleRequest(req("PUT", `/users/${user.id}/activate`));

    const res = await handleRequest(req("GET", `/users/${user.id}/activity`));
    const body = await json(res);
    const actions = body.data.map((a: any) => a.action);
    expect(actions).toContain("created");
    expect(actions).toContain("suspended");
    expect(actions).toContain("activated");
  });
});
