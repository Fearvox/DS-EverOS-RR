import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { clearAllStores } from "../store";

function post(path: string, body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request(`http://localhost:3001${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return res.json();
}

describe("Auth Registration", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("registers a new user successfully", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "alice@test.com", password: "secret123", name: "Alice" })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe("alice@test.com");
    expect(body.data.user.name).toBe("Alice");
    expect(body.data.user.role).toBe("user");
    expect(body.data.token).toBeDefined();
    expect(typeof body.data.token).toBe("string");
  });

  test("returns token that can be used for authentication", async () => {
    const regRes = await handleRequest(
      post("/auth/register", { email: "bob@test.com", password: "secret123", name: "Bob" })
    );
    const { data } = await json(regRes);

    const sessionRes = await handleRequest(
      new Request("http://localhost:3001/auth/session", {
        headers: { Authorization: `Bearer ${data.token}` },
      })
    );
    expect(sessionRes.status).toBe(200);
    const sessionBody = await json(sessionRes);
    expect(sessionBody.data.user.email).toBe("bob@test.com");
  });

  test("rejects duplicate email", async () => {
    await handleRequest(
      post("/auth/register", { email: "dup@test.com", password: "secret123", name: "First" })
    );
    const res = await handleRequest(
      post("/auth/register", { email: "dup@test.com", password: "other456", name: "Second" })
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("already registered");
  });

  test("rejects invalid email format", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "not-an-email", password: "secret123", name: "Test" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("email");
  });

  test("rejects empty email", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "", password: "secret123", name: "Test" })
    );
    expect(res.status).toBe(400);
  });

  test("rejects missing password", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "test@test.com", name: "Test" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("Password");
  });

  test("rejects short password", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "test@test.com", password: "abc", name: "Test" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("6 characters");
  });

  test("rejects missing name", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "test@test.com", password: "secret123" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("Name");
  });

  test("rejects invalid JSON body", async () => {
    const req = new Request("http://localhost:3001/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(400);
  });

  test("registered user has createdAt and updatedAt", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "ts@test.com", password: "secret123", name: "Timestamped" })
    );
    const body = await json(res);
    expect(body.data.user.createdAt).toBeDefined();
    expect(body.data.user.updatedAt).toBeDefined();
  });

  test("registered user has active status", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "active@test.com", password: "secret123", name: "Active" })
    );
    const body = await json(res);
    expect(body.data.user.status).toBe("active");
  });

  test("registered user id is a valid UUID-like string", async () => {
    const res = await handleRequest(
      post("/auth/register", { email: "uuid@test.com", password: "secret123", name: "UUID" })
    );
    const body = await json(res);
    expect(body.data.user.id).toBeDefined();
    expect(typeof body.data.user.id).toBe("string");
    expect(body.data.user.id.length).toBeGreaterThan(0);
  });
});
