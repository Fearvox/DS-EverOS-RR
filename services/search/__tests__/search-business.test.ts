import { describe, test, expect, beforeEach } from "bun:test";
import { handleRequest } from "../handlers";
import {
  resetStore,
  indexDocument,
  getCollections,
  getFacets,
  getStats,
  findSimilar,
  findByCollection,
  findByTags,
  reindex,
  deleteFromIndex,
} from "../store";

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
    id: "doc-1",
    collection: "articles",
    text: "TypeScript is a typed superset of JavaScript",
    content: { author: "Alice", category: "web" },
    tags: ["typescript", "javascript", "programming"],
  });
  indexDocument({
    id: "doc-2",
    collection: "articles",
    text: "JavaScript frameworks like React and Vue are popular",
    content: { author: "Bob", category: "web" },
    tags: ["javascript", "react", "programming"],
  });
  indexDocument({
    id: "doc-3",
    collection: "tutorials",
    text: "Learn Python programming from scratch",
    content: { author: "Alice", category: "data" },
    tags: ["python", "programming", "beginner"],
  });
  indexDocument({
    id: "doc-4",
    collection: "tutorials",
    text: "Advanced Python data science with pandas",
    content: { author: "Charlie", category: "data" },
    tags: ["python", "data-science"],
  });
}

describe("Facets", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET /search/facets/collection - collection facets", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/facets/collection"));
    const data = await json(res);
    expect(data.data.articles).toBe(2);
    expect(data.data.tutorials).toBe(2);
  });

  test("GET /search/facets/tags - tag facets", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/facets/tags"));
    const data = await json(res);
    expect(data.data.programming).toBe(3);
    expect(data.data.python).toBe(2);
    expect(data.data.javascript).toBe(2);
  });

  test("getFacets for content field", () => {
    seedDocuments();
    const facets = getFacets("author");
    expect(facets["Alice"]).toBe(2);
    expect(facets["Bob"]).toBe(1);
    expect(facets["Charlie"]).toBe(1);
  });

  test("getFacets for category content field", () => {
    seedDocuments();
    const facets = getFacets("category");
    expect(facets["web"]).toBe(2);
    expect(facets["data"]).toBe(2);
  });

  test("getFacets for nonexistent field returns empty", () => {
    seedDocuments();
    const facets = getFacets("nonexistent");
    expect(Object.keys(facets).length).toBe(0);
  });
});

describe("Collections", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET /search/collections - list collections with counts", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/collections"));
    const data = await json(res);
    expect(data.data.articles).toBe(2);
    expect(data.data.tutorials).toBe(2);
  });

  test("getCollections with empty store", () => {
    const collections = getCollections();
    expect(Object.keys(collections).length).toBe(0);
  });

  test("findByCollection returns matching docs", () => {
    seedDocuments();
    const articles = findByCollection("articles");
    expect(articles.length).toBe(2);
    expect(articles.every((d) => d.collection === "articles")).toBe(true);
  });

  test("findByTags returns docs with all specified tags", () => {
    seedDocuments();
    const docs = findByTags(["programming", "javascript"]);
    expect(docs.length).toBe(2);
    expect(docs.every((d) => d.tags.includes("programming") && d.tags.includes("javascript"))).toBe(true);
  });

  test("findByTags with no matches returns empty", () => {
    seedDocuments();
    const docs = findByTags(["nonexistent-tag"]);
    expect(docs.length).toBe(0);
  });
});

describe("Stats", () => {
  beforeEach(() => {
    resetStore();
  });

  test("GET /search/stats - index statistics", async () => {
    seedDocuments();
    const res = await handleRequest(req("GET", "/search/stats"));
    const data = await json(res);
    expect(data.data.totalDocs).toBe(4);
    expect(data.data.byCollection.articles).toBe(2);
    expect(data.data.byCollection.tutorials).toBe(2);
    expect(data.data.avgDocLength).toBeGreaterThan(0);
  });

  test("getStats with empty store", () => {
    const stats = getStats();
    expect(stats.totalDocs).toBe(0);
    expect(stats.avgDocLength).toBe(0);
    expect(Object.keys(stats.byCollection).length).toBe(0);
  });

  test("getStats avgDocLength calculation", () => {
    indexDocument({ collection: "test", text: "one two three", content: {}, tags: [] });
    indexDocument({ collection: "test", text: "four five six seven", content: {}, tags: [] });
    const stats = getStats();
    expect(stats.avgDocLength).toBe(3.5); // (3 + 4) / 2
  });
});

describe("Similar Documents", () => {
  beforeEach(() => {
    resetStore();
  });

  test("POST /search/similar/:id - find similar documents", async () => {
    seedDocuments();
    const res = await handleRequest(req("POST", "/search/similar/doc-1"));
    const data = await json(res);
    expect(data.success).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    // doc-2 shares javascript + programming tags and similar text
    expect(data.data.some((d: any) => d.id === "doc-2")).toBe(true);
  });

  test("POST /search/similar/:id - not found returns 404", async () => {
    const res = await handleRequest(req("POST", "/search/similar/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("findSimilar scores based on tags and text overlap", () => {
    seedDocuments();
    const similar = findSimilar("doc-1");
    expect(similar.length).toBeGreaterThan(0);
    // All results should have scores
    for (const doc of similar) {
      expect(doc.score).toBeGreaterThan(0);
    }
    // doc-2 (shares javascript tag + programming tag) should rank high
    const doc2Index = similar.findIndex((d) => d.id === "doc-2");
    expect(doc2Index).toBeLessThan(2); // top 2
  });

  test("findSimilar excludes the source document", () => {
    seedDocuments();
    const similar = findSimilar("doc-1");
    expect(similar.every((d) => d.id !== "doc-1")).toBe(true);
  });

  test("findSimilar with no similar docs returns empty", () => {
    indexDocument({
      id: "lonely",
      collection: "unique",
      text: "zzzzz yyyyy xxxxx",
      content: {},
      tags: ["uniquetag"],
    });
    const similar = findSimilar("lonely");
    expect(similar.length).toBe(0);
  });
});

describe("Reindex", () => {
  beforeEach(() => {
    resetStore();
  });

  test("POST /search/reindex-collection - reindex all docs in collection", async () => {
    seedDocuments();
    const res = await handleRequest(
      req("POST", "/search/reindex-collection", { collection: "articles" })
    );
    const data = await json(res);
    expect(data.data.reindexed).toBe(2);
  });

  test("POST /search/reindex-collection - missing collection returns 400", async () => {
    const res = await handleRequest(
      req("POST", "/search/reindex-collection", {})
    );
    expect(res.status).toBe(400);
  });

  test("reindex updates indexedAt timestamp", async () => {
    const doc = indexDocument({
      id: "reindex-test",
      collection: "test",
      text: "reindex me",
      content: {},
      tags: [],
    });
    const originalIndexedAt = doc.indexedAt;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    const reindexed = reindex("reindex-test");
    expect(reindexed).toBeDefined();
    expect(reindexed!.indexedAt).not.toBe(originalIndexedAt);
  });

  test("reindex nonexistent returns undefined", () => {
    const result = reindex("nonexistent");
    expect(result).toBeUndefined();
  });

  test("deleteFromIndex removes from search results", () => {
    indexDocument({ id: "del-1", collection: "test", text: "searchable content here", content: {}, tags: [] });
    const { search } = require("../store");
    let results = search("searchable");
    expect(results.length).toBe(1);

    deleteFromIndex("del-1");
    results = search("searchable");
    expect(results.length).toBe(0);
  });

  test("deleteFromIndex nonexistent returns false", () => {
    const result = deleteFromIndex("nonexistent");
    expect(result).toBe(false);
  });
});
