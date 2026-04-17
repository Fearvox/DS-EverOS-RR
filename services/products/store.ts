import { MemoryStore } from "../shared/store";
import type { Product } from "../shared/types";

export class ProductStore extends MemoryStore<Product> {
  findByCategory(category: string): Product[] {
    return this.find((p) => p.category === category);
  }

  searchByName(query: string): Product[] {
    const lower = query.toLowerCase();
    return this.find(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  getByPriceRange(min: number, max: number): Product[] {
    return this.find((p) => p.price >= min && p.price <= max);
  }

  getByTags(tags: string[]): Product[] {
    return this.find((p) => tags.some((t) => p.tags.includes(t)));
  }

  adjustStock(id: string, delta: number): Product | undefined {
    const product = this.getById(id);
    if (!product) return undefined;
    const newStock = product.stock + delta;
    if (newStock < 0) return undefined;
    return this.update(id, { stock: newStock } as Partial<Product>);
  }

  getLowStock(threshold: number): Product[] {
    return this.find((p) => p.stock < threshold && p.status === "active");
  }

  getCategories(): Array<{ category: string; count: number }> {
    const counts = new Map<string, number>();
    for (const product of this.getAll()) {
      counts.set(product.category, (counts.get(product.category) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
  }
}

export const productStore = new ProductStore();
