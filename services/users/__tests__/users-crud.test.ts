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

beforeEach(() => {
  userStore.clearAll();
});

describe("POST /users - create user", () => {
  test("creates a user with valid data", async () => {
    const res = await handleRequest(req("POST", "/users", { name: "Alice", email: "alice@test.com" }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Alice");
    expect(body.data.email).toBe("alice@test.com");
    expect(body.data.role).toBe("user");
    expect(body.data.status).toBe("active");
    expect(body.data.id).toBeDefined();
    expect(body.data.createdAt).toBeDefined();
  });

  test("creates an admin user when role is specified", async () => {
    const res = await handleRequest(req("POST", "/users", { name: "Bob", email: "bob@test.com", role: "admin" }));
    const body = await json(res);
    expect(body.data.role).toBe("admin");
  });

  test("rejects missing name", async () => {
    const res = await handleRequest(req("POST", "/users", { email: "x@test.com" }));
    expect(res.status).toBe(400);
  });

  test("rejects missing email", async () => {
    const res = await handleRequest(req("POST", "/users", { name: "X" }));
    expect(res.status).toBe(400);
  });

  test("rejects invalid email format", async () => {
    const res = await handleRequest(req("POST", "/users", { name: "X", email: "notanemail" }));
    expect(res.status).toBe(400);
  });

  test("rejects duplicate email", async () => {
    await handleRequest(req("POST", "/users", { name: "A", email: "dup@test.com" }));
    const res = await handleRequest(req("POST", "/users", { name: "B", email: "dup@test.com" }));
    expect(res.status).toBe(409);
  });

  test("rejects invalid JSON body", async () => {
    const r = new Request("http://localhost:3002/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleRequest(r);
    expect(res.status).toBe(400);
  });
});

describe("GET /users/:id - get user", () => {
  test("returns user by id", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "Alice", email: "a@t.com" }));
    const { data: created } = await json(createRes);

    const res = await handleRequest(req("GET", `/users/${created.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(created.id);
    expect(body.data.name).toBe("Alice");
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("GET", "/users/nonexistent"));
    expect(res.status).toBe(404);
  });
});

describe("PUT /users/:id - update user", () => {
  test("updates name", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "Old", email: "u@t.com" }));
    const { data: user } = await json(createRes);

    const res = await handleRequest(req("PUT", `/users/${user.id}`, { name: "New" }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.name).toBe("New");
  });

  test("updates email", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "U", email: "old@t.com" }));
    const { data: user } = await json(createRes);

    const res = await handleRequest(req("PUT", `/users/${user.id}`, { email: "new@t.com" }));
    const body = await json(res);
    expect(body.data.email).toBe("new@t.com");
  });

  test("rejects invalid email on update", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "U", email: "e@t.com" }));
    const { data: user } = await json(createRes);

    const res = await handleRequest(req("PUT", `/users/${user.id}`, { email: "bad" }));
    expect(res.status).toBe(400);
  });

  test("rejects duplicate email on update", async () => {
    await handleRequest(req("POST", "/users", { name: "A", email: "a@t.com" }));
    const r2 = await handleRequest(req("POST", "/users", { name: "B", email: "b@t.com" }));
    const { data: userB } = await json(r2);

    const res = await handleRequest(req("PUT", `/users/${userB.id}`, { email: "a@t.com" }));
    expect(res.status).toBe(409);
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("PUT", "/users/nope", { name: "X" }));
    expect(res.status).toBe(404);
  });

  test("rejects empty name on update", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "U", email: "u@t.com" }));
    const { data: user } = await json(createRes);

    const res = await handleRequest(req("PUT", `/users/${user.id}`, { name: "" }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /users/:id - soft delete", () => {
  test("soft deletes a user", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "D", email: "d@t.com" }));
    const { data: user } = await json(createRes);

    const res = await handleRequest(req("DELETE", `/users/${user.id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.status).toBe("deleted");
  });

  test("returns 404 for nonexistent user", async () => {
    const res = await handleRequest(req("DELETE", "/users/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("user still exists after soft delete", async () => {
    const createRes = await handleRequest(req("POST", "/users", { name: "D", email: "d2@t.com" }));
    const { data: user } = await json(createRes);

    await handleRequest(req("DELETE", `/users/${user.id}`));
    const getRes = await handleRequest(req("GET", `/users/${user.id}`));
    const body = await json(getRes);
    expect(body.data.status).toBe("deleted");
  });
});

describe("routing edge cases", () => {
  test("returns 404 for unknown path", async () => {
    const res = await handleRequest(req("GET", "/unknown"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for unknown sub-resource", async () => {
    const res = await handleRequest(req("GET", "/users/abc/unknown"));
    expect(res.status).toBe(404);
  });
});
