import { MemoryStore } from "../shared/store";
import { generateId, now } from "../shared/http";
import type { SearchDocument } from "../shared/types";

const store = new MemoryStore<SearchDocument>();

// Inverted index: word -> Set of document IDs
let wordIndex = new Map<string, Set<string>>();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function addToWordIndex(id: string, text: string): void {
  const words = tokenize(text);
  for (const word of words) {
    if (!wordIndex.has(word)) {
      wordIndex.set(word, new Set());
    }
    wordIndex.get(word)!.add(id);
  }
}

function removeFromWordIndex(id: string, text: string): void {
  const words = tokenize(text);
  for (const word of words) {
    const ids = wordIndex.get(word);
    if (ids) {
      ids.delete(id);
      if (ids.size === 0) wordIndex.delete(word);
    }
  }
}

export function indexDocument(doc: Omit<SearchDocument, "id" | "indexedAt"> & { id?: string }): SearchDocument {
  const fullDoc: SearchDocument = {
    id: doc.id || generateId(),
    collection: doc.collection,
    content: doc.content,
    text: doc.text,
    tags: doc.tags || [],
    indexedAt: now(),
  };
  store.create(fullDoc);
  addToWordIndex(fullDoc.id, fullDoc.text);
  return fullDoc;
}

export function search(
  query: string,
  options?: { collection?: string; tags?: string[]; limit?: number; offset?: number }
): SearchDocument[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  // Find candidate doc IDs from inverted index
  const candidateIds = new Set<string>();
  for (const term of queryTerms) {
    for (const [word, ids] of wordIndex.entries()) {
      if (word.includes(term)) {
        for (const id of ids) candidateIds.add(id);
      }
    }
  }

  let results: SearchDocument[] = [];
  for (const id of candidateIds) {
    const doc = store.getById(id);
    if (!doc) continue;

    // Filter by collection
    if (options?.collection && doc.collection !== options.collection) continue;

    // Filter by tags (all specified tags must be present)
    if (options?.tags && options.tags.length > 0) {
      const hasAllTags = options.tags.every((t) => doc.tags.includes(t));
      if (!hasAllTags) continue;
    }

    // TF scoring: count occurrences of query terms in text, normalize by text length
    const docWords = tokenize(doc.text);
    const totalWords = docWords.length;
    if (totalWords === 0) continue;

    let matches = 0;
    for (const term of queryTerms) {
      for (const word of docWords) {
        if (word.includes(term)) matches++;
      }
    }

    const score = matches / totalWords;
    if (score > 0) {
      results.push({ ...doc, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Apply offset and limit
  const offset = options?.offset || 0;
  const limit = options?.limit || 20;
  return results.slice(offset, offset + limit);
}

export function autocomplete(prefix: string, collection?: string): string[] {
  const normalizedPrefix = prefix.toLowerCase().trim();
  if (!normalizedPrefix) return [];

  const suggestions = new Set<string>();
  const docs = collection ? store.find((d) => d.collection === collection) : store.getAll();

  for (const doc of docs) {
    const words = tokenize(doc.text);
    for (const word of words) {
      if (word.startsWith(normalizedPrefix)) {
        suggestions.add(word);
      }
    }
  }

  return Array.from(suggestions).sort().slice(0, 10);
}

export function findByCollection(collection: string): SearchDocument[] {
  return store.find((d) => d.collection === collection);
}

export function findByTags(tags: string[]): SearchDocument[] {
  return store.find((d) => tags.every((t) => d.tags.includes(t)));
}

export function getFacets(field: string): Record<string, number> {
  const facets: Record<string, number> = {};
  const docs = store.getAll();

  for (const doc of docs) {
    if (field === "collection") {
      facets[doc.collection] = (facets[doc.collection] || 0) + 1;
    } else if (field === "tags") {
      for (const tag of doc.tags) {
        facets[tag] = (facets[tag] || 0) + 1;
      }
    } else if (field in doc.content) {
      const value = String(doc.content[field]);
      facets[value] = (facets[value] || 0) + 1;
    }
  }

  return facets;
}

export function reindex(id: string): SearchDocument | undefined {
  const doc = store.getById(id);
  if (!doc) return undefined;

  // Remove old index entries and re-add
  removeFromWordIndex(id, doc.text);
  addToWordIndex(id, doc.text);

  const updated = store.update(id, { indexedAt: now() });
  return updated;
}

export function deleteFromIndex(id: string): boolean {
  const doc = store.getById(id);
  if (!doc) return false;
  removeFromWordIndex(id, doc.text);
  return store.delete(id);
}

export function getDocument(id: string): SearchDocument | undefined {
  return store.getById(id);
}

export function updateDocument(id: string, updates: Partial<SearchDocument>): SearchDocument | undefined {
  const existing = store.getById(id);
  if (!existing) return undefined;

  // Remove old word index entries
  removeFromWordIndex(id, existing.text);

  const updated = store.update(id, { ...updates, indexedAt: now() });
  if (updated) {
    addToWordIndex(id, updated.text);
  }
  return updated;
}

export function getCollections(): Record<string, number> {
  const collections: Record<string, number> = {};
  for (const doc of store.getAll()) {
    collections[doc.collection] = (collections[doc.collection] || 0) + 1;
  }
  return collections;
}

export function getStats(): { totalDocs: number; byCollection: Record<string, number>; avgDocLength: number } {
  const docs = store.getAll();
  const byCollection: Record<string, number> = {};
  let totalLength = 0;

  for (const doc of docs) {
    byCollection[doc.collection] = (byCollection[doc.collection] || 0) + 1;
    totalLength += tokenize(doc.text).length;
  }

  return {
    totalDocs: docs.length,
    byCollection,
    avgDocLength: docs.length > 0 ? totalLength / docs.length : 0,
  };
}

export function findSimilar(id: string): SearchDocument[] {
  const doc = store.getById(id);
  if (!doc) return [];

  const docWords = new Set(tokenize(doc.text));
  const candidates = store.find((d) => d.id !== id);

  const scored: SearchDocument[] = [];
  for (const candidate of candidates) {
    // Score based on shared tags + text word overlap
    let score = 0;

    // Shared tags contribute
    const sharedTags = candidate.tags.filter((t) => doc.tags.includes(t)).length;
    score += sharedTags * 0.3;

    // Text word overlap
    const candidateWords = new Set(tokenize(candidate.text));
    let overlap = 0;
    for (const word of candidateWords) {
      if (docWords.has(word)) overlap++;
    }
    const unionSize = new Set([...docWords, ...candidateWords]).size;
    if (unionSize > 0) {
      score += (overlap / unionSize) * 0.7;
    }

    if (score > 0) {
      scored.push({ ...candidate, score });
    }
  }

  return scored.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
}

export function getAllDocuments(): SearchDocument[] {
  return store.getAll();
}

export function resetStore(): void {
  store.clear();
  wordIndex = new Map();
}
