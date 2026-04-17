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

function put(path: string, body: Record<string, unknown>, token: string): Request {
  return new Request(`http://localhost:3001${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
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

describe("Auth Profile", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("gets user profile", async () => {
    const { token } = await registerAndLogin("profile@test.com", "secret123", "ProfileUser");
    const res = await handleRequest(get("/auth/profile", token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.user.email).toBe("profile@test.com");
    expect(body.data.user.name).toBe("ProfileUser");
  });

  test("rejects profile without auth", async () => {
    const req = new Request("http://localhost:3001/auth/profile");
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
  });

  test("updates profile name", async () => {
    const { token } = await registerAndLogin("upname@test.com", "secret123", "OldName");
    const res = await handleRequest(
      put("/auth/profile", { name: "NewName" }, token)
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.user.name).toBe("NewName");
  });

  test("updates profile email", async () => {
    const { token } = await registerAndLogin("oldemail@test.com", "secret123", "User");
    const res = await handleRequest(
      put("/auth/profile", { email: "newemail@test.com" }, token)
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.user.email).toBe("newemail@test.com");
  });

  test("rejects profile update with duplicate email", async () => {
    await registerAndLogin("taken@test.com", "secret123", "First");
    const { token } = await registerAndLogin("second@test.com", "secret123", "Second");
    const res = await handleRequest(
      put("/auth/profile", { email: "taken@test.com" }, token)
    );
    expect(res.status).toBe(409);
  });

  test("rejects profile update with invalid email", async () => {
    const { token } = await registerAndLogin("valid@test.com", "secret123", "User");
    const res = await handleRequest(
      put("/auth/profile", { email: "not-valid" }, token)
    );
    expect(res.status).toBe(400);
  });

  test("rejects profile update with empty name", async () => {
    const { token } = await registerAndLogin("emptyname@test.com", "secret123", "User");
    const res = await handleRequest(
      put("/auth/profile", { name: "" }, token)
    );
    expect(res.status).toBe(400);
  });

  test("profile update sets updatedAt", async () => {
    const { token, user } = await registerAndLogin("updated@test.com", "secret123", "User");
    const originalUpdatedAt = user.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    const res = await handleRequest(
      put("/auth/profile", { name: "Updated" }, token)
    );
    const body = await json(res);
    expect(body.data.user.updatedAt).toBeDefined();
  });
});

describe("Auth Validate Token", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("validates a valid token", async () => {
    const { token } = await registerAndLogin("valid@test.com", "secret123");
    const res = await handleRequest(
      post("/auth/validate-token", { token })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.valid).toBe(true);
    expect(body.data.userId).toBeDefined();
    expect(body.data.user).toBeDefined();
  });

  test("reports invalid token as not valid", async () => {
    const res = await handleRequest(
      post("/auth/validate-token", { token: "fake-token" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.valid).toBe(false);
  });

  test("rejects validate-token without token field", async () => {
    const res = await handleRequest(
      post("/auth/validate-token", {})
    );
    expect(res.status).toBe(400);
  });
});

describe("Auth Sessions List", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("lists active sessions for user", async () => {
    // Register creates one session, login creates another
    const reg = await registerAndLogin("sessions@test.com", "secret123");
    const loginRes = await handleRequest(
      post("/auth/login", { email: "sessions@test.com", password: "secret123" })
    );
    const loginBody = await json(loginRes);

    const res = await handleRequest(get("/auth/sessions", reg.token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.sessions.length).toBe(2);
  });

  test("sessions list requires auth", async () => {
    const req = new Request("http://localhost:3001/auth/sessions");
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
  });

  test("logged-out session not in active list", async () => {
    const { token: token1 } = await registerAndLogin("multi@test.com", "secret123");
    const loginRes = await handleRequest(
      post("/auth/login", { email: "multi@test.com", password: "secret123" })
    );
    const { data: { token: token2 } } = await json(loginRes);

    // Logout second session
    await handleRequest(
      post("/auth/logout", {}, { Authorization: `Bearer ${token2}` })
    );

    const res = await handleRequest(get("/auth/sessions", token1));
    const body = await json(res);
    expect(body.data.sessions.length).toBe(1);
  });
});

describe("Auth 404", () => {
  test("returns 404 for unknown route", async () => {
    const req = new Request("http://localhost:3001/auth/unknown");
    const res = await handleRequest(req);
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-auth prefix", async () => {
    const req = new Request("http://localhost:3001/other/route");
    const res = await handleRequest(req);
    expect(res.status).toBe(404);
  });
});
