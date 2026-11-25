import type { SourceCall, SourceName } from "./schema.js";
import { DEFAULT_USER_AGENT } from "./version.js";
import { readEnv } from "./text.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Custom fetch, for tests or proxies. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Abort everything. */
  signal?: AbortSignal;
  /** User-Agent header. Default `huygena-intake/<version> (+https://github.com/huygena/huygena-intake)`. */
  userAgent?: string;
  /** Contact email for Crossref's polite pool and NCBI. Default: `HUYGENA_MAILTO` env var. Never sent anywhere else. */
  mailto?: string;
}

export interface Ctx {
  fetch: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent: string;
  mailto?: string;
  sources: SourceCall[];
  warnings: string[];
}

export function makeCtx(opts: HttpOptions = {}): Ctx {
  const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!f) throw new Error("No fetch available. Pass opts.fetch or run on Node 20+.");
  return {
    fetch: f,
    timeoutMs: opts.timeoutMs ?? 30_000,
    signal: opts.signal,
    userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
    mailto: opts.mailto ?? readEnv("HUYGENA_MAILTO"),
    sources: [],
    warnings: [],
  };
}

export type HttpResult =
  | { ok: true; status: number; text: string; headers: Headers }
  | { ok: false; status: number | null; text: string; headers: Headers | null; error: string; timedOut: boolean };

/** Remove contact details and tokens from a URL before it is recorded in the brief. */
function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["mailto", "email", "api_key", "token"]) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function http(
  ctx: Ctx,
  name: SourceName,
  url: string,
  init: { accept?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const t0 = now();
  const timeoutMs = init.timeoutMs ?? ctx.timeoutMs;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (ctx.signal) signals.push(ctx.signal);
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  const signal = signals.length > 1 && anyFn ? anyFn(signals) : signals[0]!;
  const record = (ok: boolean, status: number | null, error: string | null) =>
    ctx.sources.push({ name, url: redact(url), ok, status, ms: Math.round(now() - t0), error });

  try {
    const res = await ctx.fetch(url, {
      headers: { "User-Agent": ctx.userAgent, Accept: init.accept ?? "application/json", ...init.headers },
      signal,
      redirect: "follow",
    });
    const text = await res.text();
    if (res.ok) {
      record(true, res.status, null);
      return { ok: true, status: res.status, text, headers: res.headers };
    }
    const error = `HTTP ${res.status}`;
    record(false, res.status, error);
    return { ok: false, status: res.status, text, headers: res.headers, error, timedOut: false };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === "TimeoutError" || (err?.name === "AbortError" && !ctx.signal?.aborted);
    const error = timedOut
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : ctx.signal?.aborted
        ? "aborted"
        : `network error: ${err?.message ?? String(e)}`;
    record(false, null, error);
    return { ok: false, status: null, text: "", headers: null, error, timedOut };
  }
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
