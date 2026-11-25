import { http, parseJson, type Ctx } from "../http.js";

const TOOL = "huygena-intake";

function contact(ctx: Ctx): string {
  return `tool=${TOOL}${ctx.mailto ? `&email=${encodeURIComponent(ctx.mailto)}` : ""}`;
}

export interface IdConv {
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
}

/** Map a DOI, PMID or PMCID to the other two with the PMC ID Converter. `null` when the paper is not in PMC or on any error. */
export async function fetchIdConv(ctx: Ctx, id: string): Promise<IdConv | null> {
  const url = `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=${encodeURIComponent(id)}&format=json&${contact(ctx)}`;
  const r = await http(ctx, "ncbi", url, { timeoutMs: Math.min(ctx.timeoutMs, 15_000) });
  if (!r.ok) return null;
  return parseIdConv(parseJson(r.text));
}

export function parseIdConv(json: unknown): IdConv | null {
  const rec = (json as { records?: { doi?: string; pmid?: number | string; pmcid?: string; status?: string }[] })?.records?.[0];
  if (!rec || rec.status === "error" || (!rec.pmid && !rec.pmcid)) return null;
  return { doi: rec.doi?.toLowerCase() ?? null, pmid: rec.pmid != null ? String(rec.pmid) : null, pmcid: rec.pmcid ?? null };
}

/**
 * Full text JATS XML from PMC through NCBI E-utilities. Returns `null` when the record has no body
 * (PMC only serves full XML for articles in its open-access subset).
 */
export async function fetchPmcFullText(ctx: Ctx, pmcid: string): Promise<string | null> {
  const num = pmcid.replace(/^PMC/i, "");
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${num}&${contact(ctx)}`;
  const r = await http(ctx, "ncbi", url, { accept: "application/xml" });
  if (!r.ok || !/<article\b/.test(r.text) || !/<body\b/.test(r.text)) return null;
  return r.text;
}
