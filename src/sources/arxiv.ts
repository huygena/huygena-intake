import { http, type Ctx } from "../http.js";
import { IntakeError } from "../errors.js";
import { stripTags } from "../text.js";

export interface ArxivEntry {
  id: string;
  version: number | null;
  title: string;
  authors: string[];
  published: string | null;
  updated: string | null;
  abstract: string | null;
  comment: string | null;
  primaryCategory: string | null;
  /** Journal DOI the authors added on arXiv, if any. */
  doi: string | null;
  journalRef: string | null;
  pdf: string;
  landing: string;
}

/** Parse the first entry of an arXiv Atom feed. Returns `null` for an empty feed or an error entry. */
export function parseArxivAtom(xml: string): ArxivEntry | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return null;
  const tag = (t: string) => entry.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? null;
  const title = tag("title");
  const idUrl = tag("id") ?? "";
  if (!title || /^\s*Error\s*$/i.test(title) || /api\/errors/.test(idUrl)) return null;
  const idm = idUrl.match(/arxiv\.org\/abs\/(.+?)(?:v(\d+))?\s*$/);
  if (!idm?.[1]) return null;
  const id = idm[1];
  const version = idm[2] ? Number(idm[2]) : null;
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((x) => stripTags(x[1] ?? ""));
  const published = tag("published")?.trim().slice(0, 10) ?? null;
  const v = version ? `v${version}` : "";
  return {
    id,
    version,
    title: stripTags(title),
    authors,
    published,
    updated: tag("updated")?.trim().slice(0, 10) ?? null,
    abstract: tag("summary") ? stripTags(tag("summary")!) : null,
    comment: tag("arxiv:comment") ? stripTags(tag("arxiv:comment")!) : null,
    primaryCategory: entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? null,
    doi: tag("arxiv:doi")?.trim().toLowerCase() ?? null,
    journalRef: tag("arxiv:journal_ref") ? stripTags(tag("arxiv:journal_ref")!) : null,
    pdf: `https://arxiv.org/pdf/${id}${v}`,
    landing: `https://arxiv.org/abs/${id}${v}`,
  };
}

export async function fetchArxiv(ctx: Ctx, id: string, version?: number): Promise<ArxivEntry | null> {
  const q = encodeURIComponent(version ? `${id}v${version}` : id);
  const r = await http(ctx, "arxiv", `https://export.arxiv.org/api/query?id_list=${q}`, { accept: "application/atom+xml" });
  if (r.ok) return parseArxivAtom(r.text);
  if (r.status === 400 || r.status === 404) return null;
  throw new IntakeError(r.timedOut ? "timeout" : "upstream", `arXiv: ${r.error}`);
}
