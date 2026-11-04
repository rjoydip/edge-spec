/**
 * Worker R2 binding adapter. The binding is close to the `ObjectStore` port but
 * paginates `list` differently, so normalize it here instead of leaking the
 * binding shape into the shared app.
 */
import type { ObjectStore } from "@edge-spec/runtime/env";

export interface R2ListedObject {
  key: string;
}

export interface R2ListPage {
  objects: R2ListedObject[];
  truncated?: boolean;
  cursor?: string;
}

export interface R2Binding {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2ListPage>;
}

export function r2Store(binding: R2Binding): ObjectStore {
  return {
    put: (key, value, options) => binding.put(key, value, options),
    get: (key) => binding.get(key),
    delete: (key) => binding.delete(key),
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await binding.list({ prefix, cursor, limit: 1000 });
        for (const object of page.objects) keys.push(object.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
  };
}
