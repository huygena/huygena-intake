import { http, parseJson, type Ctx, type HttpResult } from "../http.js";
import { IntakeError } from "../errors.js";
import { normalizeLicense } from "../license.js";
import { stripTags } from "../text.js";

export const EPMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export interface EpmcRecord {
  source: string;
  id: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  journal: string | null;
  year: number | null;
  published: string | null;
  abstract: string | null;
  isOpenAccess: boolean;
  inPMC: boolean;
  license: string | null;
  /** IDs Europe PMC can serve full text for (PMCIDs, or PPR IDs for preprints). */
  fullTextIds: string[];
  pdfUrl: string | null;
  citedBy: number | null;
  url: string;
}

interface EpmcCore {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: { fullName?: string; firstName?: string; lastName?: string; collectiveName?: string }[] };
  journalInfo?: { journal?: { title?: string }; yearOfPublication?: number };
  bookOrReportDetails?: { publisher?: string };
  pubYear?: string;
  firstPublicationDate?: string;
  abstractText?: string;
  isOpenAccess?: string;
  inPMC?: string;
  license?: string;
  fullTextIdList?: { fullTextId?: string[] };
  fullTextUrlList?: { fullTextUrl?: { availabilityCode?: string; documentStyle?: string; url?: string }[] };
  citedByCount?: number;
  journalTitle?: string;
}

export function parseEpmcRecord(r: EpmcCore | undefined): EpmcRecord | null {
  if (!r?.id || !r.source) return null;
  const authors =
    r.authorList?.author?.map((a) => (a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : (a.fullName ?? a.collectiveName ?? ""))).filter(Boolean) ??
    (r.authorString ?? "").replace(/\.$/, "").split(/,\s*/).filter(Boolean);
  const oaPdf = r.fullTextUrlList?.fullTextUrl?.find((u) => u.availabilityCode === "OA" && u.documentStyle === "pdf")?.url ?? null;
  return {
    source: r.source,
    id: r.id,
    pmid: r.pmid ?? null,
    pmcid: r.pmcid ?? null,
    doi: r.doi?.toLowerCase() ?? null,
    title: stripTags(r.title ?? "").replace(/\.$/, "") || "Untitled",
    authors,
    journal: r.journalInfo?.journal?.title ?? r.journalTitle ?? r.bookOrReportDetails?.publisher ?? null,
    year: r.pubYear ? Number(r.pubYear) : (r.journalInfo?.yearOfPublication ?? null),
    published: r.firstPublicationDate ?? null,
    abstract: r.abstractText ? stripTags(r.abstractText) : null,
    isOpenAccess: r.isOpenAccess === "Y",
    inPMC: r.inPMC === "Y",
    license: normalizeLicense(r.license),
    fullTextIds: r.fullTextIdList?.fullTextId ?? [],
    pdfUrl: oaPdf,
    citedBy: typeof r.citedByCount === "number" ? r.citedByCount : null,
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
  };
}

function fail(r: Extract<HttpResult, { ok: false }>, what: string): never {
  throw new IntakeError(r.timedOut ? "timeout" : "upstream", `Europe PMC ${what}: ${r.error}`);
}

/** Look up one record with a Europe PMC query such as `EXT_ID:34265844 AND SRC:MED` or `DOI:"10.1038/…"`. */
export async function fetchEpmcRecord(ctx: Ctx, query: string, timeoutMs?: number): Promise<EpmcRecord | null> {
  const url = `${EPMC_REST}/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`;
  const r = await http(ctx, "europepmc", url, timeoutMs ? { timeoutMs } : {});
  if (!r.ok) fail(r, "lookup");
  const j = parseJson<{ resultList?: { result?: EpmcCore[] } }>(r.text);
  return parseEpmcRecord(j?.resultList?.result?.[0]);
}

/** Full text JATS XML for a PMCID or a preprint PPR ID. Returns `null` when Europe PMC has none. */
export async function fetchEpmcFullText(ctx: Ctx, id: string): Promise<string | null> {
  const r = await http(ctx, "europepmc", `${EPMC_REST}/${encodeURIComponent(id)}/fullTextXML`, { accept: "application/xml" });
  if (r.ok && /<article\b/.test(r.text)) return r.text;
  if (!r.ok && r.status !== 404) fail(r, "full text");
  return null;
}

export interface EpmcSearchHit extends EpmcCore {}

export async function fetchEpmcSearch(
  ctx: Ctx,
  query: string,
  opts: { limit: number; sort?: string },
): Promise<{ total: number; results: EpmcCore[] }> {
  const sort = opts.sort ? `&sort=${encodeURIComponent(opts.sort)}` : "";
  const url = `${EPMC_REST}/search?query=${encodeURIComponent(query)}&format=json&resultType=lite&pageSize=${opts.limit}${sort}`;
  const r = await http(ctx, "europepmc", url);
  if (!r.ok) fail(r, "search");
  const j = parseJson<{ hitCount?: number; resultList?: { result?: EpmcCore[] } }>(r.text);
  if (!j) throw new IntakeError("upstream", "Europe PMC search: response was not JSON");
  return { total: j.hitCount ?? 0, results: j.resultList?.result ?? [] };
}
