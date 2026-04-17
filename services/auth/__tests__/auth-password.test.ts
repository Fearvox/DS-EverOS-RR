import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { clearAllStores, resetTokenStore } from "../store";

function post(path: string, body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request(`http://localhost:3001${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
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

describe("Auth Change Password", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("changes password successfully", async () => {
    const { token } = await registerAndLogin("pw@test.com", "oldpass123");
    const res = await handleRequest(
      put("/auth/password", { oldPassword: "oldpass123", newPassword: "newpass456" }, token)
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.message).toContain("Password updated");
  });

  test("can login with new password after change", async () => {
    const { token } = await registerAndLogin("pwlogin@test.com", "oldpass123");
    await handleRequest(
      put("/auth/password", { oldPassword: "oldpass123", newPassword: "newpass456" }, token)
    );
    const res = await handleRequest(
      post("/auth/login", { email: "pwlogin@test.com", password: "newpass456" })
    );
    expect(res.status).toBe(200);
  });

  test("rejects wrong old password", async () => {
    const { token } = await registerAndLogin("wrongold@test.com", "correct123");
    const res = await handleRequest(
      put("/auth/password", { oldPassword: "wrong999", newPassword: "newpass456" }, token)
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error).toContain("incorrect");
  });

  test("rejects short new password", async () => {
    const { token } = await registerAndLogin("short@test.com", "oldpass123");
    const res = await handleRequest(
      put("/auth/password", { oldPassword: "oldpass123", newPassword: "ab" }, token)
    );
    expect(res.status).toBe(400);
  });

  test("rejects missing old password", async () => {
    const { token } = await registerAndLogin("miss@test.com", "oldpass123");
    const res = await handleRequest(
      put("/auth/password", { newPassword: "newpass456" }, token)
    );
    expect(res.status).toBe(400);
  });

  test("rejects password change without auth", async () => {
    const req = new Request("http://localhost:3001/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: "old", newPassword: "newpass456" }),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
  });
});

describe("Auth Forgot/Reset Password", () => {
  beforeEach(() => {
    clearAllStores();
  });

  test("forgot-password returns success for existing email", async () => {
    await registerAndLogin("forgot@test.com", "secret123");
    const res = await handleRequest(
      post("/auth/forgot-password", { email: "forgot@test.com" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.message).toContain("reset link");
  });

  test("forgot-password returns success for non-existent email (no enumeration)", async () => {
    const res = await handleRequest(
      post("/auth/forgot-password", { email: "nobody@test.com" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.message).toContain("reset link");
  });

  test("forgot-password rejects invalid email", async () => {
    const res = await handleRequest(
      post("/auth/forgot-password", { email: "not-email" })
    );
    expect(res.status).toBe(400);
  });

  test("resets password with valid token", async () => {
    await registerAndLogin("reset@test.com", "oldpass123");
    await handleRequest(
      post("/auth/forgot-password", { email: "reset@test.com" })
    );

    // Get the token from the store directly
    const allTokens = resetTokenStore.getAll();
    expect(allTokens.length).toBe(1);
    const resetToken = allTokens[0].token;

    const res = await handleRequest(
      post("/auth/reset-password", { token: resetToken, newPassword: "brandnew789" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.message).toContain("reset successfully");
  });

  test("can login with reset password", async () => {
    await registerAndLogin("resetlogin@test.com", "oldpass123");
    await handleRequest(
      post("/auth/forgot-password", { email: "resetlogin@test.com" })
    );
    const allTokens = resetTokenStore.getAll();
    const resetToken = allTokens[0].token;

    await handleRequest(
      post("/auth/reset-password", { token: resetToken, newPassword: "brandnew789" })
    );

    const loginRes = await handleRequest(
      post("/auth/login", { email: "resetlogin@test.com", password: "brandnew789" })
    );
    expect(loginRes.status).toBe(200);
  });

  test("rejects invalid reset token", async () => {
    const res = await handleRequest(
      post("/auth/reset-password", { token: "bad-token", newPassword: "newpass456" })
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toContain("Invalid");
  });

  test("rejects reused reset token", async () => {
    await registerAndLogin("reuse@test.com", "oldpass123");
    await handleRequest(
      post("/auth/forgot-password", { email: "reuse@test.com" })
    );
    const allTokens = resetTokenStore.getAll();
    const resetToken = allTokens[0].token;

    // First use - should succeed
    await handleRequest(
      post("/auth/reset-password", { token: resetToken, newPassword: "first789" })
    );

    // Second use - should fail
    const res = await handleRequest(
      post("/auth/reset-password", { token: resetToken, newPassword: "second789" })
    );
    expect(res.status).toBe(400);
  });

  test("rejects reset with short new password", async () => {
    await registerAndLogin("shortpw@test.com", "oldpass123");
    await handleRequest(
      post("/auth/forgot-password", { email: "shortpw@test.com" })
    );
    const allTokens = resetTokenStore.getAll();
    const resetToken = allTokens[0].token;

    const res = await handleRequest(
      post("/auth/reset-password", { token: resetToken, newPassword: "ab" })
    );
    expect(res.status).toBe(400);
  });
});
