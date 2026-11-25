import { readFileSync } from "node:fs";
import type { FetchLike } from "../src/index.js";

/** Read a recorded API response from tests/fixtures. */
export function fx(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export interface Route {
  match: RegExp;
  status?: number;
  file?: string;
  body?: string;
  headers?: Record<string, string>;
  /** Throw instead of answering (network error or timeout). */
  error?: Error;
}

export function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

/** A fetch that answers from fixtures. Unrouted URLs get a 404 and are listed in `unrouted`. */
export function fakeFetch(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const unrouted: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = routes.find((x) => x.match.test(url));
    if (!r) {
      unrouted.push(url);
      return new Response("not found", { status: 404 });
    }
    if (r.error) throw r.error;
    return new Response(r.file ? fx(r.file) : (r.body ?? ""), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetch, calls, unrouted };
}
