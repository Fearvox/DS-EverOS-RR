// Auth request handlers - pure function handleRequest(req: Request): Promise<Response>

import { jsonResponse, errorResponse, parseBody, getPathSegments, generateId, now } from "../shared/http";
import { isNonEmptyString, isValidEmail, validate } from "../shared/validation";
import type { User } from "../shared/types";
import {
  userStore,
  credentialStore,
  sessionStore,
  resetTokenStore,
  hashPassword,
  verifyPassword,
  createSession,
  findSessionByToken,
  createResetToken,
  findValidResetToken,
} from "./store";

function getToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return auth;
}

async function authenticate(req: Request): Promise<{ user: User; sessionToken: string } | Response> {
  const token = getToken(req);
  if (!token) return errorResponse("Authorization header required", 401);
  const session = findSessionByToken(token);
  if (!session) return errorResponse("Invalid or expired session", 401);
  const user = userStore.getById(session.userId);
  if (!user) return errorResponse("User not found", 401);
  if (user.status !== "active") return errorResponse("Account is not active", 403);
  return { user, sessionToken: token };
}

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);

  // All routes start with /auth
  if (segments[0] !== "auth") {
    return errorResponse("Not found", 404);
  }

  const route = segments[1] || "";

  // POST /auth/register
  if (method === "POST" && route === "register") {
    const body = await parseBody<{ email?: string; password?: string; name?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isValidEmail(body.email), "email", "Valid email is required"],
      [isNonEmptyString(body.password), "password", "Password is required"],
      [isNonEmptyString(body.name), "name", "Name is required"],
    ]);
    if (errors.length > 0) {
      return errorResponse(errors[0].message, 400);
    }

    if ((body.password as string).length < 6) {
      return errorResponse("Password must be at least 6 characters", 400);
    }

    const existing = credentialStore.findOne((c) => c.email === body.email);
    if (existing) {
      return errorResponse("Email already registered", 409);
    }

    const userId = generateId();
    const timestamp = now();
    const user: User = {
      id: userId,
      email: body.email as string,
      name: body.name as string,
      role: "user",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    userStore.create(user);

    credentialStore.create({
      id: generateId(),
      userId,
      email: body.email as string,
      passwordHash: hashPassword(body.password as string),
    });

    const session = createSession(userId);

    return jsonResponse({ user: sanitizeUser(user), token: session.token }, 201);
  }

  // POST /auth/login
  if (method === "POST" && route === "login") {
    const body = await parseBody<{ email?: string; password?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isValidEmail(body.email), "email", "Valid email is required"],
      [isNonEmptyString(body.password), "password", "Password is required"],
    ]);
    if (errors.length > 0) {
      return errorResponse(errors[0].message, 400);
    }

    const credential = credentialStore.findOne((c) => c.email === body.email);
    if (!credential) {
      return errorResponse("Invalid email or password", 401);
    }

    if (!verifyPassword(body.password as string, credential.passwordHash)) {
      return errorResponse("Invalid email or password", 401);
    }

    const user = userStore.getById(credential.userId);
    if (!user || user.status !== "active") {
      return errorResponse("Account is not active", 403);
    }

    const session = createSession(user.id);
    return jsonResponse({ user: sanitizeUser(user), token: session.token });
  }

  // POST /auth/logout
  if (method === "POST" && route === "logout") {
    const token = getToken(req);
    if (!token) return errorResponse("Authorization header required", 401);
    const session = findSessionByToken(token);
    if (!session) return errorResponse("Invalid or expired session", 401);
    sessionStore.delete(session.id);
    return jsonResponse({ message: "Logged out successfully" });
  }

  // GET /auth/session
  if (method === "GET" && route === "session") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const session = findSessionByToken(auth.sessionToken);
    return jsonResponse({ session, user: sanitizeUser(auth.user) });
  }

  // POST /auth/refresh
  if (method === "POST" && route === "refresh") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    // Delete old session
    const oldSession = findSessionByToken(auth.sessionToken);
    if (oldSession) sessionStore.delete(oldSession.id);
    // Create new session
    const newSession = createSession(auth.user.id);
    return jsonResponse({ token: newSession.token, expiresAt: newSession.expiresAt });
  }

  // PUT /auth/password
  if (method === "PUT" && route === "password") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const body = await parseBody<{ oldPassword?: string; newPassword?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isNonEmptyString(body.oldPassword), "oldPassword", "Current password is required"],
      [isNonEmptyString(body.newPassword), "newPassword", "New password is required"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    if ((body.newPassword as string).length < 6) {
      return errorResponse("New password must be at least 6 characters", 400);
    }

    const credential = credentialStore.findOne((c) => c.userId === auth.user.id);
    if (!credential) return errorResponse("Credentials not found", 500);

    if (!verifyPassword(body.oldPassword as string, credential.passwordHash)) {
      return errorResponse("Current password is incorrect", 401);
    }

    credentialStore.update(credential.id, {
      passwordHash: hashPassword(body.newPassword as string),
    });

    return jsonResponse({ message: "Password updated successfully" });
  }

  // POST /auth/forgot-password
  if (method === "POST" && route === "forgot-password") {
    const body = await parseBody<{ email?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    if (!isValidEmail(body.email)) {
      return errorResponse("Valid email is required", 400);
    }

    // Always return success to prevent email enumeration
    const credential = credentialStore.findOne((c) => c.email === body.email);
    if (credential) {
      createResetToken(credential.userId);
    }

    return jsonResponse({ message: "If the email exists, a reset link has been sent" });
  }

  // POST /auth/reset-password
  if (method === "POST" && route === "reset-password") {
    const body = await parseBody<{ token?: string; newPassword?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isNonEmptyString(body.token), "token", "Reset token is required"],
      [isNonEmptyString(body.newPassword), "newPassword", "New password is required"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    if ((body.newPassword as string).length < 6) {
      return errorResponse("New password must be at least 6 characters", 400);
    }

    const resetToken = findValidResetToken(body.token as string);
    if (!resetToken) {
      return errorResponse("Invalid or expired reset token", 400);
    }

    const credential = credentialStore.findOne((c) => c.userId === resetToken.userId);
    if (!credential) return errorResponse("User not found", 500);

    credentialStore.update(credential.id, {
      passwordHash: hashPassword(body.newPassword as string),
    });

    // Mark token as used
    resetTokenStore.update(resetToken.id, { used: true });

    return jsonResponse({ message: "Password has been reset successfully" });
  }

  // GET /auth/profile
  if (method === "GET" && route === "profile") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    return jsonResponse({ user: sanitizeUser(auth.user) });
  }

  // PUT /auth/profile
  if (method === "PUT" && route === "profile") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const body = await parseBody<{ name?: string; email?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const updates: Partial<User> = { updatedAt: now() };

    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) return errorResponse("Name must be non-empty", 400);
      updates.name = body.name;
    }

    if (body.email !== undefined) {
      if (!isValidEmail(body.email)) return errorResponse("Valid email is required", 400);
      // Check for duplicate email
      const existing = credentialStore.findOne(
        (c) => c.email === body.email && c.userId !== auth.user.id
      );
      if (existing) return errorResponse("Email already in use", 409);
      updates.email = body.email;
      // Update credential email too
      const cred = credentialStore.findOne((c) => c.userId === auth.user.id);
      if (cred) credentialStore.update(cred.id, { email: body.email });
    }

    const updated = userStore.update(auth.user.id, updates);
    if (!updated) return errorResponse("Failed to update profile", 500);

    return jsonResponse({ user: sanitizeUser(updated) });
  }

  // POST /auth/validate-token
  if (method === "POST" && route === "validate-token") {
    const body = await parseBody<{ token?: string }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);
    if (!isNonEmptyString(body.token)) return errorResponse("Token is required", 400);

    const session = findSessionByToken(body.token as string);
    if (!session) {
      return jsonResponse({ valid: false });
    }
    const user = userStore.getById(session.userId);
    return jsonResponse({ valid: true, userId: session.userId, user: user ? sanitizeUser(user) : null });
  }

  // GET /auth/sessions
  if (method === "GET" && route === "sessions") {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const sessions = sessionStore.find(
      (s) => s.userId === auth.user.id && new Date(s.expiresAt) > new Date()
    );
    return jsonResponse({ sessions });
  }

  return errorResponse("Not found", 404);
}

function sanitizeUser(user: User): Omit<User, "status"> & { status: string } {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
