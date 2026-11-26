import type { Brief, CheckStatus, CodeLink, DataLink, ReadinessLevel, SearchResult } from "./schema.js";


export interface FormatOptions {
  /** ANSI colors. Default false. Status words (pass/warn/fail) are always printed, so output reads fine without color. */
  color?: boolean;
  /** Wrap width. Default 100. */
  width?: number;
  /** Show every link and the full statements. Default false. */
  all?: boolean;
}

let useColor = false;
let width = 100;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const green = sgr("32");
const yellow = sgr("33");
const red = sgr("31");

function setup(o: FormatOptions) {
  useColor = !!o.color;
  width = o.width ?? 100;
}

function wrap(text: string, indent: number, max = width): string {
  const pad = " ".repeat(indent);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > max - indent) {
        out.push(pad + line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(pad + line);
  }
  return out.join("\n");
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

function statusTag(s: CheckStatus): string {
  const t = s.padEnd(4);
  return s === "pass" ? green(t) : s === "warn" ? yellow(t) : s === "fail" ? red(t) : dim(t);
}

function levelTag(l: ReadinessLevel): string {
  const t = l.toUpperCase().replace("_", " ");
  return l === "ready" ? green(bold(t)) : l === "partial" ? yellow(bold(t)) : red(bold(t));
}

const ORIGIN_LABEL: Record<string, string> = {
  abstract: "abstract",
  arxiv_comment: "arXiv comment",
  crossref_relation: "Crossref relation",
  crossref_link: "Crossref link",
  code_statement: "code statement",
  data_statement: "data statement",
  full_text: "full text",
};

function codeLabel(c: CodeLink): string {
  if (c.host === "github" && c.id) return `github.com/${c.id}`;
  if (c.host === "gitlab" || c.host === "bitbucket" || c.host === "codeberg") return c.url.replace(/^https?:\/\//, "");
  return c.url.replace(/^https?:\/\//, "");
}

function fmtCode(c: CodeLink): string[] {
  const lines = [`  ${bold(codeLabel(c))}${c.ref ? dim(` @ ${c.ref}`) : ""}`];
  const g = c.repo;
  if (g?.status === "ok") {
    const bits = [
      g.license && g.license !== "NOASSERTION" ? g.license : g.license === "NOASSERTION" ? "license unrecognized" : g.details ? "no license detected" : null,
      g.stars != null ? `${g.stars.toLocaleString("en-US")} stars` : null,
      g.defaultBranch ? `branch ${g.defaultBranch}` : null,
      g.head ? `commit ${g.head.slice(0, 7)}` : null,
      g.pushedAt ? `last push ${g.pushedAt.slice(0, 10)}` : null,
      g.archived ? "archived" : null,
    ].filter(Boolean);
    lines.push(`      ${green(g.via === "http" ? "reachable" : "live")}${bits.length ? ` · ${bits.join(" · ")}` : ""}`);
    if (g.reason) lines.push(`      ${dim(g.reason)}`);
  } else if (g?.status === "not_found") {
    lines.push(`      ${red("not found")} · ${g.reason ?? ""}`);
  } else if (g?.status === "unchecked") {
    lines.push(`      ${yellow("unchecked")} · ${g.reason ?? ""}`);
  }
  lines.push(`      ${dim(`found in: ${c.foundIn.map((o) => ORIGIN_LABEL[o] ?? o).join(", ")}`)}`);
  return lines;
}

const REPO_LABEL: Record<string, string> = {
  geo: "GEO",
  sra: "SRA/BioProject",
  ena: "ENA",
  arrayexpress: "ArrayExpress",
  pdb: "PDB",
  emdb: "EMDB",
  uniprot: "UniProt",
  zenodo: "Zenodo",
  figshare: "Figshare",
  dryad: "Dryad",
  osf: "OSF",
  dataverse: "Dataverse",
  mendeley_data: "Mendeley Data",
  huggingface: "Hugging Face",
  kaggle: "Kaggle",
  other: "other",
};

function fmtData(data: DataLink[], all: boolean): string[] {
  const groups = new Map<string, DataLink[]>();
  for (const d of data) groups.set(d.repository, [...(groups.get(d.repository) ?? []), d]);
  const lines: string[] = [];
  const labelW = Math.max(...[...groups.keys()].map((k) => (REPO_LABEL[k] ?? k).length), 5) + 2;
  for (const [repo, items] of groups) {
    const label = (REPO_LABEL[repo] ?? repo).padEnd(labelW);
    const ids = items.every((d) => d.id && d.kind === "accession") || ["pdb", "geo", "sra", "ena", "arrayexpress", "emdb", "uniprot"].includes(repo);
    if (ids) {
      const shown = all ? items : items.slice(0, 12);
      const more = items.length - shown.length;
      const body = wrap(`${shown.map((d) => d.id ?? d.url).join(" ")}${more ? ` (+${more} more)` : ""}`, 2 + labelW);
      lines.push(`  ${label}${body.trimStart()}`);
    } else {
      const shown = all ? items : items.slice(0, 4);
      shown.forEach((d, i) => lines.push(`  ${i === 0 ? label : " ".repeat(labelW)}${d.url.replace(/^https?:\/\//, "")}`));
      if (items.length > shown.length) lines.push(`  ${" ".repeat(labelW)}${dim(`+${items.length - shown.length} more (--all)`)}`);
    }
  }
  return lines;
}

function authorsLine(authors: string[]): string {
  if (!authors.length) return "Unknown authors";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3} more`;
}

/** Render a brief as plain terminal text. */
export function formatBrief(b: Brief, opts: FormatOptions = {}): string {
  setup(opts);
  const all = !!opts.all;
  const p = b.paper;
  const out: string[] = [];
  out.push(bold(wrap(p.title, 0)));
  out.push(dim(wrap([authorsLine(p.authors), p.venue, p.year].filter(Boolean).join(" · "), 0)));
  const ids = [
    p.doi && `doi:${p.doi}`,
    p.arxivId && `arXiv:${p.arxivId}${p.version ? `v${p.version}` : ""}`,
    !p.arxivId && p.version ? `version ${p.version}` : null,
    p.pmid && `PMID ${p.pmid}`,
    p.pmcid,
    p.publishedDoi && `published as doi:${p.publishedDoi}`,
  ].filter(Boolean);
  out.push(ids.join("  "));
  const a = b.access;
  const oa = a.openAccess === true ? "yes" : a.openAccess === false ? "no" : "unknown";
  const ft = a.fullText ? `full text read from ${a.fullText.source === "ncbi_pmc" ? "PMC (NCBI)" : "Europe PMC"} ${a.fullText.id}` : "no full text read";
  out.push(`Open access: ${oa}${a.license ? `, ${a.license}` : ""}${a.basis ? dim(` (${a.basis})`) : ""} · ${ft}`);
  out.push("");

  out.push(`${bold("Readiness")}  ${levelTag(b.readiness.level)}  ${dim(b.readiness.summary)}`);
  const idW = Math.max(...b.readiness.checks.map((c) => c.id.length)) + 2;
  for (const c of b.readiness.checks) {
    const head = `  ${statusTag(c.status)}  ${c.id.padEnd(idW)}`;
    const body = wrap(c.reason, 4 + 4 + idW).trimStart();
    out.push(`${head}${body}${c.core ? "" : dim(" (advisory)")}`);
  }
  out.push("");

  const primary = b.code.filter((c) => c.role === "primary");
  const mentioned = b.code.filter((c) => c.role === "mentioned");
  out.push(bold(`Code`) + dim(`  ${primary.length} from the paper, ${mentioned.length} tools mentioned`));
  if (!b.code.length) out.push(`  ${dim("none found")}`);
  for (const c of all ? primary : primary.slice(0, 5)) out.push(...fmtCode(c));
  if (!all && primary.length > 5) out.push(`  ${dim(`+${primary.length - 5} more (--all)`)}`);
  if (mentioned.length) {
    const names = mentioned.map((c) => (c.host === "github" && c.id ? c.id : codeLabel(c)));
    const shown = all ? names : names.slice(0, 8);
    out.push(wrap(`mentioned: ${shown.join(", ")}${names.length > shown.length ? ` (+${names.length - shown.length} more)` : ""}`, 2));
  }
  out.push("");

  out.push(bold("Data") + dim(`  ${b.data.length} link${b.data.length === 1 ? "" : "s"} and accessions`));
  if (!b.data.length) out.push(`  ${dim("none found")}`);
  else out.push(...fmtData(b.data, all));
  out.push("");

  for (const [title, text] of [
    ["Code availability", b.statements.code],
    ["Data availability", b.statements.data],
  ] as const) {
    if (!text) continue;
    out.push(bold(title));
    out.push(wrap(all ? text : clip(text.replace(/\n+/g, " "), 600), 2));
    out.push("");
  }

  const src = b.sources.map((s) => `${s.name} ${s.status ?? s.error ?? "error"} ${(s.ms / 1000).toFixed(1)}s`).join(" · ");
  out.push(dim(wrap(`Sources: ${src}`, 0)));
  for (const w of b.warnings) out.push(yellow(wrap(`Note: ${w}`, 0)));
  return out.join("\n");
}

/** Render search results as plain terminal text. */
export function formatSearch(r: SearchResult, opts: FormatOptions = {}): string {
  setup(opts);
  const out: string[] = [];
  out.push(`${bold("Europe PMC")}  ${r.total.toLocaleString("en-US")} results for ${JSON.stringify(r.query)}${dim(` · sorted by ${r.sort} · ${(r.source.ms / 1000).toFixed(1)}s`)}`);
  out.push("");
  const w = String(r.hits.length).length;
  for (const h of r.hits) {
    const n = `${String(h.rank).padStart(w)}. `;
    out.push(`${n}${bold(wrap(h.title, n.length).trimStart())}`);
    const pad = " ".repeat(n.length);
    const meta = [clip(h.authors || "Unknown authors", 70), h.journal, h.year, `cited by ${h.citedBy.toLocaleString("en-US")}`, h.openAccess ? "open access" : null]
      .filter(Boolean)
      .join(" · ");
    out.push(dim(wrap(meta, n.length)));
    const ids = [h.doi && `doi:${h.doi}`, h.pmid && `PMID ${h.pmid}`, h.pmcid, !h.doi && !h.pmid ? `${h.source}:${h.id}` : null].filter(Boolean).join("  ");
    out.push(`${pad}${ids}`);
  }
  if (!r.hits.length) out.push(dim("No results."));
  return out.join("\n");
}
