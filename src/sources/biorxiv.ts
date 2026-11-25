import { http, parseJson, type Ctx } from "../http.js";
import { IntakeError } from "../errors.js";
import { normalizeLicense } from "../license.js";
import { stripTags } from "../text.js";

export interface BiorxivRecord {
  server: "biorxiv" | "medrxiv";
  doi: string;
  version: number;
  title: string;
  authors: string[];
  date: string | null;
  category: string | null;
  abstract: string | null;
  license: string | null;
  /** DOI of the journal version, when bioRxiv/medRxiv knows it. */
  publishedDoi: string | null;
  landing: string;
  pdf: string;
}

interface BiorxivItem {
  title?: string;
  authors?: string;
  doi?: string;
  date?: string;
  version?: string;
  category?: string;
  abstract?: string;
  license?: string;
  published?: string;
  server?: string;
}

/** "Mirdita, M." → "M. Mirdita" */
function flipName(a: string): string {
  const m = a.trim().match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}`.trim() : a.trim();
}

/** Parse a `details` response. Picks the requested version, or the latest. */
export function parseBiorxiv(json: unknown, server: "biorxiv" | "medrxiv", version?: number): BiorxivRecord | null {
  const items = ((json as { collection?: BiorxivItem[] })?.collection ?? []).filter((x) => x?.doi && x.title);
  if (!items.length) return null;
  const pick = (version ? items.find((x) => Number(x.version) === version) : undefined) ?? items[items.length - 1]!;
  const v = Number(pick.version ?? 1) || 1;
  const host = server === "medrxiv" ? "www.medrxiv.org" : "www.biorxiv.org";
  const landing = `https://${host}/content/${pick.doi}v${v}`;
  const pub = pick.published && pick.published !== "NA" ? pick.published.toLowerCase() : null;
  return {
    server,
    doi: pick.doi!.toLowerCase(),
    version: v,
    title: stripTags(pick.title ?? ""),
    authors: (pick.authors ?? "").split(";").map(flipName).filter(Boolean),
    date: pick.date ?? null,
    category: pick.category ?? null,
    abstract: pick.abstract ? stripTags(pick.abstract) : null,
    license: normalizeLicense(pick.license),
    publishedDoi: pub,
    landing,
    pdf: `${landing}.full.pdf`,
  };
}

export async function fetchBiorxiv(
  ctx: Ctx,
  doi: string,
  opts: { server?: "biorxiv" | "medrxiv"; version?: number } = {},
): Promise<BiorxivRecord | null> {
  const order: ("biorxiv" | "medrxiv")[] = opts.server === "medrxiv" ? ["medrxiv", "biorxiv"] : ["biorxiv", "medrxiv"];
  let lastError: string | null = null;
  let answered = false;
  for (const server of order) {
    const r = await http(ctx, "biorxiv", `https://api.biorxiv.org/details/${server}/${doi}/na/json`);
    if (!r.ok) {
      lastError = r.error;
      continue;
    }
    answered = true;
    const rec = parseBiorxiv(parseJson(r.text), server, opts.version);
    if (rec) return rec;
  }
  if (!answered && lastError) throw new IntakeError("upstream", `bioRxiv API: ${lastError}`);
  return null;
}
