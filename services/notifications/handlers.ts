// Notifications request handlers - pure function handleRequest(req: Request): Promise<Response>

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
import { isNonEmptyString, isValidEnum, isObject, validate } from "../shared/validation";
import type { Notification } from "../shared/types";
import { notificationStore } from "./store";

const VALID_TYPES = ["email", "sms", "push", "in_app"] as const;
const VALID_STATUSES = ["pending", "sent", "delivered", "failed", "read"] as const;

const TEMPLATES: Record<string, string> = {
  welcome: "Welcome {{name}}!",
  order_confirmed: "Order {{orderId}} confirmed",
  payment_received: "Payment of {{amount}} received",
};

function applyTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);

  if (segments[0] !== "notifications") {
    return errorResponse("Not found", 404);
  }

  // POST /notifications/bulk-send
  if (method === "POST" && segments[1] === "bulk-send") {
    const body = await parseBody<{
      userIds?: string[];
      title?: string;
      message?: string;
      type?: string;
    }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
      return errorResponse("userIds must be a non-empty array", 400);
    }
    const errors = validate([
      [isNonEmptyString(body.title), "title", "Title is required"],
      [isNonEmptyString(body.message), "message", "Message is required"],
      [isValidEnum(body.type, VALID_TYPES), "type", "Type must be one of: email, sms, push, in_app"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    const notifications: Notification[] = [];
    const timestamp = now();
    for (const userId of body.userIds) {
      if (!isNonEmptyString(userId)) continue;
      const notification: Notification = {
        id: generateId(),
        userId,
        type: body.type as Notification["type"],
        title: body.title as string,
        message: body.message as string,
        status: "pending",
        createdAt: timestamp,
      };
      notificationStore.create(notification);
      notifications.push(notification);
    }

    return jsonResponse({ sent: notifications.length, notifications }, 201);
  }

  // POST /notifications/template
  if (method === "POST" && segments[1] === "template") {
    const body = await parseBody<{
      templateName?: string;
      variables?: Record<string, string>;
      userId?: string;
      type?: string;
    }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isNonEmptyString(body.templateName), "templateName", "Template name is required"],
      [isNonEmptyString(body.userId), "userId", "User ID is required"],
      [isValidEnum(body.type, VALID_TYPES), "type", "Type must be one of: email, sms, push, in_app"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    const template = TEMPLATES[body.templateName as string];
    if (!template) {
      return errorResponse(`Template '${body.templateName}' not found. Available: ${Object.keys(TEMPLATES).join(", ")}`, 404);
    }

    const variables = body.variables && isObject(body.variables) ? body.variables : {};
    const message = applyTemplate(template, variables as Record<string, string>);
    const title = body.templateName as string;

    const notification: Notification = {
      id: generateId(),
      userId: body.userId as string,
      type: body.type as Notification["type"],
      title,
      message,
      status: "pending",
      metadata: { templateName: body.templateName, variables },
      createdAt: now(),
    };
    notificationStore.create(notification);
    return jsonResponse(notification, 201);
  }

  // Routes with /notifications/user/:userId
  if (segments[1] === "user" && segments[2]) {
    const userId = segments[2];

    // PUT /notifications/user/:userId/read-all
    if (method === "PUT" && segments[3] === "read-all") {
      const count = notificationStore.markAllRead(userId);
      return jsonResponse({ userId, markedAsRead: count });
    }

    // GET /notifications/user/:userId/unread
    if (method === "GET" && segments[3] === "unread") {
      const unread = notificationStore.findByUser(userId).filter((n) => n.status !== "read");
      return jsonResponse({ userId, unreadCount: unread.length, notifications: unread });
    }

    // GET /notifications/user/:userId
    if (method === "GET" && !segments[3]) {
      const notifications = notificationStore.findByUser(userId);
      return jsonResponse(notifications);
    }

    return errorResponse("Not found", 404);
  }

  // Routes with /notifications/:id
  if (segments[1] && segments[1] !== "user") {
    const id = segments[1];

    // POST /notifications/:id/send
    if (method === "POST" && segments[2] === "send") {
      const notification = notificationStore.getById(id);
      if (!notification) return errorResponse("Notification not found", 404);
      if (notification.status === "sent" || notification.status === "delivered") {
        return errorResponse("Notification already sent", 409);
      }
      const updated = notificationStore.update(id, { status: "sent" } as Partial<Notification>);
      return jsonResponse(updated);
    }

    // PUT /notifications/:id/read
    if (method === "PUT" && segments[2] === "read") {
      const notification = notificationStore.getById(id);
      if (!notification) return errorResponse("Notification not found", 404);
      const updated = notificationStore.markAsRead(id);
      return jsonResponse(updated);
    }

    // GET /notifications/:id
    if (method === "GET" && !segments[2]) {
      const notification = notificationStore.getById(id);
      if (!notification) return errorResponse("Notification not found", 404);
      return jsonResponse(notification);
    }

    // PUT /notifications/:id
    if (method === "PUT" && !segments[2]) {
      const notification = notificationStore.getById(id);
      if (!notification) return errorResponse("Notification not found", 404);
      const body = await parseBody<Partial<Notification>>(req);
      if (!body) return errorResponse("Invalid JSON body", 400);

      // Only allow updating certain fields
      const updates: Partial<Notification> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.message !== undefined) updates.message = body.message;
      if (body.type !== undefined) {
        if (!isValidEnum(body.type, VALID_TYPES)) {
          return errorResponse("Type must be one of: email, sms, push, in_app", 400);
        }
        updates.type = body.type;
      }
      if (body.status !== undefined) {
        if (!isValidEnum(body.status, VALID_STATUSES)) {
          return errorResponse("Invalid status", 400);
        }
        updates.status = body.status;
      }
      if (body.metadata !== undefined) updates.metadata = body.metadata;

      const updated = notificationStore.update(id, updates as Partial<Notification>);
      return jsonResponse(updated);
    }

    // DELETE /notifications/:id
    if (method === "DELETE" && !segments[2]) {
      const notification = notificationStore.getById(id);
      if (!notification) return errorResponse("Notification not found", 404);
      notificationStore.delete(id);
      return jsonResponse({ deleted: true, id });
    }

    return errorResponse("Not found", 404);
  }

  // GET /notifications (list with filters)
  if (method === "GET" && !segments[1]) {
    const params = getQueryParams(req);
    const userId = params.get("userId");
    const type = params.get("type");
    const status = params.get("status");
    const page = parseInt(params.get("page") || "1", 10);
    const limit = parseInt(params.get("limit") || "20", 10);

    let results = notificationStore.getAll();

    if (userId) results = results.filter((n) => n.userId === userId);
    if (type) results = results.filter((n) => n.type === type);
    if (status) results = results.filter((n) => n.status === status);

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return metaResponse(paginated, { total, page, limit });
  }

  // POST /notifications (create)
  if (method === "POST" && !segments[1]) {
    const body = await parseBody<{
      userId?: string;
      type?: string;
      title?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    }>(req);
    if (!body) return errorResponse("Invalid JSON body", 400);

    const errors = validate([
      [isNonEmptyString(body.userId), "userId", "User ID is required"],
      [isValidEnum(body.type, VALID_TYPES), "type", "Type must be one of: email, sms, push, in_app"],
      [isNonEmptyString(body.title), "title", "Title is required"],
      [isNonEmptyString(body.message), "message", "Message is required"],
    ]);
    if (errors.length > 0) return errorResponse(errors[0].message, 400);

    const notification: Notification = {
      id: generateId(),
      userId: body.userId as string,
      type: body.type as Notification["type"],
      title: body.title as string,
      message: body.message as string,
      status: "pending",
      metadata: body.metadata,
      createdAt: now(),
    };
    notificationStore.create(notification);
    return jsonResponse(notification, 201);
  }

  return errorResponse("Not found", 404);
}
