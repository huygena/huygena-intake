import { IntakeError } from "./errors.js";
import { makeCtx, type HttpOptions } from "./http.js";
import type { SearchHit, SearchResult, SearchSort } from "./schema.js";
import { fetchEpmcSearch } from "./sources/europepmc.js";
import { stripTags } from "./text.js";

export interface SearchOptions extends HttpOptions {
  /** Number of results, 1 to 100. Default 10. */
  limit?: number;
  /** `relevance` (default), `cited` (most cited first) or `date` (newest first). */
  sort?: SearchSort;
}

const SORT: Record<SearchSort, string | undefined> = {
  relevance: undefined,
  cited: "CITED desc",
  date: "P_PDATE_D desc",
};

/**
 * Literature search through the Europe PMC REST API (PubMed, PMC, bioRxiv, medRxiv, arXiv and more).
 * The query uses Europe PMC syntax, so field searches such as `TITLE:"protein folding" AND OPEN_ACCESS:y` work.
 * Default timeout is 60 s because Europe PMC can take 15 to 30 s on broad queries.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = (query ?? "").trim();
  if (q.length < 2) throw new IntakeError("invalid_query", "Query must be at least 2 characters");
  if (q.length > 1000) throw new IntakeError("invalid_query", "Query must be at most 1000 characters");
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 10)));
  const sort = opts.sort ?? "relevance";
  const ctx = makeCtx({ ...opts, timeoutMs: opts.timeoutMs ?? 60_000 });
  const { total, results } = await fetchEpmcSearch(ctx, q, { limit, sort: SORT[sort] });
  const hits: SearchHit[] = results.slice(0, limit).map((r, i) => ({
    rank: i + 1,
    id: r.id ?? "",
    source: r.source ?? "",
    title: stripTags(r.title ?? "").replace(/\.$/, "") || "Untitled",
    authors: (r.authorString ?? "").replace(/\.$/, ""),
    year: r.pubYear ? Number(r.pubYear) : null,
    journal: r.journalTitle ?? r.bookOrReportDetails?.publisher ?? null,
    doi: r.doi?.toLowerCase() ?? null,
    pmid: r.pmid ?? null,
    pmcid: r.pmcid ?? null,
    openAccess: r.isOpenAccess === "Y",
    citedBy: typeof r.citedByCount === "number" ? r.citedByCount : 0,
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
  }));
  return { query: q, sort, total, hits, source: ctx.sources[ctx.sources.length - 1]! };
}
