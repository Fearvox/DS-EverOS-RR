import {
  jsonResponse,
  errorResponse,
  metaResponse,
  parseBody,
  getPathSegments,
  getQueryParams,
} from "../shared/http";
import { isNonEmptyString, isArray, isObject } from "../shared/validation";
import type { SearchDocument } from "../shared/types";
import {
  indexDocument,
  search,
  autocomplete,
  findByCollection,
  findByTags,
  getFacets,
  reindex,
  deleteFromIndex,
  getDocument,
  updateDocument,
  getCollections,
  getStats,
  findSimilar,
  getAllDocuments,
} from "./store";

export async function handleRequest(req: Request): Promise<Response> {
  const method = req.method;
  const segments = getPathSegments(req);
  const params = getQueryParams(req);

  try {
    // GET /search - search documents
    if (method === "GET" && segments.length === 1 && segments[0] === "search") {
      const q = params.get("q");
      if (!q) return errorResponse("Query parameter 'q' is required", 400);

      const collection = params.get("collection") || undefined;
      const tagsParam = params.get("tags");
      const tags = tagsParam ? tagsParam.split(",") : undefined;
      const limit = params.get("limit") ? parseInt(params.get("limit")!, 10) : undefined;
      const offset = params.get("offset") ? parseInt(params.get("offset")!, 10) : undefined;

      const results = search(q, { collection, tags, limit, offset });
      return metaResponse(results, { total: results.length, limit: limit || 20 });
    }

    // GET /search/autocomplete?q=prefix&collection=X
    if (method === "GET" && segments.length === 2 && segments[0] === "search" && segments[1] === "autocomplete") {
      const q = params.get("q");
      if (!q) return errorResponse("Query parameter 'q' is required", 400);
      const collection = params.get("collection") || undefined;
      const suggestions = autocomplete(q, collection);
      return jsonResponse(suggestions);
    }

    // GET /search/collections
    if (method === "GET" && segments.length === 2 && segments[0] === "search" && segments[1] === "collections") {
      return jsonResponse(getCollections());
    }

    // GET /search/stats
    if (method === "GET" && segments.length === 2 && segments[0] === "search" && segments[1] === "stats") {
      return jsonResponse(getStats());
    }

    // GET /search/facets/:field
    if (method === "GET" && segments.length === 3 && segments[0] === "search" && segments[1] === "facets") {
      const field = segments[2];
      if (!isNonEmptyString(field)) return errorResponse("Field parameter is required", 400);
      return jsonResponse(getFacets(field));
    }

    // POST /search/index - index a document
    if (method === "POST" && segments.length === 2 && segments[0] === "search" && segments[1] === "index") {
      const body = await parseBody<Partial<SearchDocument>>(req);
      if (!body) return errorResponse("Invalid request body", 400);
      if (!isNonEmptyString(body.collection)) return errorResponse("collection is required", 400);
      if (!isNonEmptyString(body.text)) return errorResponse("text is required", 400);

      const doc = indexDocument({
        id: body.id,
        collection: body.collection!,
        content: isObject(body.content) ? body.content : {},
        text: body.text!,
        tags: isArray(body.tags) ? (body.tags as string[]) : [],
      });
      return jsonResponse(doc, 201);
    }

    // POST /search/index/bulk - bulk index documents
    if (method === "POST" && segments.length === 3 && segments[0] === "search" && segments[1] === "index" && segments[2] === "bulk") {
      const body = await parseBody<{ documents: Partial<SearchDocument>[] }>(req);
      if (!body || !isArray(body.documents)) return errorResponse("documents array is required", 400);

      const results: SearchDocument[] = [];
      const errors: string[] = [];

      for (let i = 0; i < body.documents.length; i++) {
        const item = body.documents[i];
        if (!isNonEmptyString(item.collection) || !isNonEmptyString(item.text)) {
          errors.push(`Document at index ${i}: collection and text are required`);
          continue;
        }
        const doc = indexDocument({
          id: item.id,
          collection: item.collection!,
          content: isObject(item.content) ? item.content : {},
          text: item.text!,
          tags: isArray(item.tags) ? (item.tags as string[]) : [],
        });
        results.push(doc);
      }

      return jsonResponse({ indexed: results, errors }, 201);
    }

    // POST /search/similar/:id - find similar documents
    if (method === "POST" && segments.length === 3 && segments[0] === "search" && segments[1] === "similar") {
      const id = segments[2];
      const doc = getDocument(id);
      if (!doc) return errorResponse("Document not found", 404);
      const similar = findSimilar(id);
      return jsonResponse(similar);
    }

    // POST /search/reindex-collection - reindex all docs in a collection
    if (method === "POST" && segments.length === 2 && segments[0] === "search" && segments[1] === "reindex-collection") {
      const body = await parseBody<{ collection: string }>(req);
      if (!body || !isNonEmptyString(body.collection)) return errorResponse("collection is required", 400);

      const docs = findByCollection(body.collection);
      const reindexed: SearchDocument[] = [];
      for (const doc of docs) {
        const result = reindex(doc.id);
        if (result) reindexed.push(result);
      }
      return jsonResponse({ reindexed: reindexed.length });
    }

    // GET /search/index/:id - get document by id
    if (method === "GET" && segments.length === 3 && segments[0] === "search" && segments[1] === "index") {
      const id = segments[2];
      const doc = getDocument(id);
      if (!doc) return errorResponse("Document not found", 404);
      return jsonResponse(doc);
    }

    // PUT /search/index/:id - update indexed document
    if (method === "PUT" && segments.length === 3 && segments[0] === "search" && segments[1] === "index") {
      const id = segments[2];
      const body = await parseBody<Partial<SearchDocument>>(req);
      if (!body) return errorResponse("Invalid request body", 400);

      const updated = updateDocument(id, body);
      if (!updated) return errorResponse("Document not found", 404);
      return jsonResponse(updated);
    }

    // DELETE /search/index/:id - remove from index
    if (method === "DELETE" && segments.length === 3 && segments[0] === "search" && segments[1] === "index") {
      const id = segments[2];
      const deleted = deleteFromIndex(id);
      if (!deleted) return errorResponse("Document not found", 404);
      return jsonResponse({ deleted: true });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    return errorResponse("Internal server error", 500);
  }
}
