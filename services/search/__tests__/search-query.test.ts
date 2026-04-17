import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import { resetStore, indexDocument, search, autocomplete } from "../store";

function req(method: string, path: string, body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3008${path}`, init);
}

async function json(r: Response) {
  return r.json();
}

function seedDocuments() {
  indexDocument({
    collection: "articles",
    text: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript",
    content: { title: "TypeScript Guide" },
    tags: ["typescript", "javascript", "programming"],
  });
  indexDocument({
    collection: "articles",
    text: "JavaScript frameworks like React and Vue are popular for building web applications",
    content: { title: "JS Frameworks" },
    tags: ["javascript", "react", "vue"],
  });
  indexDocument({
    collection: "tutorials",
    text: "Learn Python programming from scratch with practical examples",
    content: { title: "Python Basics" },
    tags: ["python", "programming", "beginner"],
  });
  indexDocument({
    collection: "tutorials",
    text: "Advanced Python data science with pandas and numpy libraries",
    content: { title: "Python Data Science" },
    tags: ["python", "data-science"],
  });
  indexDocument({
    collection: "articles",
    text: "Building REST APIs with Express and Node.js for backend development",
    content: { title: "REST APIs" },
    tags: ["nodejs", "express", "backend"],
  });
}

describe("Search Query", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET /search?q=typescript - basic search", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=typescript"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    // TypeScript article should be in results
    expect(data.data.some((d: any) => d.content.title === "TypeScript Guide")).toBe(true);
  });

  test("GET /search?q= missing returns 400", async () => {
    const res = await handleRequest(req("GET", "/search"));
    expect(res.status).toBe(400);
  });

  test("GET /search?q=javascript - returns multiple matches", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=javascript"));
    const data = await json(res);
    expect(data.data.length).toBeGreaterThanOrEqual(2);
  });

  test("GET /search?q=python&collection=tutorials - filter by collection", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=python&collection=tutorials"));
    const data = await json(res);
    expect(data.data.length).toBe(2);
    expect(data.data.every((d: any) => d.collection === "tutorials")).toBe(true);
  });

  test("GET /search?q=programming&tags=python - filter by tags", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=programming&tags=python"));
    const data = await json(res);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data.every((d: any) => d.tags.includes("python"))).toBe(true);
  });

  test("GET /search?q=python&limit=1 - limit results", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=python&limit=1"));
    const data = await json(res);
    expect(data.data.length).toBe(1);
  });

  test("GET /search?q=python&offset=1&limit=1 - offset and limit", async () => {
    seedDocuments();
    const allRes = await handleRequest(req("GET", "/search?q=python"));
    const allData = await json(allRes);

    const res = await handleRequest(req("GET", "/search?q=python&offset=1&limit=1"));
    const data = await json(res);
    expect(data.data.length).toBe(1);
    if (allData.data.length > 1) {
      expect(data.data[0].id).toBe(allData.data[1].id);
    }
  });

  test("search returns TF scores", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=javascript"));
    const data = await json(res);
    for (const doc of data.data) {
      expect(doc.score).toBeGreaterThan(0);
      expect(typeof doc.score).toBe("number");
    }
  });

  test("TF scoring ranks higher frequency matches first", async () => {
    resetStore();
    indexDocument({
      collection: "test",
      text: "apple apple apple banana",
      content: {},
      tags: [],
    });
    indexDocument({
      collection: "test",
      text: "apple banana banana banana",
      content: {},
      tags: [],
    });
    const results = search("apple");
    expect(results.length).toBe(2);
    // First doc has 3/4 apple frequency, second has 1/4
    expect(results[0].score!).toBeGreaterThan(results[1].score!);
  });

  test("search is case insensitive", async () => {
    indexDocument({
      collection: "test",
      text: "TypeScript is Great",
      content: {},
      tags: [],
    });
    const results = search("typescript");
    expect(results.length).toBe(1);

    const results2 = search("TYPESCRIPT");
    expect(results2.length).toBe(1);
  });

  test("search with no matches returns empty", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search?q=zzzznonexistent"));
    const data = await json(res);
    expect(data.data.length).toBe(0);
  });

  test("search with multiple query terms", async () => {
    seedDocuments();
    const results = search("python programming");
    expect(results.length).toBeGreaterThan(0);
    // The doc with both terms should score higher
    const topResult = results[0];
    expect(topResult.text).toContain("Python programming");
  });
});

describe("Autocomplete", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET /search/autocomplete?q=type - prefix matching", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/autocomplete?q=type"));
    const data = await json(res);
    expect(data.success).toBe(true);
    expect(data.data).toContain("typescript");
    expect(data.data).toContain("typed");
  });

  test("GET /search/autocomplete - missing q returns 400", async () => {
    const res = await handleRequest(req("GET", "/search/autocomplete"));
    expect(res.status).toBe(400);
  });

  test("autocomplete filters by collection", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/autocomplete?q=py&collection=tutorials"));
    const data = await json(res);
    expect(data.data).toContain("python");
  });

  test("autocomplete returns sorted results", async () => {
    indexDocument({ collection: "test", text: "banana berry blueberry", content: {}, tags: [] });
    const suggestions = autocomplete("b");
    expect(suggestions).toEqual([...suggestions].sort());
  });

  test("autocomplete limits to 10 results", async () => {
    const words = Array.from({ length: 20 }, (_, i) => `prefix${String.fromCharCode(97 + i)}`);
    indexDocument({ collection: "test", text: words.join(" "), content: {}, tags: [] });
    const suggestions = autocomplete("prefix");
    expect(suggestions.length).toBeLessThanOrEqual(10);
  });

  test("autocomplete with empty prefix returns empty", async () => {
    seedDocuments();
    const suggestions = autocomplete("");
    expect(suggestions.length).toBe(0);
  });
});
