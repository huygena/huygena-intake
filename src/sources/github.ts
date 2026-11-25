import { http, parseJson, type Ctx } from "../http.js";
import type { GithubCheck } from "../schema.js";

export interface GithubCtx extends Ctx {
  githubToken?: string;
  /** Set once GitHub says the rate limit is used up, so later checks are skipped. */
  githubLimited?: string;
}

interface RepoJson {
  full_name?: string;
  default_branch?: string;
  license?: { spdx_id?: string | null } | null;
  stargazers_count?: number;
  pushed_at?: string;
  archived?: boolean;
  fork?: boolean;
  description?: string | null;
}

export function unchecked(reason: string): GithubCheck {
  return {
    status: "unchecked",
    reason,
    fullName: null,
    defaultBranch: null,
    license: null,
    stars: null,
    pushedAt: null,
    archived: null,
    fork: null,
    description: null,
  };
}

export function parseGithubRepo(json: unknown, requested: string): GithubCheck {
  const j = (json ?? {}) as RepoJson;
  const fullName = j.full_name ?? null;
  const moved = fullName && fullName.toLowerCase() !== requested.toLowerCase();
  return {
    status: "ok",
    reason: moved ? `Repository moved: ${requested} now redirects to ${fullName}` : null,
    fullName,
    defaultBranch: j.default_branch ?? null,
    license: j.license?.spdx_id ?? null,
    stars: typeof j.stargazers_count === "number" ? j.stargazers_count : null,
    pushedAt: j.pushed_at ?? null,
    archived: typeof j.archived === "boolean" ? j.archived : null,
    fork: typeof j.fork === "boolean" ? j.fork : null,
    description: j.description ?? null,
  };
}

/** Check a GitHub repository through the REST API. Never throws: failures come back as `unchecked`. */
export async function checkGithubRepo(ctx: GithubCtx, ownerRepo: string): Promise<GithubCheck> {
  if (ctx.githubLimited) return unchecked(ctx.githubLimited);
  const headers: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28" };
  if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;
  const r = await http(ctx, "github", `https://api.github.com/repos/${ownerRepo}`, {
    accept: "application/vnd.github+json",
    headers,
    timeoutMs: Math.min(ctx.timeoutMs, 15_000),
  });
  if (r.ok) return parseGithubRepo(parseJson(r.text), ownerRepo);
  if (r.status === 404) {
    return { ...unchecked("GitHub returned 404: the repository was deleted, made private or the link is mistyped"), status: "not_found" };
  }
  if (r.status === 451) return { ...unchecked("GitHub blocks this repository (HTTP 451)"), status: "not_found" };
  const remaining = r.headers?.get("x-ratelimit-remaining");
  if ((r.status === 403 || r.status === 429) && (remaining === "0" || /rate limit/i.test(r.text))) {
    const reset = Number(r.headers?.get("x-ratelimit-reset"));
    const at = Number.isFinite(reset) && reset > 0 ? ` (resets ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC)` : "";
    ctx.githubLimited = `GitHub API rate limit reached${at}${ctx.githubToken ? "" : "; set GITHUB_TOKEN for 5,000 requests/hour"}`;
    return unchecked(ctx.githubLimited);
  }
  return unchecked(`GitHub API did not answer: ${r.error}`);
}
