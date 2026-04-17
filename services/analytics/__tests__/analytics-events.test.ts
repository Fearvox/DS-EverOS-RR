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

describe("Analytics Events CRUD", () => {
  beforeEach(() => {
    analyticsStore.clear();
  });

  test("POST /analytics/events - track a single event", async () => {
    const res = await handleRequest(req("POST", "/analytics/events", {
      eventType: "page_view",
      userId: "u1",
      sessionId: "s1",
      properties: { page: "/home" },
      timestamp: "2026-01-15T10:00:00Z",
    }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.eventType).toBe("page_view");
    expect(body.data.userId).toBe("u1");
    expect(body.data.sessionId).toBe("s1");
    expect(body.data.properties.page).toBe("/home");
    expect(body.data.id).toBeDefined();
  });

  test("POST /analytics/events - missing eventType returns 400", async () => {
    const res = await handleRequest(req("POST", "/analytics/events", { userId: "u1" }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("eventType");
  });

  test("POST /analytics/events - invalid JSON returns 400", async () => {
    const r = new Request("http://localhost:3007/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleRequest(r);
    expect(res.status).toBe(400);
  });

  test("POST /analytics/events - defaults properties to empty object", async () => {
    const res = await handleRequest(req("POST", "/analytics/events", {
      eventType: "click",
    }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.properties).toEqual({});
  });

  test("POST /analytics/events - uses provided timestamp", async () => {
    const ts = "2026-03-01T12:00:00Z";
    const res = await handleRequest(req("POST", "/analytics/events", {
      eventType: "click",
      timestamp: ts,
    }));
    const body = await json(res);
    expect(body.data.timestamp).toBe(ts);
  });

  test("GET /analytics/events/:id - get event by id", async () => {
    const createRes = await handleRequest(req("POST", "/analytics/events", {
      eventType: "signup",
      userId: "u2",
    }));
    const created = await json(createRes);
    const id = created.data.id;

    const res = await handleRequest(req("GET", `/analytics/events/${id}`));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe(id);
    expect(body.data.eventType).toBe("signup");
  });

  test("GET /analytics/events/:id - not found returns 404", async () => {
    const res = await handleRequest(req("GET", "/analytics/events/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("DELETE /analytics/events/:id - delete event", async () => {
    const createRes = await handleRequest(req("POST", "/analytics/events", {
      eventType: "test",
    }));
    const created = await json(createRes);
    const id = created.data.id;

    const delRes = await handleRequest(req("DELETE", `/analytics/events/${id}`));
    expect(delRes.status).toBe(200);
    const delBody = await json(delRes);
    expect(delBody.data.deleted).toBe(true);

    const getRes = await handleRequest(req("GET", `/analytics/events/${id}`));
    expect(getRes.status).toBe(404);
  });

  test("DELETE /analytics/events/:id - not found returns 404", async () => {
    const res = await handleRequest(req("DELETE", "/analytics/events/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("GET /analytics/events - list events with pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await handleRequest(req("POST", "/analytics/events", {
        eventType: "click",
        timestamp: `2026-01-15T10:0${i}:00Z`,
      }));
    }

    const res = await handleRequest(req("GET", "/analytics/events?page=1&limit=2"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(2);
  });

  test("GET /analytics/events - page 2", async () => {
    for (let i = 0; i < 5; i++) {
      await handleRequest(req("POST", "/analytics/events", {
        eventType: "click",
        timestamp: `2026-01-15T10:0${i}:00Z`,
      }));
    }

    const res = await handleRequest(req("GET", "/analytics/events?page=2&limit=2"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.page).toBe(2);
  });
});

describe("Batch Tracking", () => {
  beforeEach(() => {
    analyticsStore.clear();
  });

  test("POST /analytics/events/batch - track multiple events", async () => {
    const res = await handleRequest(req("POST", "/analytics/events/batch", {
      events: [
        { eventType: "page_view", userId: "u1", timestamp: "2026-01-15T10:00:00Z" },
        { eventType: "click", userId: "u1", timestamp: "2026-01-15T10:01:00Z" },
        { eventType: "purchase", userId: "u2", timestamp: "2026-01-15T10:02:00Z" },
      ],
    }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.tracked).toBe(3);
    expect(body.data.results.length).toBe(3);
    expect(body.data.results.every((r: any) => r.success)).toBe(true);
    expect(analyticsStore.count()).toBe(3);
  });

  test("POST /analytics/events/batch - partial failure", async () => {
    const res = await handleRequest(req("POST", "/analytics/events/batch", {
      events: [
        { eventType: "click", userId: "u1" },
        { eventType: "", userId: "u2" }, // invalid
        { userId: "u3" }, // missing eventType
      ],
    }));
    const body = await json(res);
    expect(body.data.tracked).toBe(1);
    expect(body.data.results[0].success).toBe(true);
    expect(body.data.results[1].success).toBe(false);
    expect(body.data.results[2].success).toBe(false);
  });

  test("POST /analytics/events/batch - empty array returns 400", async () => {
    const res = await handleRequest(req("POST", "/analytics/events/batch", { events: [] }));
    expect(res.status).toBe(400);
  });

  test("POST /analytics/events/batch - missing events field returns 400", async () => {
    const res = await handleRequest(req("POST", "/analytics/events/batch", {}));
    expect(res.status).toBe(400);
  });
});

describe("Event Types", () => {
  beforeEach(() => {
    analyticsStore.clear();
  });

  test("GET /analytics/events/types - returns event type counts", async () => {
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-15T10:00:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "click", timestamp: "2026-01-15T10:01:00Z" }));
    await handleRequest(req("POST", "/analytics/events", { eventType: "page_view", timestamp: "2026-01-15T10:02:00Z" }));

    const res = await handleRequest(req("GET", "/analytics/events/types"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.length).toBe(2);
    // Sorted by count desc
    expect(body.data[0].type).toBe("click");
    expect(body.data[0].count).toBe(2);
    expect(body.data[1].type).toBe("page_view");
    expect(body.data[1].count).toBe(1);
  });

  test("GET /analytics/events/types - empty store", async () => {
    const res = await handleRequest(req("GET", "/analytics/events/types"));
    const body = await json(res);
    expect(body.data).toEqual([]);
  });
});

describe("Routing", () => {
  test("unknown route returns 404", async () => {
    const res = await handleRequest(req("GET", "/unknown"));
    expect(res.status).toBe(404);
  });

  test("unknown analytics sub-route returns 404", async () => {
    const res = await handleRequest(req("GET", "/analytics/unknown"));
    expect(res.status).toBe(404);
  });
});
