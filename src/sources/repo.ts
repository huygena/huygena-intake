import { http, parseJson, type Ctx } from "../http.js";
import type { CodeHost, RepoCheck, SourceName } from "../schema.js";

/**
 * Code repository checks, the same for every host.
 *
 * 1. Reachability: git hosts (GitHub, GitLab, Codeberg, Bitbucket, self-hosted GitLab) are asked over the plain git
 *    smart-HTTP protocol (`<repo>.git/info/refs`), the request `git clone` makes. No API, no account, no token.
 *    Archives and other hosts (Zenodo, Software Heritage, Code Ocean, ...) get a plain GET of the link.
 * 2. Details (license, stars, last push, archived): best effort, from the host's public API when it has one.
 *    A host API that is down or rate-limited never changes the reachability result.
 */
export interface RepoCtx extends Ctx {
  /** Optional GitHub token, only sent to api.github.com, only used for details. */
  githubToken?: string;
  /** Hosts whose API refused us (rate limit); later detail calls to them are skipped. */
  apiLimited?: Set<CodeHost>;
}

/** Hosts whose API runs license detection (others report no license field). */
const LICENSE_API: ReadonlySet<CodeHost> = new Set(["github", "gitlab"]);

export const GIT_HOSTS: ReadonlySet<CodeHost> = new Set(["github", "gitlab", "codeberg", "bitbucket"]);

const HOST_NAME: Partial<Record<CodeHost, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  codeberg: "Codeberg",
  bitbucket: "Bitbucket",
  zenodo: "Zenodo",
  figshare: "Figshare",
  software_heritage: "Software Heritage",
  code_ocean: "Code Ocean",
  huggingface: "Hugging Face",
  osf: "OSF",
};

export function hostName(h: CodeHost): string {
  return HOST_NAME[h] ?? "the code host";
}

export function unchecked(reason: string): RepoCheck {
  return {
    status: "unchecked",
    reason,
    via: null,
    fullName: null,
    defaultBranch: null,
    head: null,
    license: null,
    stars: null,
    pushedAt: null,
    archived: null,
    fork: null,
    description: null,
    details: false,
    licenseChecked: false,
  };
}

/** Base URL of a git repository, without `.git`, tree paths or a trailing slash. */
export function repoBase(c: { host: CodeHost; id: string | null; url: string }): string {
  if (c.host === "github" && c.id) return `https://github.com/${c.id}`;
  if ((c.host === "codeberg" || c.host === "bitbucket") && c.id) return `https://${c.host === "codeberg" ? "codeberg.org" : "bitbucket.org"}/${c.id}`;
  return c.url.replace(/\/+$/, "").replace(/\.git$/i, "");
}

/** Parse the first pkt-line of a git-upload-pack advertisement: HEAD commit and default branch. */
export function parseRefs(text: string): { head: string | null; defaultBranch: string | null } | null {
  if (!text.includes("# service=git-upload-pack")) return null;
  // The sha sits right after the 4-digit pkt-line length, so read it backwards from " HEAD\0".
  const at = text.indexOf(" HEAD\0");
  const len = /object-format=sha256/.test(text) ? 64 : 40;
  const sha = at >= len ? text.slice(at - len, at) : "";
  const head = /^[0-9a-f]+$/.test(sha) ? sha : null;
  const branch = text.match(/symref=HEAD:refs\/heads\/([^\s\0]+)/)?.[1] ?? null;
  return { head, defaultBranch: branch };
}

async function reach(ctx: RepoCtx, c: { host: CodeHost; id: string | null; url: string }): Promise<RepoCheck> {
  const name = hostName(c.host);
  const timeoutMs = Math.min(ctx.timeoutMs, 15_000);
  if (GIT_HOSTS.has(c.host)) {
    const base = repoBase(c);
    const r = await http(ctx, "git", `${base}.git/info/refs?service=git-upload-pack`, { accept: "*/*", timeoutMs });
    const refs = r.ok ? parseRefs(r.text) : null;
    if (refs) {
      return { ...unchecked(""), status: "ok", reason: null, via: "git", fullName: c.id, defaultBranch: refs.defaultBranch, head: refs.head };
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      return { ...unchecked(`${name} asks for a login or returns ${r.status}: the repository is private, deleted or the link is mistyped`), status: "not_found", via: "git" };
    }
    if (r.ok) return unchecked(`${name} answered, but not as a git repository`);
    return unchecked(`${name} did not answer: ${r.error}`);
  }
  const r = await http(ctx, "web", c.url, { accept: "text/html,application/json;q=0.9,*/*;q=0.8", timeoutMs });
  if (r.ok) return { ...unchecked(""), status: "ok", reason: null, via: "http", fullName: c.id };
  if (r.status === 404 || r.status === 410) return { ...unchecked(`${name} returned ${r.status} for this link`), status: "not_found", via: "http" };
  return unchecked(`${name} did not answer: ${r.error}`);
}

interface Details {
  fullName?: string | null;
  defaultBranch?: string | null;
  license?: string | null;
  stars?: number | null;
  pushedAt?: string | null;
  archived?: boolean | null;
  fork?: boolean | null;
  description?: string | null;
}

const SPDX = ["MIT", "Apache-2.0", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0", "ISC", "Unlicense", "CC0-1.0", "EPL-2.0", "BSL-1.0", "CC-BY-4.0"];

/** Map a host's license key (`apache-2.0`, `mit`) to its SPDX spelling when known. */
export function spdx(key: string | null | undefined): string | null {
  if (!key) return null;
  const k = key.trim().toLowerCase();
  return SPDX.find((s) => s.toLowerCase() === k || s.toLowerCase() === k.replace(/-only$|-or-later$/, "")) ?? (k === "other" ? "NOASSERTION" : key);
}

export function parseGithubRepo(json: unknown): Details {
  const j = (json ?? {}) as {
    full_name?: string;
    default_branch?: string;
    license?: { spdx_id?: string | null } | null;
    stargazers_count?: number;
    pushed_at?: string;
    archived?: boolean;
    fork?: boolean;
    description?: string | null;
  };
  return {
    fullName: j.full_name ?? null,
    defaultBranch: j.default_branch ?? null,
    license: j.license?.spdx_id ?? null,
    stars: typeof j.stargazers_count === "number" ? j.stargazers_count : null,
    pushedAt: j.pushed_at ?? null,
    archived: typeof j.archived === "boolean" ? j.archived : null,
    fork: typeof j.fork === "boolean" ? j.fork : null,
    description: j.description ?? null,
  };
}

function parseGitlab(json: unknown): Details {
  const j = (json ?? {}) as {
    path_with_namespace?: string;
    default_branch?: string;
    license?: { key?: string } | null;
    star_count?: number;
    last_activity_at?: string;
    archived?: boolean;
    forked_from_project?: unknown;
    description?: string | null;
  };
  return {
    fullName: j.path_with_namespace ?? null,
    defaultBranch: j.default_branch ?? null,
    license: spdx(j.license?.key),
    stars: typeof j.star_count === "number" ? j.star_count : null,
    pushedAt: j.last_activity_at ?? null,
    archived: typeof j.archived === "boolean" ? j.archived : null,
    fork: j.forked_from_project ? true : false,
    description: j.description ?? null,
  };
}

function parseGitea(json: unknown): Details {
  const j = (json ?? {}) as { full_name?: string; default_branch?: string; stars_count?: number; updated_at?: string; archived?: boolean; fork?: boolean; description?: string };
  return {
    fullName: j.full_name ?? null,
    defaultBranch: j.default_branch ?? null,
    stars: typeof j.stars_count === "number" ? j.stars_count : null,
    pushedAt: j.updated_at ?? null,
    archived: typeof j.archived === "boolean" ? j.archived : null,
    fork: typeof j.fork === "boolean" ? j.fork : null,
    description: j.description || null,
  };
}

function parseBitbucket(json: unknown): Details {
  const j = (json ?? {}) as { full_name?: string; mainbranch?: { name?: string }; updated_on?: string; parent?: unknown; description?: string };
  return {
    fullName: j.full_name ?? null,
    defaultBranch: j.mainbranch?.name ?? null,
    pushedAt: j.updated_on ?? null,
    fork: j.parent ? true : false,
    description: j.description || null,
  };
}

function detailsCall(ctx: RepoCtx, c: { host: CodeHost; id: string | null; url: string }): { name: SourceName; url: string; headers?: Record<string, string>; parse: (j: unknown) => Details } | null {
  if (!c.id) return null;
  if (c.host === "github") {
    const headers: Record<string, string> = { "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json" };
    if (ctx.githubToken) headers.Authorization = `Bearer ${ctx.githubToken}`;
    return { name: "github", url: `https://api.github.com/repos/${c.id}`, headers, parse: parseGithubRepo };
  }
  if (c.host === "gitlab") {
    const origin = new URL(repoBase(c)).origin;
    return { name: "gitlab", url: `${origin}/api/v4/projects/${encodeURIComponent(c.id)}?license=true`, parse: parseGitlab };
  }
  if (c.host === "codeberg") return { name: "codeberg", url: `https://codeberg.org/api/v1/repos/${c.id}`, parse: parseGitea };
  if (c.host === "bitbucket") return { name: "bitbucket", url: `https://api.bitbucket.org/2.0/repositories/${c.id}`, parse: parseBitbucket };
  return null;
}

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

/** Raw file URL on a git host. */
export function rawUrl(c: { host: CodeHost; id: string | null; url: string }, branch: string, path: string): string | null {
  const base = repoBase(c);
  if (c.host === "github" && c.id) return `https://raw.githubusercontent.com/${c.id}/${branch}/${path}`;
  if (c.host === "gitlab") return `${base}/-/raw/${branch}/${path}`;
  if (c.host === "codeberg") return `${base}/raw/branch/${branch}/${path}`;
  if (c.host === "bitbucket") return `${base}/raw/${branch}/${path}`;
  return null;
}

/** Identify a license from the text of a license file. `NOASSERTION` when a file exists but is not recognized. */
export function detectLicense(text: string): string {
  const t = text.replace(/\s+/g, " ");
  if (/GNU AFFERO GENERAL PUBLIC LICENSE Version 3/i.test(t)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE Version 3/i.test(t)) return "LGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE Version 2\.1/i.test(t)) return "LGPL-2.1";
  if (/GNU GENERAL PUBLIC LICENSE Version 3/i.test(t)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE Version 2/i.test(t)) return "GPL-2.0";
  if (/Apache License,? Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Mozilla Public License,? (?:Version|v\.?) ?2\.0/i.test(t)) return "MPL-2.0";
  if (/Eclipse Public License - v 2\.0/i.test(t)) return "EPL-2.0";
  if (/Boost Software License - Version 1\.0/i.test(t)) return "BSL-1.0";
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  if (/CC0 1\.0 Universal/i.test(t)) return "CC0-1.0";
  if (/Creative Commons Attribution 4\.0 International/i.test(t) && !/NonCommercial|NoDerivatives|ShareAlike/i.test(t)) return "CC-BY-4.0";
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(t)) return "MIT";
  if (/Permission to use, copy, modify, and(?:\/or)? distribute this software for any purpose/i.test(t)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  return "NOASSERTION";
}

/** Look for a license file in the repository itself. `undefined` when the host did not answer. */
async function licenseFromFile(ctx: RepoCtx, c: { host: CodeHost; id: string | null; url: string }, branch: string): Promise<string | null | undefined> {
  for (const name of LICENSE_FILES) {
    const url = rawUrl(c, branch, name);
    if (!url) return undefined;
    const r = await http(ctx, "web", url, { accept: "text/plain,*/*", timeoutMs: Math.min(ctx.timeoutMs, 10_000) });
    if (r.ok) return detectLicense(r.text.slice(0, 20_000));
    if (r.status !== 404) return undefined;
  }
  return null;
}

/** Check one code link. Never throws: failures come back as `unchecked`. */
export async function checkRepo(ctx: RepoCtx, c: { host: CodeHost; id: string | null; url: string }): Promise<RepoCheck> {
  const base = await reach(ctx, c);
  if (base.status !== "ok") return base;
  let out: RepoCheck = base;
  const call = detailsCall(ctx, c);
  if (call && !ctx.apiLimited?.has(c.host)) {
    const r = await http(ctx, call.name, call.url, { headers: call.headers, timeoutMs: Math.min(ctx.timeoutMs, 15_000) });
    if (r.ok) {
      const d = call.parse(parseJson(r.text));
      const moved = d.fullName && c.id && d.fullName.toLowerCase() !== c.id.toLowerCase();
      out = {
        ...base,
        reason: moved ? `Repository moved: ${c.id} now redirects to ${d.fullName}` : null,
        fullName: d.fullName ?? base.fullName,
        defaultBranch: base.defaultBranch ?? d.defaultBranch ?? null,
        license: d.license ?? null,
        stars: d.stars ?? null,
        pushedAt: d.pushedAt ?? null,
        archived: d.archived ?? null,
        fork: d.fork ?? null,
        description: d.description ?? null,
        details: true,
        licenseChecked: LICENSE_API.has(c.host),
      };
    } else {
      const remaining = r.headers?.get("x-ratelimit-remaining") ?? r.headers?.get("ratelimit-remaining");
      if (r.status === 429 || (r.status === 403 && (remaining === "0" || /rate limit/i.test(r.text)))) (ctx.apiLimited ??= new Set()).add(c.host);
    }
  }
  // No license from an API: read the license file from the repository (works the same on every git host).
  if (GIT_HOSTS.has(c.host) && !out.license && !out.licenseChecked) {
    const lic = await licenseFromFile(ctx, c, out.defaultBranch ?? "HEAD");
    if (lic !== undefined) out = { ...out, license: lic, licenseChecked: true };
  }
  return out;
}
