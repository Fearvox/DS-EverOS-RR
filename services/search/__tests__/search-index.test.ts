import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { resetStore } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3008${path}`, init);
}

async function json(r: Response) {
  return r.json();
}

describe("Search Index CRUD", () => {
  beforeEach(() => {
    resetStore();
  });

  test("POST /search/index - index a document", async () => {
    const res = await handleRequest(
      req("POST", "/search/index", {
        collection: "articles",
        text: "TypeScript is a typed superset of JavaScript",
        content: { title: "TypeScript Intro" },
        tags: ["typescript", "programming"],
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.success).toBe(true);
    expect(data.data.id).toBeDefined();
    expect(data.data.collection).toBe("articles");
    expect(data.data.text).toBe("TypeScript is a typed superset of JavaScript");
    expect(data.data.tags).toEqual(["typescript", "programming"]);
    expect(data.data.indexedAt).toBeDefined();
  });

  test("POST /search/index - missing collection returns 400", async () => {
    const res = await handleRequest(
      req("POST", "/search/index", { text: "some text" })
    );
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.success).toBe(false);
    expect(data.error).toContain("collection");
  });

  test("POST /search/index - missing text returns 400", async () => {
    const res = await handleRequest(
      req("POST", "/search/index", { collection: "articles" })
    );
    expect(res.status).toBe(400);
    const data = await json(res);
    expect(data.success).toBe(false);
    expect(data.error).toContain("text");
  });

  test("POST /search/index - empty body returns 400", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3008/search/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{{{",
      })
    );
    expect(res.status).toBe(400);
  });

  test("POST /search/index - defaults content and tags", async () => {
    const res = await handleRequest(
      req("POST", "/search/index", {
        collection: "notes",
        text: "A simple note",
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.data.content).toEqual({});
    expect(data.data.tags).toEqual([]);
  });

  test("GET /search/index/:id - get document by id", async () => {
    const createRes = await handleRequest(
      req("POST", "/search/index", {
        collection: "articles",
        text: "Hello world",
        tags: ["greeting"],
      })
    );
    const created = await json(createRes);
    const id = created.data.id;

    const getRes = await handleRequest(req("GET", `/search/index/${id}`));
    expect(getRes.status).toBe(200);
    const data = await json(getRes);
    expect(data.data.id).toBe(id);
    expect(data.data.text).toBe("Hello world");
  });

  test("GET /search/index/:id - not found returns 404", async () => {
    const res = await handleRequest(req("GET", "/search/index/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("PUT /search/index/:id - update document", async () => {
    const createRes = await handleRequest(
      req("POST", "/search/index", {
        collection: "articles",
        text: "Original text",
      })
    );
    const created = await json(createRes);
    const id = created.data.id;

    const updateRes = await handleRequest(
      req("PUT", `/search/index/${id}`, {
        text: "Updated text content",
        tags: ["updated"],
      })
    );
    expect(updateRes.status).toBe(200);
    const data = await json(updateRes);
    expect(data.data.text).toBe("Updated text content");
    expect(data.data.tags).toEqual(["updated"]);
  });

  test("PUT /search/index/:id - not found returns 404", async () => {
    const res = await handleRequest(
      req("PUT", "/search/index/nonexistent", { text: "new" })
    );
    expect(res.status).toBe(404);
  });

  test("PUT /search/index/:id - invalid body returns 400", async () => {
    const res = await handleRequest(
      new Request("http://localhost:3008/search/index/some-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "bad{json",
      })
    );
    expect(res.status).toBe(400);
  });

  test("DELETE /search/index/:id - delete document", async () => {
    const createRes = await handleRequest(
      req("POST", "/search/index", {
        collection: "articles",
        text: "To be deleted",
      })
    );
    const created = await json(createRes);
    const id = created.data.id;

    const deleteRes = await handleRequest(req("DELETE", `/search/index/${id}`));
    expect(deleteRes.status).toBe(200);
    const data = await json(deleteRes);
    expect(data.data.deleted).toBe(true);

    // Confirm gone
    const getRes = await handleRequest(req("GET", `/search/index/${id}`));
    expect(getRes.status).toBe(404);
  });

  test("DELETE /search/index/:id - not found returns 404", async () => {
    const res = await handleRequest(req("DELETE", "/search/index/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("POST /search/index/bulk - bulk index documents", async () => {
    const res = await handleRequest(
      req("POST", "/search/index/bulk", {
        documents: [
          { collection: "articles", text: "First article about cats" },
          { collection: "articles", text: "Second article about dogs" },
          { collection: "notes", text: "A quick note" },
        ],
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.data.indexed.length).toBe(3);
    expect(data.data.errors.length).toBe(0);
  });

  test("POST /search/index/bulk - partial failures", async () => {
    const res = await handleRequest(
      req("POST", "/search/index/bulk", {
        documents: [
          { collection: "articles", text: "Valid document" },
          { text: "Missing collection" },
          { collection: "articles" },
        ],
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.data.indexed.length).toBe(1);
    expect(data.data.errors.length).toBe(2);
  });

  test("POST /search/index/bulk - missing documents array returns 400", async () => {
    const res = await handleRequest(
      req("POST", "/search/index/bulk", { notDocuments: [] })
    );
    expect(res.status).toBe(400);
  });

  test("POST /search/index/bulk - empty array succeeds", async () => {
    const res = await handleRequest(
      req("POST", "/search/index/bulk", { documents: [] })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.data.indexed.length).toBe(0);
  });

  test("unknown route returns 404", async () => {
    const res = await handleRequest(req("GET", "/unknown/path"));
    expect(res.status).toBe(404);
  });

  test("POST /search/index - with custom id", async () => {
    const res = await handleRequest(
      req("POST", "/search/index", {
        id: "custom-id-123",
        collection: "articles",
        text: "Custom ID document",
      })
    );
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.data.id).toBe("custom-id-123");
  });
});
