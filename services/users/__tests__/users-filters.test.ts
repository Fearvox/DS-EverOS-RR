import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { userStore } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost:3002${path}`, opts);
}

async function json(r: Response) {
  return r.json();
}

async function createUser(name: string, email: string, role: "user" | "admin" = "user") {
  const res = await handleRequest(req("POST", "/users", { name, email, role }));
  return (await json(res)).data;
}

beforeEach(() => {
  userStore.clearAll();
});

describe("GET /users - list users", () => {
  test("returns empty list initially", async () => {
    const res = await handleRequest(req("GET", "/users"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  test("returns all created users", async () => {
    await createUser("Alice", "a@t.com");
    await createUser("Bob", "b@t.com");
    const res = await handleRequest(req("GET", "/users"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(2);
  });

  test("includes pagination meta", async () => {
    await createUser("A", "a@t.com");
    const res = await handleRequest(req("GET", "/users?page=1&limit=10"));
    const body = await json(res);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(10);
  });
});

describe("GET /users?role= - filter by role", () => {
  test("filters users by role", async () => {
    await createUser("Admin1", "ad1@t.com", "admin");
    await createUser("User1", "u1@t.com", "user");
    await createUser("Admin2", "ad2@t.com", "admin");

    const res = await handleRequest(req("GET", "/users?role=admin"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.data.every((u: any) => u.role === "admin")).toBe(true);
  });

  test("ignores invalid role filter", async () => {
    await createUser("A", "a@t.com");
    const res = await handleRequest(req("GET", "/users?role=invalid"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
  });
});

describe("GET /users?status= - filter by status", () => {
  test("filters by active status", async () => {
    const u = await createUser("A", "a@t.com");
    await createUser("B", "b@t.com");
    await handleRequest(req("PUT", `/users/${u.id}/suspend`));

    const res = await handleRequest(req("GET", "/users?status=active"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("active");
  });

  test("filters by suspended status", async () => {
    const u = await createUser("A", "a@t.com");
    await handleRequest(req("PUT", `/users/${u.id}/suspend`));

    const res = await handleRequest(req("GET", "/users?status=suspended"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("suspended");
  });
});

describe("GET /users?search= - search users", () => {
  test("searches by name", async () => {
    await createUser("Alice Smith", "a@t.com");
    await createUser("Bob Jones", "b@t.com");

    const res = await handleRequest(req("GET", "/users?search=alice"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Alice Smith");
  });

  test("searches by email", async () => {
    await createUser("Alice", "alice@example.com");
    await createUser("Bob", "bob@test.com");

    const res = await handleRequest(req("GET", "/users?search=example"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
    expect(body.data[0].email).toBe("alice@example.com");
  });

  test("search is case-insensitive", async () => {
    await createUser("Alice", "a@t.com");
    const res = await handleRequest(req("GET", "/users?search=ALICE"));
    const body = await json(res);
    expect(body.data.length).toBe(1);
  });

  test("returns empty for no match", async () => {
    await createUser("Alice", "a@t.com");
    const res = await handleRequest(req("GET", "/users?search=zzz"));
    const body = await json(res);
    expect(body.data.length).toBe(0);
  });
});

describe("pagination", () => {
  test("paginates results with limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createUser(`User${i}`, `u${i}@t.com`);
    }

    const res = await handleRequest(req("GET", "/users?page=1&limit=2"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(2);
  });

  test("returns second page", async () => {
    for (let i = 0; i < 5; i++) {
      await createUser(`User${i}`, `u${i}@t.com`);
    }

    const p1 = await handleRequest(req("GET", "/users?page=1&limit=2"));
    const p2 = await handleRequest(req("GET", "/users?page=2&limit=2"));
    const b1 = await json(p1);
    const b2 = await json(p2);
    expect(b1.data[0].name).not.toBe(b2.data[0].name);
    expect(b2.data.length).toBe(2);
  });

  test("returns empty for page beyond data", async () => {
    await createUser("A", "a@t.com");
    const res = await handleRequest(req("GET", "/users?page=99&limit=10"));
    const body = await json(res);
    expect(body.data.length).toBe(0);
    expect(body.meta.total).toBe(1);
  });

  test("defaults to page 1 limit 20", async () => {
    await createUser("A", "a@t.com");
    const res = await handleRequest(req("GET", "/users"));
    const body = await json(res);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(20);
  });

  test("combined filter and pagination", async () => {
    for (let i = 0; i < 4; i++) {
      await createUser(`Admin${i}`, `admin${i}@t.com`, "admin");
    }
    await createUser("User0", "user0@t.com", "user");

    const res = await handleRequest(req("GET", "/users?role=admin&page=1&limit=2"));
    const body = await json(res);
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(4);
  });
});
