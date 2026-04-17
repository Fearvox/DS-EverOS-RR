// Users service request handler — pure function, no server dependency

import type { User } from "../shared/types";
import {
  jsonResponse,
  errorResponse,
  metaResponse,
  parseBody,
  getPathSegments,
  getQueryParams,
  generateId,
  now,
} from "../shared/http";
import {
  isNonEmptyString,
  isValidEmail,
  isValidEnum,
  validate,
} from "../shared/validation";
import { userStore } from "./store";

const ROLES = ["user", "admin"] as const;
const STATUSES = ["active", "suspended", "deleted"] as const;

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req); // e.g. ["users"] or ["users","abc"]

  // Must start with "users"
  if (segments[0] !== "users") {
    return errorResponse("Not found", 404);
  }

  // --- Collection-level routes ---

  // GET /users/stats
  if (method === "GET" && segments[1] === "stats" && segments.length === 2) {
    return handleStats();
  }

  // POST /users/bulk-status
  if (method === "POST" && segments[1] === "bulk-status" && segments.length === 2) {
    return handleBulkStatus(req);
  }

  // GET /users
  if (method === "GET" && segments.length === 1) {
    return handleList(req);
  }

  // POST /users
  if (method === "POST" && segments.length === 1) {
    return handleCreate(req);
  }

  // --- Item-level routes ---
  const userId = segments[1];
  if (!userId) return errorResponse("Not found", 404);

  // Sub-resource routes (3 segments)
  if (segments.length === 3) {
    const sub = segments[2];

    if (method === "PUT" && sub === "role") return handleChangeRole(req, userId);
    if (method === "PUT" && sub === "suspend") return handleSuspend(userId);
    if (method === "PUT" && sub === "activate") return handleActivate(userId);
    if (method === "GET" && sub === "activity") return handleGetActivity(userId);
    if (method === "POST" && sub === "activity") return handleLogActivity(req, userId);

    return errorResponse("Not found", 404);
  }

  // Direct item routes (2 segments)
  if (segments.length === 2) {
    if (method === "GET") return handleGetById(userId);
    if (method === "PUT") return handleUpdate(req, userId);
    if (method === "DELETE") return handleDelete(userId);
  }

  return errorResponse("Not found", 404);
}

// --- Handlers ---

function handleList(req: Request): Response {
  const params = getQueryParams(req);
  let users = userStore.getAll();

  const role = params.get("role");
  if (role && isValidEnum(role, ROLES)) {
    users = users.filter((u) => u.role === role);
  }

  const status = params.get("status");
  if (status && isValidEnum(status, STATUSES)) {
    users = users.filter((u) => u.status === status);
  }

  const search = params.get("search");
  if (search) {
    const q = search.toLowerCase();
    users = users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  const total = users.length;
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(params.get("limit") || "20", 10) || 20));
  const start = (page - 1) * limit;
  const paged = users.slice(start, start + limit);

  return metaResponse(paged, { total, page, limit });
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseBody<Partial<User>>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const errors = validate([
    [isNonEmptyString(body.name), "name", "Name is required"],
    [isValidEmail(body.email), "email", "Valid email is required"],
  ]);
  if (errors.length > 0) {
    return errorResponse(errors.map((e) => e.message).join("; "), 400);
  }

  // Check duplicate email
  if (userStore.findByEmail(body.email!)) {
    return errorResponse("Email already exists", 409);
  }

  const timestamp = now();
  const user: User = {
    id: generateId(),
    email: body.email!,
    name: body.name!,
    role: isValidEnum(body.role, ROLES) ? body.role : "user",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const created = userStore.create(user);
  userStore.logActivity(created.id, "created", "User account created");
  return jsonResponse(created, 201);
}

function handleGetById(id: string): Response {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);
  return jsonResponse(user);
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);

  const body = await parseBody<Partial<User>>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  // Validate optional fields if provided
  if (body.email !== undefined && !isValidEmail(body.email)) {
    return errorResponse("Valid email is required", 400);
  }
  if (body.name !== undefined && !isNonEmptyString(body.name)) {
    return errorResponse("Name cannot be empty", 400);
  }

  // Check email uniqueness if changing
  if (body.email && body.email !== user.email && userStore.findByEmail(body.email)) {
    return errorResponse("Email already exists", 409);
  }

  const updates: Partial<User> = { updatedAt: now() };
  if (body.name) updates.name = body.name;
  if (body.email) updates.email = body.email;

  const updated = userStore.update(id, updates);
  userStore.logActivity(id, "updated", "User profile updated");
  return jsonResponse(updated);
}

function handleDelete(id: string): Response {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);

  const deleted = userStore.softDelete(id);
  userStore.logActivity(id, "deleted", "User soft-deleted");
  return jsonResponse(deleted);
}

async function handleChangeRole(req: Request, id: string): Promise<Response> {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);

  const body = await parseBody<{ role?: string }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isValidEnum(body.role, ROLES)) {
    return errorResponse("Invalid role. Must be 'user' or 'admin'", 400);
  }

  const updated = userStore.update(id, { role: body.role as User["role"], updatedAt: now() });
  userStore.logActivity(id, "role_changed", `Role changed to ${body.role}`);
  return jsonResponse(updated);
}

function handleSuspend(id: string): Response {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);
  if (user.status === "deleted") return errorResponse("Cannot suspend a deleted user", 400);

  const updated = userStore.update(id, { status: "suspended" as const, updatedAt: now() });
  userStore.logActivity(id, "suspended", "User suspended");
  return jsonResponse(updated);
}

function handleActivate(id: string): Response {
  const user = userStore.getById(id);
  if (!user) return errorResponse("User not found", 404);
  if (user.status === "deleted") return errorResponse("Cannot activate a deleted user", 400);

  const updated = userStore.update(id, { status: "active" as const, updatedAt: now() });
  userStore.logActivity(id, "activated", "User activated");
  return jsonResponse(updated);
}

function handleGetActivity(userId: string): Response {
  const user = userStore.getById(userId);
  if (!user) return errorResponse("User not found", 404);

  const activity = userStore.getActivity(userId);
  return jsonResponse(activity);
}

async function handleLogActivity(req: Request, userId: string): Promise<Response> {
  const user = userStore.getById(userId);
  if (!user) return errorResponse("User not found", 404);

  const body = await parseBody<{ action?: string; details?: string }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isNonEmptyString(body.action)) {
    return errorResponse("Action is required", 400);
  }

  const entry = userStore.logActivity(userId, body.action!, body.details);
  return jsonResponse(entry, 201);
}

function handleStats(): Response {
  const all = userStore.getAll();
  const stats = {
    total: all.length,
    byRole: {
      user: all.filter((u) => u.role === "user").length,
      admin: all.filter((u) => u.role === "admin").length,
    },
    byStatus: {
      active: all.filter((u) => u.status === "active").length,
      suspended: all.filter((u) => u.status === "suspended").length,
      deleted: all.filter((u) => u.status === "deleted").length,
    },
  };
  return jsonResponse(stats);
}

async function handleBulkStatus(req: Request): Promise<Response> {
  const body = await parseBody<{ userIds?: string[]; status?: string }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
    return errorResponse("userIds array is required", 400);
  }
  if (!isValidEnum(body.status, STATUSES)) {
    return errorResponse("Invalid status. Must be 'active', 'suspended', or 'deleted'", 400);
  }

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const uid of body.userIds) {
    const user = userStore.getById(uid);
    if (!user) {
      results.push({ id: uid, success: false, error: "User not found" });
      continue;
    }
    userStore.update(uid, { status: body.status as User["status"], updatedAt: now() });
    userStore.logActivity(uid, "status_changed", `Status changed to ${body.status}`);
    results.push({ id: uid, success: true });
  }

  return jsonResponse(results);
}
