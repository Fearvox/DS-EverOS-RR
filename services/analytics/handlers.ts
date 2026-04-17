// Analytics service request handler — pure function, no server dependency

import type { AnalyticsEvent } from "../shared/types";
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
import { isNonEmptyString, isObject, isArray, validate } from "../shared/validation";
import { analyticsStore } from "./store";

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);

  if (segments[0] !== "analytics") {
    return errorResponse("Not found", 404);
  }

  // --- Top-level analytics routes ---

  // GET /analytics/stats
  if (method === "GET" && segments[1] === "stats" && segments.length === 2) {
    return handleStats(req);
  }

  // GET /analytics/trends
  if (method === "GET" && segments[1] === "trends" && segments.length === 2) {
    return handleTrends(req);
  }

  // GET /analytics/aggregate
  if (method === "GET" && segments[1] === "aggregate" && segments.length === 2) {
    return handleAggregate(req);
  }

  // GET /analytics/funnel
  if (method === "GET" && segments[1] === "funnel" && segments.length === 2) {
    return handleFunnel(req);
  }

  // GET /analytics/retention
  if (method === "GET" && segments[1] === "retention" && segments.length === 2) {
    return handleRetention(req);
  }

  // GET /analytics/user/:userId
  if (method === "GET" && segments[1] === "user" && segments.length === 3) {
    return handleUserEvents(segments[2]);
  }

  // GET /analytics/session/:sessionId
  if (method === "GET" && segments[1] === "session" && segments.length === 3) {
    return handleSessionEvents(segments[2]);
  }

  // --- /analytics/events routes ---
  if (segments[1] !== "events") {
    return errorResponse("Not found", 404);
  }

  // POST /analytics/events/batch
  if (method === "POST" && segments[2] === "batch" && segments.length === 3) {
    return handleBatchTrack(req);
  }

  // GET /analytics/events/types
  if (method === "GET" && segments[2] === "types" && segments.length === 3) {
    return handleEventTypes();
  }

  // GET /analytics/events
  if (method === "GET" && segments.length === 2) {
    return handleList(req);
  }

  // POST /analytics/events
  if (method === "POST" && segments.length === 2) {
    return handleTrack(req);
  }

  // GET /analytics/events/:id
  if (method === "GET" && segments.length === 3) {
    return handleGetById(segments[2]);
  }

  // DELETE /analytics/events/:id
  if (method === "DELETE" && segments.length === 3) {
    return handleDeleteEvent(segments[2]);
  }

  return errorResponse("Not found", 404);
}

// --- Handlers ---

function handleList(req: Request): Response {
  const params = getQueryParams(req);
  let events = analyticsStore.getAll();

  const eventType = params.get("eventType");
  if (eventType) {
    events = events.filter((e) => e.eventType === eventType);
  }

  const userId = params.get("userId");
  if (userId) {
    events = events.filter((e) => e.userId === userId);
  }

  const sessionId = params.get("sessionId");
  if (sessionId) {
    events = events.filter((e) => e.sessionId === sessionId);
  }

  const startDate = params.get("startDate");
  if (startDate) {
    events = events.filter((e) => e.timestamp >= startDate);
  }

  const endDate = params.get("endDate");
  if (endDate) {
    events = events.filter((e) => e.timestamp <= endDate);
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const total = events.length;
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(params.get("limit") || "20", 10) || 20));
  const start = (page - 1) * limit;
  const paged = events.slice(start, start + limit);

  return metaResponse(paged, { total, page, limit });
}

async function handleTrack(req: Request): Promise<Response> {
  const body = await parseBody<Partial<AnalyticsEvent>>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  const errors = validate([
    [isNonEmptyString(body.eventType), "eventType", "eventType is required"],
  ]);
  if (errors.length > 0) {
    return errorResponse(errors.map((e) => e.message).join("; "), 400);
  }

  const event: AnalyticsEvent = {
    id: generateId(),
    eventType: body.eventType!,
    userId: body.userId || undefined,
    sessionId: body.sessionId || undefined,
    properties: isObject(body.properties) ? body.properties : {},
    timestamp: isNonEmptyString(body.timestamp) ? body.timestamp : now(),
  };

  const created = analyticsStore.create(event);
  return jsonResponse(created, 201);
}

function handleGetById(id: string): Response {
  const event = analyticsStore.getById(id);
  if (!event) return errorResponse("Event not found", 404);
  return jsonResponse(event);
}

function handleDeleteEvent(id: string): Response {
  const event = analyticsStore.getById(id);
  if (!event) return errorResponse("Event not found", 404);
  analyticsStore.delete(id);
  return jsonResponse({ deleted: true });
}

async function handleBatchTrack(req: Request): Promise<Response> {
  const body = await parseBody<{ events?: Partial<AnalyticsEvent>[] }>(req);
  if (!body) return errorResponse("Invalid JSON body", 400);

  if (!isArray(body.events) || body.events.length === 0) {
    return errorResponse("events array is required and must not be empty", 400);
  }

  const results: { id: string; success: boolean; error?: string }[] = [];
  const created: AnalyticsEvent[] = [];

  for (const item of body.events) {
    if (!isNonEmptyString(item.eventType)) {
      results.push({ id: "", success: false, error: "eventType is required" });
      continue;
    }

    const event: AnalyticsEvent = {
      id: generateId(),
      eventType: item.eventType!,
      userId: item.userId || undefined,
      sessionId: item.sessionId || undefined,
      properties: isObject(item.properties) ? item.properties : {},
      timestamp: isNonEmptyString(item.timestamp) ? item.timestamp : now(),
    };

    const stored = analyticsStore.create(event);
    created.push(stored);
    results.push({ id: stored.id, success: true });
  }

  return jsonResponse({ tracked: created.length, results });
}

function handleEventTypes(): Response {
  const counts = analyticsStore.getEventTypeCounts();
  const types = Object.entries(counts).map(([type, count]) => ({ type, count }));
  types.sort((a, b) => b.count - a.count);
  return jsonResponse(types);
}

function handleAggregate(req: Request): Response {
  const params = getQueryParams(req);
  const field = params.get("field");

  if (field !== "eventType" && field !== "userId") {
    return errorResponse("field must be 'eventType' or 'userId'", 400);
  }

  const events = analyticsStore.getAll();
  const counts = new Map<string, number>();

  for (const event of events) {
    const key = field === "eventType" ? event.eventType : (event.userId || "anonymous");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const aggregation = Array.from(counts.entries())
    .map(([key, count]) => ({ [field]: key, count }))
    .sort((a, b) => b.count - a.count);

  return jsonResponse(aggregation);
}

function handleFunnel(req: Request): Response {
  const params = getQueryParams(req);
  const steps = params.getAll("steps");

  if (steps.length < 2) {
    return errorResponse("At least 2 steps are required (pass multiple steps query params)", 400);
  }

  const events = analyticsStore.getAll();

  // Group events by user
  const userEvents = new Map<string, AnalyticsEvent[]>();
  for (const event of events) {
    const uid = event.userId || event.sessionId || "anonymous";
    if (!userEvents.has(uid)) userEvents.set(uid, []);
    userEvents.get(uid)!.push(event);
  }

  // Sort each user's events by timestamp
  for (const evts of userEvents.values()) {
    evts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // For each step, count users who completed it (in order)
  const stepCounts: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    let count = 0;
    for (const evts of userEvents.values()) {
      // Check if user completed all steps up to i in order
      let eventIdx = 0;
      let completed = true;
      for (let s = 0; s <= i; s++) {
        const found = evts.findIndex((e, idx) => idx >= eventIdx && e.eventType === steps[s]);
        if (found === -1) {
          completed = false;
          break;
        }
        eventIdx = found + 1;
      }
      if (completed) count++;
    }
    stepCounts.push(count);
  }

  const funnelSteps = steps.map((step, i) => ({
    step,
    users: stepCounts[i],
    conversionRate: i === 0 ? 1 : stepCounts[0] > 0 ? stepCounts[i] / stepCounts[0] : 0,
    dropoffRate: i === 0 ? 0 : stepCounts[i - 1] > 0 ? 1 - stepCounts[i] / stepCounts[i - 1] : 0,
  }));

  return jsonResponse({
    steps: funnelSteps,
    totalUsers: userEvents.size,
    overallConversion: stepCounts[0] > 0 ? stepCounts[stepCounts.length - 1] / stepCounts[0] : 0,
  });
}

function handleRetention(req: Request): Response {
  const params = getQueryParams(req);
  const periods = Math.max(1, Math.min(30, parseInt(params.get("periods") || "7", 10) || 7));

  const events = analyticsStore.getAll();
  if (events.length === 0) {
    return jsonResponse({ cohorts: [], periods });
  }

  // Group events by user with their dates
  const userDates = new Map<string, Set<string>>();
  for (const event of events) {
    const uid = event.userId;
    if (!uid) continue;
    if (!userDates.has(uid)) userDates.set(uid, new Set());
    const day = event.timestamp.slice(0, 10); // YYYY-MM-DD
    userDates.get(uid)!.add(day);
  }

  // Determine cohort for each user (first active day)
  const cohorts = new Map<string, string[]>(); // cohortDay -> userIds
  for (const [uid, dates] of userDates.entries()) {
    const sortedDates = Array.from(dates).sort();
    const firstDay = sortedDates[0];
    if (!cohorts.has(firstDay)) cohorts.set(firstDay, []);
    cohorts.get(firstDay)!.push(uid);
  }

  // Sort cohort days
  const cohortDays = Array.from(cohorts.keys()).sort();

  // Calculate retention for each cohort
  const cohortData = cohortDays.map((cohortDay) => {
    const users = cohorts.get(cohortDay)!;
    const retention: number[] = [];

    for (let p = 0; p < periods; p++) {
      const targetDate = new Date(cohortDay + "T00:00:00Z");
      targetDate.setUTCDate(targetDate.getUTCDate() + p);
      const targetDay = targetDate.toISOString().slice(0, 10);

      const retained = users.filter((uid) => userDates.get(uid)!.has(targetDay)).length;
      retention.push(users.length > 0 ? retained / users.length : 0);
    }

    return {
      cohort: cohortDay,
      users: users.length,
      retention,
    };
  });

  return jsonResponse({ cohorts: cohortData, periods });
}

function handleUserEvents(userId: string): Response {
  const events = analyticsStore.findByUser(userId);
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return jsonResponse(events);
}

function handleSessionEvents(sessionId: string): Response {
  const events = analyticsStore.findBySession(sessionId);
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return jsonResponse(events);
}

function handleStats(req: Request): Response {
  const events = analyticsStore.getAll();
  const uniqueUsers = analyticsStore.getUniqueUsers();
  const uniqueSessions = analyticsStore.getUniqueSessions();
  const typeCounts = analyticsStore.getEventTypeCounts();

  // Events per day
  const dayCounts = new Map<string, number>();
  for (const event of events) {
    const day = event.timestamp.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }
  const days = Array.from(dayCounts.keys());
  const eventsPerDay = days.length > 0
    ? events.length / days.length
    : 0;

  // Top event types (sorted by count desc)
  const topEventTypes = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return jsonResponse({
    totalEvents: events.length,
    uniqueUsers: uniqueUsers.length,
    uniqueSessions: uniqueSessions.length,
    eventsPerDay: Math.round(eventsPerDay * 100) / 100,
    topEventTypes,
  });
}

function handleTrends(req: Request): Response {
  const params = getQueryParams(req);
  const eventType = params.get("eventType");
  const interval = params.get("interval") || "day";

  if (interval !== "hour" && interval !== "day") {
    return errorResponse("interval must be 'hour' or 'day'", 400);
  }

  let events = analyticsStore.getAll();
  if (eventType) {
    events = events.filter((e) => e.eventType === eventType);
  }

  const buckets = new Map<string, number>();
  for (const event of events) {
    let key: string;
    if (interval === "hour") {
      key = event.timestamp.slice(0, 13); // YYYY-MM-DDTHH
    } else {
      key = event.timestamp.slice(0, 10); // YYYY-MM-DD
    }
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const trend = Array.from(buckets.entries())
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return jsonResponse({ interval, eventType: eventType || "all", trend });
}
