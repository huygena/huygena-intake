import { http, parseJson, type Ctx } from "../http.js";
import { IntakeError } from "../errors.js";
import { normalizeLicense } from "../license.js";
import { stripTags } from "../text.js";

export interface CrossrefWork {
  doi: string;
  title: string;
  authors: string[];
  year: number | null;
  published: string | null;
  venue: string | null;
  publisher: string | null;
  type: string | null;
  abstract: string | null;
  landing: string | null;
  pdf: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Related identifiers from `relation` (supplements, datasets, software), as URLs, one per line with the relation type. */
  relationText: string;
  /** Full-text links from `link`. */
  linkUrls: string[];
}

type DateParts = { "date-parts"?: (number | null)[][] };

interface CrossrefMessage {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  published?: DateParts;
  "published-online"?: DateParts;
  "published-print"?: DateParts;
  issued?: DateParts;
  posted?: DateParts;
  "container-title"?: string[];
  institution?: { name?: string }[];
  publisher?: string;
  type?: string;
  subtype?: string;
  abstract?: string;
  URL?: string;
  resource?: { primary?: { URL?: string } };
  link?: { URL: string; "content-type"?: string; "intended-application"?: string }[];
  license?: { URL: string; "content-version"?: string }[];
  relation?: Record<string, { id: string; "id-type"?: string }[]>;
}

// Relations that point at other versions, reviews or comments, not at materials.
const SKIP_RELATIONS = new Set([
  "has-review", "is-review-of", "has-comment", "is-comment-on", "has-reply", "is-reply-to", "has-preprint",
  "is-preprint-of", "has-version", "is-version-of", "is-same-as", "is-identical-to", "has-translation",
  "is-translation-of", "references", "is-referenced-by", "has-manifestation", "is-manifestation-of", "replaces",
  "is-replaced-by", "has-related-material-for-review",
]);

function formatDate(d?: DateParts): string | null {
  const p = d?.["date-parts"]?.[0];
  if (!p || p[0] == null) return null;
  return p
    .filter((x): x is number => typeof x === "number")
    .map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, "0")))
    .join("-");
}

export function parseCrossref(json: unknown): CrossrefWork | null {
  const m = (json as { message?: CrossrefMessage })?.message;
  if (!m || !m.DOI) return null;
  const published = formatDate(m.published) ?? formatDate(m["published-online"]) ?? formatDate(m["published-print"]) ?? formatDate(m.posted) ?? formatDate(m.issued);
  const vor = m.license?.find((l) => l["content-version"] === "vor" && normalizeLicense(l.URL)) ?? m.license?.find((l) => normalizeLicense(l.URL));
  const relationText = Object.entries(m.relation ?? {})
    .filter(([k]) => !SKIP_RELATIONS.has(k))
    .flatMap(([k, ids]) =>
      ids.map((x) => `${k}: ${x["id-type"] === "doi" || /^10\./.test(x.id) ? `https://doi.org/${x.id.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : x.id}`),
    )
    .join("\n");
  const abstract = m.abstract ? stripTags(m.abstract.replace(/<jats:title>[\s\S]*?<\/jats:title>/g, " ")) : null;
  return {
    doi: m.DOI.toLowerCase(),
    title: stripTags(m.title?.[0] ?? "") || "Untitled",
    authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
    year: published ? Number(published.slice(0, 4)) : null,
    published,
    venue: stripTags(m["container-title"]?.[0] ?? "") || m.institution?.[0]?.name || null,
    publisher: m.publisher ?? null,
    type: m.subtype === "preprint" || m.type === "posted-content" ? "preprint" : (m.type ?? null),
    abstract: abstract || null,
    landing: m.resource?.primary?.URL ?? m.URL ?? null,
    pdf: m.link?.find((l) => l["content-type"] === "application/pdf")?.URL ?? null,
    license: vor ? normalizeLicense(vor.URL) : null,
    licenseUrl: vor?.URL ?? null,
    relationText,
    linkUrls: (m.link ?? []).map((l) => l.URL),
  };
}

/** Fetch a work from Crossref. Returns `null` when Crossref does not know the DOI. */
export async function fetchCrossref(ctx: Ctx, doi: string): Promise<CrossrefWork | null> {
  const q = ctx.mailto ? `?mailto=${encodeURIComponent(ctx.mailto)}` : "";
  const r = await http(ctx, "crossref", `https://api.crossref.org/works/${encodeURIComponent(doi)}${q}`);
  if (r.ok) return parseCrossref(parseJson(r.text));
  if (r.status === 404) return null;
  throw new IntakeError(r.timedOut ? "timeout" : "upstream", `Crossref: ${r.error}`);
}
