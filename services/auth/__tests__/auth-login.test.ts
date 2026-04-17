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

function get(path: string, token: string): Request {
  return new Request(`http://localhost:3001${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function json(res: Response) {
  return res.json();
}

async function registerAndLogin(email = "user@test.com", password = "secret123", name = "User") {
  const regRes = await handleRequest(
    post("/auth/register", { email, password, name })
  );
  const regBody = await json(regRes);
  return regBody.data;
}

describe("Auth Login", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("logs in with valid credentials", async () => {
    await registerAndLogin("login@test.com", "mypass123");
    const res = await handleRequest(
      post("/auth/login", { email: "login@test.com", password: "mypass123" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.token).toBeDefined();
    expect(body.data.user.email).toBe("login@test.com");
  });

  test("rejects wrong password", async () => {
    await registerAndLogin("wrong@test.com", "correct123");
    const res = await handleRequest(
      post("/auth/login", { email: "wrong@test.com", password: "wrong999" })
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error).toContain("Invalid");
  });

  test("rejects non-existent email", async () => {
    const res = await handleRequest(
      post("/auth/login", { email: "nobody@test.com", password: "secret123" })
    );
    expect(res.status).toBe(401);
  });

  test("rejects missing email in login", async () => {
    const res = await handleRequest(
      post("/auth/login", { password: "secret123" })
    );
    expect(res.status).toBe(400);
  });

  test("rejects missing password in login", async () => {
    const res = await handleRequest(
      post("/auth/login", { email: "test@test.com" })
    );
    expect(res.status).toBe(400);
  });
});

describe("Auth Logout", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("logs out successfully", async () => {
    const { token } = await registerAndLogin();
    const res = await handleRequest(
      post("/auth/logout", {}, { Authorization: `Bearer ${token}` })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.message).toContain("Logged out");
  });

  test("session is invalid after logout", async () => {
    const { token } = await registerAndLogin();
    await handleRequest(
      post("/auth/logout", {}, { Authorization: `Bearer ${token}` })
    );
    const res = await handleRequest(get("/auth/session", token));
    expect(res.status).toBe(401);
  });

  test("rejects logout without token", async () => {
    const req = new Request("http://localhost:3001/auth/logout", { method: "POST" });
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
  });

  test("rejects logout with invalid token", async () => {
    const res = await handleRequest(
      post("/auth/logout", {}, { Authorization: "Bearer invalid-token" })
    );
    expect(res.status).toBe(401);
  });
});

describe("Auth Session", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("gets current session info", async () => {
    const { token, user } = await registerAndLogin("session@test.com", "secret123", "SessionUser");
    const res = await handleRequest(get("/auth/session", token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.user.email).toBe("session@test.com");
    expect(body.data.session).toBeDefined();
    expect(body.data.session.token).toBe(token);
  });

  test("rejects session request without auth", async () => {
    const req = new Request("http://localhost:3001/auth/session");
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
  });

  test("refreshes session token", async () => {
    const { token } = await registerAndLogin();
    const res = await handleRequest(
      post("/auth/refresh", {}, { Authorization: `Bearer ${token}` })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.token).toBeDefined();
    expect(body.data.token).not.toBe(token);
    expect(body.data.expiresAt).toBeDefined();
  });

  test("old token is invalid after refresh", async () => {
    const { token } = await registerAndLogin();
    await handleRequest(
      post("/auth/refresh", {}, { Authorization: `Bearer ${token}` })
    );
    const res = await handleRequest(get("/auth/session", token));
    expect(res.status).toBe(401);
  });
});
