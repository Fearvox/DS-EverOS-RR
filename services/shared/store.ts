// Generic in-memory store with CRUD operations

export class MemoryStore<T extends { id: string }> {
  private data = new Map<string, T>();

  create(item: T): T {
    this.data.set(item.id, { ...item });
    return { ...item };
  }

  getById(id: string): T | undefined {
    const item = this.data.get(id);
    return item ? { ...item } : undefined;
  }

  getAll(): T[] {
    return Array.from(this.data.values()).map((item) => ({ ...item }));
  }

  update(id: string, updates: Partial<T>): T | undefined {
    const existing = this.data.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates, id };
    this.data.set(id, updated);
    return { ...updated };
  }

  delete(id: string): boolean {
    return this.data.delete(id);
  }

  find(predicate: (item: T) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  findOne(predicate: (item: T) => boolean): T | undefined {
    for (const item of this.data.values()) {
      if (predicate(item)) return { ...item };
    }
    return undefined;
  }

  count(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  has(id: string): boolean {
    return this.data.has(id);
  }
}
