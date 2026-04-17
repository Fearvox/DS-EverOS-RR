import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { analyticsStore } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3007${path}`, opts);
}

async function json(r: Response) {
  return r.json();
}

// Seed helper — creates events with fixed timestamps
async function seedEvents() {
  const events = [
    { eventType: "page_view", userId: "u1", sessionId: "s1", timestamp: "2026-01-10T08:00:00Z", properties: { page: "/home" } },
    { eventType: "click", userId: "u1", sessionId: "s1", timestamp: "2026-01-10T08:05:00Z", properties: { button: "cta" } },
    { eventType: "page_view", userId: "u2", sessionId: "s2", timestamp: "2026-01-11T10:00:00Z", properties: { page: "/about" } },
    { eventType: "purchase", userId: "u2", sessionId: "s2", timestamp: "2026-01-11T10:30:00Z", properties: { amount: 99 } },
    { eventType: "page_view", userId: "u1", sessionId: "s3", timestamp: "2026-01-12T14:00:00Z", properties: { page: "/pricing" } },
    { eventType: "signup", userId: "u3", sessionId: "s4", timestamp: "2026-01-13T09:00:00Z", properties: {} },
    { eventType: "click", userId: "u3", sessionId: "s4", timestamp: "2026-01-13T09:10:00Z", properties: { button: "nav" } },
    { eventType: "purchase", userId: "u1", sessionId: "s3", timestamp: "2026-01-14T16:00:00Z", properties: { amount: 50 } },
  ];
  for (const e of events) {
    await handleRequest(req("POST", "/analytics/events", e));
  }
}

describe("Filtering by eventType", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("filter by eventType=page_view", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?eventType=page_view"));
    const body = await json(res);
    expect(body.data.length).toBe(3);
    expect(body.data.every((e: any) => e.eventType === "page_view")).toBe(true);
  });

  test("filter by eventType=purchase", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?eventType=purchase"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
  });

  test("filter by non-existent eventType returns empty", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?eventType=nonexistent"));
    const body = await json(res);
    expect(body.data.length).toBe(0);
  });
});

describe("Filtering by userId", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("filter by userId=u1", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?userId=u1"));
    const body = await json(res);
    expect(body.data.length).toBe(4);
    expect(body.data.every((e: any) => e.userId === "u1")).toBe(true);
  });

  test("filter by userId=u3", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?userId=u3"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
  });
});

describe("Filtering by sessionId", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("filter by sessionId=s1", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?sessionId=s1"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((e: any) => e.sessionId === "s1")).toBe(true);
  });

  test("filter by sessionId=s4", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?sessionId=s4"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
  });
});

describe("Date Range Filtering", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("filter by startDate", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?startDate=2026-01-12T00:00:00Z"));
    const body = await json(res);
    expect(body.data.length).toBe(4);
    expect(body.data.every((e: any) => e.timestamp >= "2026-01-12T00:00:00Z")).toBe(true);
  });

  test("filter by endDate", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?endDate=2026-01-11T23:59:59Z"));
    const body = await json(res);
    expect(body.data.length).toBe(4);
    expect(body.data.every((e: any) => e.timestamp <= "2026-01-11T23:59:59Z")).toBe(true);
  });

  test("filter by startDate and endDate", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?startDate=2026-01-11T00:00:00Z&endDate=2026-01-12T23:59:59Z"));
    const body = await json(res);
    expect(body.data.length).toBe(3);
  });

  test("combined filters: eventType + date range", async () => {
    const res = await handleRequest(req("GET", "/analytics/events?eventType=page_view&startDate=2026-01-11T00:00:00Z"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((e: any) => e.eventType === "page_view")).toBe(true);
  });
});

describe("User Events Endpoint", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("GET /analytics/user/:userId - returns all events for user", async () => {
    const res = await handleRequest(req("GET", "/analytics/user/u1"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(4);
    expect(body.data.every((e: any) => e.userId === "u1")).toBe(true);
  });

  test("GET /analytics/user/:userId - returns empty for unknown user", async () => {
    const res = await handleRequest(req("GET", "/analytics/user/unknown"));
    const body = await json(res);
    expect(body.data).toEqual([]);
  });

  test("GET /analytics/user/:userId - sorted by timestamp desc", async () => {
    const res = await handleRequest(req("GET", "/analytics/user/u1"));
    const body = await json(res);
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i - 1].timestamp >= body.data[i].timestamp).toBe(true);
    }
  });
});

describe("Session Events Endpoint", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedEvents();
  });

  test("GET /analytics/session/:sessionId - returns all events for session", async () => {
    const res = await handleRequest(req("GET", "/analytics/session/s2"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((e: any) => e.sessionId === "s2")).toBe(true);
  });

  test("GET /analytics/session/:sessionId - sorted by timestamp asc", async () => {
    const res = await handleRequest(req("GET", "/analytics/session/s1"));
    const body = await json(res);
    for (let i = 1; i < body.data.length; i++) {
      expect(body.data[i - 1].timestamp <= body.data[i].timestamp).toBe(true);
    }
  });
});

describe("Store Methods", () => {
  beforeEach(() => {
    analyticsStore.clear();
  });

  test("findByDateRange", () => {
    analyticsStore.create({ id: "1", eventType: "a", properties: {}, timestamp: "2026-01-10T00:00:00Z" });
    analyticsStore.create({ id: "2", eventType: "b", properties: {}, timestamp: "2026-01-15T00:00:00Z" });
    analyticsStore.create({ id: "3", eventType: "c", properties: {}, timestamp: "2026-01-20T00:00:00Z" });

    const result = analyticsStore.findByDateRange("2026-01-12T00:00:00Z", "2026-01-18T00:00:00Z");
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("2");
  });

  test("getUniqueUsers and getUniqueSessions", () => {
    analyticsStore.create({ id: "1", eventType: "a", userId: "u1", sessionId: "s1", properties: {}, timestamp: "2026-01-10T00:00:00Z" });
    analyticsStore.create({ id: "2", eventType: "b", userId: "u1", sessionId: "s2", properties: {}, timestamp: "2026-01-10T01:00:00Z" });
    analyticsStore.create({ id: "3", eventType: "c", userId: "u2", sessionId: "s2", properties: {}, timestamp: "2026-01-10T02:00:00Z" });

    expect(analyticsStore.getUniqueUsers().sort()).toEqual(["u1", "u2"]);
    expect(analyticsStore.getUniqueSessions().sort()).toEqual(["s1", "s2"]);
  });
});
