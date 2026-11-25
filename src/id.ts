import type { ParsedId } from "./schema.js";

const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/;
// New-style arXiv IDs (0704.0001 onward) and old-style archive IDs (hep-th/9901001, math.GT/0309136).
const ARXIV_NEW = /^(\d{4}\.\d{4,5})(?:v(\d+))?$/;
const ARXIV_OLD = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v(\d+))?$/i;
const BIORXIV_SUFFIX = /^(?:\d{4}\.\d{2}\.\d{2}\.\d{5,9}|\d{5,7})$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function trimPunct(s: string): string {
  let out = s.replace(/[.,;:'"!?\]>]+$/, "");
  // Drop a trailing ")" only when it is unbalanced: "(see 10.1000/xyz)".
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) {
    out = out.slice(0, -1).replace(/[.,;:]+$/, "");
  }
  return out;
}

/** Strip publisher URL tails that are not part of the DOI: `/full`, `.full.pdf`, `/abstract`, `+html`. */
function stripDoiTail(doi: string): string {
  let d = doi;
  for (let i = 0; i < 4; i++) {
    const next = d
      .replace(/\+html$/i, "")
      .replace(/\/(?:full|abstract|pdf|epdf|pdfdirect|meta|summary|figures|references|suppl|html|fulltext|citedby)$/i, "")
      .replace(/\.(?:full|abstract|pdf|full-text|article-info|article-metrics|supplementary-material)$/i, "");
    if (next === d) break;
    d = next;
  }
  return d;
}

function doiResult(rawDoi: string, host: string): ParsedId | null {
  let doi = stripDoiTail(trimPunct(rawDoi)).toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return null;

  // arXiv DOIs: 10.48550/arXiv.1706.03762
  const ax = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
  if (ax?.[1]) {
    const inner = parseArxivBare(ax[1]);
    if (inner) return inner;
  }

  if (doi.startsWith("10.1101/")) {
    const m = doi.slice("10.1101/".length).match(/^(.+?)(?:v(\d+))?$/);
    const suffix = m?.[1] ?? "";
    if (BIORXIV_SUFFIX.test(suffix)) {
      doi = `10.1101/${suffix}`;
      const out: ParsedId = { kind: "biorxiv", value: doi, canonical: `doi:${doi}` };
      if (m?.[2]) out.version = Number(m[2]);
      if (/medrxiv\.org$/i.test(host)) out.server = "medrxiv";
      else if (/biorxiv\.org$/i.test(host)) out.server = "biorxiv";
      return out;
    }
  }
  return { kind: "doi", value: doi, canonical: `doi:${doi}` };
}

function parseArxivBare(s: string): ParsedId | null {
  const t = s.trim().replace(/\.pdf$/i, "");
  const m = t.match(ARXIV_NEW) ?? t.match(ARXIV_OLD);
  if (!m?.[1]) return null;
  const out: ParsedId = { kind: "arxiv", value: m[1], canonical: `arxiv:${m[1]}` };
  if (m[2]) out.version = Number(m[2]);
  return out;
}

/**
 * Normalize a paper identifier. Accepts DOIs (bare, `doi:` or any URL that contains one),
 * arXiv IDs and URLs, bioRxiv/medRxiv DOIs and URLs, PubMed IDs and URLs, PMCIDs and URLs.
 * Returns `null` when nothing recognizable is found.
 */
export function parseId(input: string): ParsedId | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^[<"'\[]+|[>"'\]]+$/g, "").trim();
  if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  if (!s) return null;

  // Bare arXiv IDs first: "math.GT/0309136" would otherwise look like a URL.
  const bareAx = s.replace(/^arxiv\s*:\s*/i, "");
  if (ARXIV_NEW.test(bareAx) || ARXIV_OLD.test(bareAx)) return parseArxivBare(bareAx);

  let host = "";
  let path = s;
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(s);
  if (isUrl) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
      host = u.hostname.toLowerCase().replace(/^www\./, "");
      const params = [...u.searchParams.values()].join(" ");
      path = `${safeDecode(u.pathname)} ${params}`.trim();
    } catch {
      path = s;
    }
  } else {
    path = safeDecode(s);
  }

  // arXiv URLs (abs, pdf, html, format, export mirror, alphaxiv-style mirrors).
  if (/(?:^|\.)arxiv\.org$/.test(host)) {
    const m = path.match(/^\/(?:abs|pdf|html|format|ps)\/(.+?)\/?(?:\s|$)/i);
    if (m?.[1]) return parseArxivBare(m[1]);
  }

  // PubMed and PMC URLs.
  if (host === "pubmed.ncbi.nlm.nih.gov" || (host.endsWith("ncbi.nlm.nih.gov") && /^\/pubmed\//i.test(path))) {
    const m = path.match(/(\d{1,9})/);
    if (m?.[1]) return pmid(m[1]);
  }
  if (host.endsWith("europepmc.org")) {
    const m = path.match(/\/(?:article|abstract|api\/fulltextRepo)\/(MED|PMC)\/(PMC)?(\d+)/i);
    if (m?.[1]?.toUpperCase() === "MED" && m[3]) return pmid(m[3]);
    if (m?.[1]?.toUpperCase() === "PMC" && m[3]) return pmcid(m[3]);
  }

  // Anything that contains a DOI.
  const doi = path.match(DOI_RE) ?? (isUrl ? null : s.match(DOI_RE));
  if (doi) return doiResult(doi[0], host);

  // Nature article URLs carry the DOI suffix: nature.com/articles/s41586-021-03819-2 → 10.1038/s41586-021-03819-2
  if (host === "nature.com") {
    const m = path.match(/^\/articles\/([a-z0-9.\-_]+?)(?:\.pdf)?\/?(?:\s|$)/i);
    if (m?.[1]) return doiResult(`10.1038/${m[1]}`, host);
  }

  const pmc = path.match(/\bPMC(\d{1,9})\b/i);
  if (pmc?.[1]) return pmcid(pmc[1]);

  if (isUrl) return null;

  const pm = s.match(/^(?:pmid|pubmed)\s*:?\s*(\d{1,9})$/i) ?? s.match(/^(\d{1,9})$/);
  if (pm?.[1]) return pmid(pm[1]);

  return null;
}

function pmid(d: string): ParsedId {
  const v = String(Number(d));
  return { kind: "pmid", value: v, canonical: `pmid:${v}` };
}

function pmcid(d: string): ParsedId {
  const v = `PMC${Number(d)}`;
  return { kind: "pmcid", value: v, canonical: `pmcid:${v}` };
}
