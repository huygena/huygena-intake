import { afterEach, describe, expect, it, vi } from "vitest";
import { search } from "../src/index.js";

describe("global fetch", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("is called with globalThis as this, as Cloudflare Workers require", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = vi.fn(function (this: unknown) {
      seen.push(this);
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ hitCount: 0, resultList: { result: [] } }), { status: 200 }));
    }) as unknown as typeof fetch;
    await search("protein structure", { limit: 1 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === globalThis)).toBe(true);
  });
});
