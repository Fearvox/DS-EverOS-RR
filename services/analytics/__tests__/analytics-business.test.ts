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

async function seedFunnelData() {
  const events = [
    // User 1: completes full funnel
    { eventType: "page_view", userId: "u1", timestamp: "2026-01-10T08:00:00Z" },
    { eventType: "signup", userId: "u1", timestamp: "2026-01-10T08:05:00Z" },
    { eventType: "purchase", userId: "u1", timestamp: "2026-01-10T08:10:00Z" },
    // User 2: drops off after signup
    { eventType: "page_view", userId: "u2", timestamp: "2026-01-10T09:00:00Z" },
    { eventType: "signup", userId: "u2", timestamp: "2026-01-10T09:05:00Z" },
    // User 3: only page_view
    { eventType: "page_view", userId: "u3", timestamp: "2026-01-10T10:00:00Z" },
    // User 4: completes full funnel
    { eventType: "page_view", userId: "u4", timestamp: "2026-01-11T08:00:00Z" },
    { eventType: "signup", userId: "u4", timestamp: "2026-01-11T08:05:00Z" },
    { eventType: "purchase", userId: "u4", timestamp: "2026-01-11T08:10:00Z" },
  ];
  for (const e of events) {
    await handleRequest(req("POST", "/analytics/events", e));
  }
}

async function seedRetentionData() {
  const events = [
    // User 1: active day 1, 2, 3
    { eventType: "visit", userId: "u1", timestamp: "2026-02-01T10:00:00Z" },
    { eventType: "visit", userId: "u1", timestamp: "2026-02-02T10:00:00Z" },
    { eventType: "visit", userId: "u1", timestamp: "2026-02-03T10:00:00Z" },
    // User 2: active day 1, 3
    { eventType: "visit", userId: "u2", timestamp: "2026-02-01T11:00:00Z" },
    { eventType: "visit", userId: "u2", timestamp: "2026-02-03T11:00:00Z" },
    // User 3: active day 1 only
    { eventType: "visit", userId: "u3", timestamp: "2026-02-01T12:00:00Z" },
    // User 4: active day 2, 3 (different cohort)
    { eventType: "visit", userId: "u4", timestamp: "2026-02-02T10:00:00Z" },
    { eventType: "visit", userId: "u4", timestamp: "2026-02-03T10:00:00Z" },
  ];
  for (const e of events) {
    await handleRequest(req("POST", "/analytics/events", e));
  }
}

async function seedTrendData() {
  const events = [
    { eventType: "click", timestamp: "2026-03-01T08:00:00Z" },
    { eventType: "click", timestamp: "2026-03-01T08:30:00Z" },
    { eventType: "click", timestamp: "2026-03-01T09:00:00Z" },
    { eventType: "click", timestamp: "2026-03-02T10:00:00Z" },
    { eventType: "click", timestamp: "2026-03-02T10:15:00Z" },
    { eventType: "page_view", timestamp: "2026-03-01T08:00:00Z" },
    { eventType: "page_view", timestamp: "2026-03-02T10:00:00Z" },
    { eventType: "page_view", timestamp: "2026-03-03T12:00:00Z" },
  ];
  for (const e of events) {
    await handleRequest(req("POST", "/analytics/events", e));
  }
}

describe("Funnel Analysis", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedFunnelData();
  });

  test("GET /analytics/funnel - 3-step funnel", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel?steps=page_view&steps=signup&steps=purchase"));
    expect(res.status).toBe(200);
    const body = await json(res);
    const data = body.data;

    expect(data.steps.length).toBe(3);
    expect(data.steps[0].step).toBe("page_view");
    expect(data.steps[0].users).toBe(4);
    expect(data.steps[1].step).toBe("signup");
    expect(data.steps[1].users).toBe(3); // u1, u2, u4
    expect(data.steps[2].step).toBe("purchase");
    expect(data.steps[2].users).toBe(2); // u1, u4
  });

  test("GET /analytics/funnel - conversion rates", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel?steps=page_view&steps=signup&steps=purchase"));
    const body = await json(res);
    const steps = body.data.steps;

    expect(steps[0].conversionRate).toBe(1); // first step always 100%
    expect(steps[1].conversionRate).toBe(3 / 4); // 3 of 4
    expect(steps[2].conversionRate).toBe(2 / 4); // 2 of 4
  });

  test("GET /analytics/funnel - dropoff rates", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel?steps=page_view&steps=signup&steps=purchase"));
    const body = await json(res);
    const steps = body.data.steps;

    expect(steps[0].dropoffRate).toBe(0);
    expect(steps[1].dropoffRate).toBe(1 - 3 / 4); // 25% dropped
    expect(steps[2].dropoffRate).toBeCloseTo(1 - 2 / 3, 5); // 33% dropped from step 2
  });

  test("GET /analytics/funnel - overall conversion", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel?steps=page_view&steps=signup&steps=purchase"));
    const body = await json(res);
    expect(body.data.overallConversion).toBe(2 / 4);
  });

  test("GET /analytics/funnel - less than 2 steps returns 400", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel?steps=page_view"));
    expect(res.status).toBe(400);
  });

  test("GET /analytics/funnel - no steps returns 400", async () => {
    const res = await handleRequest(req("GET", "/analytics/funnel"));
    expect(res.status).toBe(400);
  });
});

describe("Retention Analysis", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedRetentionData();
  });

  test("GET /analytics/retention - returns cohort data", async () => {
    const res = await handleRequest(req("GET", "/analytics/retention?periods=3"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.periods).toBe(3);
    expect(body.data.cohorts.length).toBeGreaterThan(0);
  });

  test("GET /analytics/retention - day 1 cohort retention", async () => {
    const res = await handleRequest(req("GET", "/analytics/retention?periods=3"));
    const body = await json(res);
    // Cohort 2026-02-01: u1, u2, u3
    const cohort1 = body.data.cohorts.find((c: any) => c.cohort === "2026-02-01");
    expect(cohort1).toBeDefined();
    expect(cohort1.users).toBe(3);
    expect(cohort1.retention[0]).toBe(1); // day 0: all present
    expect(cohort1.retention[1]).toBeCloseTo(1 / 3, 5); // day 1: only u1
    expect(cohort1.retention[2]).toBeCloseTo(2 / 3, 5); // day 2: u1, u2
  });

  test("GET /analytics/retention - day 2 cohort retention", async () => {
    const res = await handleRequest(req("GET", "/analytics/retention?periods=2"));
    const body = await json(res);
    // Cohort 2026-02-02: u4 (first event on day 2)
    const cohort2 = body.data.cohorts.find((c: any) => c.cohort === "2026-02-02");
    expect(cohort2).toBeDefined();
    expect(cohort2.users).toBe(1);
    expect(cohort2.retention[0]).toBe(1); // day 0
    expect(cohort2.retention[1]).toBe(1); // day 1: u4 active on day 3
  });

  test("GET /analytics/retention - empty store", async () => {
    analyticsStore.clear();
    const res = await handleRequest(req("GET", "/analytics/retention"));
    const body = await json(res);
    expect(body.data.cohorts).toEqual([]);
  });
});

describe("Dashboard Stats", () => {
  beforeEach(async () => {
    analyticsStore.clear();
  });

  test("GET /analytics/stats - returns all stats fields", async () => {
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", userId: "u1", sessionId: "s1", timestamp: "2026-01-10T08:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", userId: "u1", sessionId: "s2", timestamp: "2026-01-10T09:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "page_view", userId: "u2", sessionId: "s3", timestamp: "2026-01-11T10:00:00Z" }));

    const res = await handleRequest(req("GET", "/analytics/stats"));
    expect(res.status).toBe(200);
    const body = await json(res);
    const data = body.data;

    expect(data.totalEvents).toBe(3);
    expect(data.uniqueUsers).toBe(2);
    expect(data.uniqueSessions).toBe(3);
    expect(data.eventsPerDay).toBe(1.5);
    expect(data.topEventTypes.length).toBe(2);
    expect(data.topEventTypes[0].type).toBe("click");
    expect(data.topEventTypes[0].count).toBe(2);
  });

  test("GET /analytics/stats - empty store", async () => {
    const res = await handleRequest(req("GET", "/analytics/stats"));
    const body = await json(res);
    expect(body.data.totalEvents).toBe(0);
    expect(body.data.uniqueUsers).toBe(0);
    expect(body.data.uniqueSessions).toBe(0);
    expect(body.data.eventsPerDay).toBe(0);
    expect(body.data.topEventTypes).toEqual([]);
  });
});

describe("Trends", () => {
  beforeEach(async () => {
    analyticsStore.clear();
    await seedTrendData();
  });

  test("GET /analytics/trends - daily trend for click events", async () => {
    const res = await handleRequest(req("GET", "/analytics/trends?eventType=click&interval=day"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.interval).toBe("day");
    expect(body.data.eventType).toBe("click");

    const trend = body.data.trend;
    expect(trend.length).toBe(2);
    expect(trend[0].period).toBe("2026-03-01");
    expect(trend[0].count).toBe(3);
    expect(trend[1].period).toBe("2026-03-02");
    expect(trend[1].count).toBe(2);
  });

  test("GET /analytics/trends - hourly trend for click events", async () => {
    const res = await handleRequest(req("GET", "/analytics/trends?eventType=click&interval=hour"));
    const body = await json(res);
    expect(body.data.interval).toBe("hour");
    const trend = body.data.trend;
    // 3 distinct hours: 2026-03-01T08, 2026-03-01T09, 2026-03-02T10
    expect(trend.length).toBe(3);
  });

  test("GET /analytics/trends - all events when no eventType", async () => {
    const res = await handleRequest(req("GET", "/analytics/trends?interval=day"));
    const body = await json(res);
    expect(body.data.eventType).toBe("all");
    const trend = body.data.trend;
    expect(trend.find((t: any) => t.period === "2026-03-01").count).toBe(4); // 3 clicks + 1 page_view
    expect(trend.find((t: any) => t.period === "2026-03-02").count).toBe(3); // 2 clicks + 1 page_view
    expect(trend.find((t: any) => t.period === "2026-03-03").count).toBe(1);
  });

  test("GET /analytics/trends - invalid interval returns 400", async () => {
    const res = await handleRequest(req("GET", "/analytics/trends?interval=week"));
    expect(res.status).toBe(400);
  });

  test("GET /analytics/trends - defaults to day interval", async () => {
    const res = await handleRequest(req("GET", "/analytics/trends"));
    const body = await json(res);
    expect(body.data.interval).toBe("day");
  });
});

describe("Aggregation", () => {
  beforeEach(async () => {
    analyticsStore.clear();
  });

  test("GET /analytics/aggregate?field=eventType - aggregate by event type", async () => {
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-10T08:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-10T09:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "page_view", timestamp: "2026-01-10T10:00:00Z" }));

    const res = await handleRequest(req("GET", "/analytics/aggregate?field=eventType"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data[0].eventType).toBe("click");
    expect(body.data[0].count).toBe(2);
    expect(body.data[1].eventType).toBe("page_view");
    expect(body.data[1].count).toBe(1);
  });

  test("GET /analytics/aggregate?field=userId - aggregate by user", async () => {
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", userId: "u1", timestamp: "2026-01-10T08:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", userId: "u1", timestamp: "2026-01-10T09:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", userId: "u2", timestamp: "2026-01-10T10:00:00Z" }));

    const res = await handleRequest(req("GET", "/analytics/aggregate?field=userId"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data[0].userId).toBe("u1");
    expect(body.data[0].count).toBe(2);
  });

  test("GET /analytics/aggregate - invalid field returns 400", async () => {
    const res = await handleRequest(req("GET", "/analytics/aggregate?field=invalid"));
    expect(res.status).toBe(400);
  });

  test("GET /analytics/aggregate - missing field returns 400", async () => {
    const res = await handleRequest(req("GET", "/analytics/aggregate"));
    expect(res.status).toBe(400);
  });

  test("GET /analytics/aggregate?field=userId - anonymous users grouped", async () => {
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-10T08:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-10T09:00:00Z" }));

    const res = await handleRequest(req("GET", "/analytics/aggregate?field=userId"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].userId).toBe("anonymous");
    expect(body.data[0].count).toBe(2);
  });
});
