import type { CodeHost, CodeRole, DataRepository, FoundCode, FoundData, FoundLinks } from "./schema.js";

export interface FindLinksOptions {
  /**
   * Treat the text as a code or data availability statement. Unknown URLs and DOIs are then kept
   * (as host/repository `other`), and archives that can hold either (Zenodo, Figshare, OSF) default to this bucket.
   */
  statement?: "code" | "data";
  /**
   * Role for code links whose sentence has no cue either way. Use `primary` for abstracts and statements,
   * `mentioned` (the default) for body text. With `mentioned`, only strong cues ("we release", "our code") promote a link.
   */
  defaultRole?: CodeRole;
}

type Bucket = "code" | "data" | "either";

interface Classified {
  bucket: Bucket;
  url: string;
  codeHost?: CodeHost;
  repository?: DataRepository;
  id: string | null;
  ref?: string | null;
}

const SCHEMELESS_HOSTS = [
  "github\\.com",
  "gitlab\\.com",
  "bitbucket\\.org",
  "codeberg\\.org",
  "zenodo\\.org",
  "figshare\\.com",
  "osf\\.io",
  "datadryad\\.org",
  "huggingface\\.co",
  "codeocean\\.com",
  "kaggle\\.com",
  "archive\\.softwareheritage\\.org",
  "doi\\.org",
  "dx\\.doi\\.org",
  "rcsb\\.org",
  "uniprot\\.org",
].join("|");

const URL_RE = new RegExp(
  `(?:https?:\\/\\/|ftp:\\/\\/|(?<![\\w.@\\/-])www\\.)[^\\s<>"'\`{}|\\\\^]+|(?<![\\w.@\\/:-])(?:www\\.)?(?:${SCHEMELESS_HOSTS})\\/[^\\s<>"'\`{}|\\\\^]+`,
  "gi",
);
const DOI_RE = /(?<![\w/.])10\.\d{4,9}\/[^\s<>"'`{}|\\^]+/g;
const SWH_RE = /\bswh:1:(?:cnt|dir|rev|rel|snp|ori):[0-9a-f]{40}\b/g;

const ACCESSIONS: { re: RegExp; repository: DataRepository; url: (id: string) => string }[] = [
  { re: /\bGSE\d{3,8}\b/g, repository: "geo", url: (id) => `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}` },
  {
    re: /\b(?:SR[APRSX]|DR[APRSX])\d{6,9}\b/g,
    repository: "sra",
    url: (id) => `https://www.ncbi.nlm.nih.gov/sra/?term=${id}`,
  },
  { re: /\bPRJ(?:NA|DB)\d{3,9}\b/g, repository: "sra", url: (id) => `https://www.ncbi.nlm.nih.gov/bioproject/${id}` },
  {
    re: /\b(?:ER[APRSX]\d{6,9}|PRJEB\d{3,9})\b/g,
    repository: "ena",
    url: (id) => `https://www.ebi.ac.uk/ena/browser/view/${id}`,
  },
  {
    re: /\bE-[A-Z]{4}-\d{1,7}\b/g,
    repository: "arrayexpress",
    url: (id) => `https://www.ebi.ac.uk/biostudies/arrayexpress/studies/${id}`,
  },
  { re: /\bEMD-\d{4,5}\b/g, repository: "emdb", url: (id) => `https://www.ebi.ac.uk/emdb/${id}` },
];

const PDB_URL = (id: string) => `https://www.rcsb.org/structure/${id}`;
const UNIPROT_URL = (id: string) => `https://www.uniprot.org/uniprotkb/${id}/entry`;
const PDB_ID = /^\d[A-Za-z0-9]{3}$/;
const UNIPROT_ID = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

const GITHUB_RESERVED = new Set([
  "about", "apps", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features",
  "github-copilot", "join", "login", "marketplace", "new", "notifications", "orgs", "organizations", "pricing",
  "readme", "search", "security", "settings", "site", "sponsors", "topics", "trending", "users", "codespaces",
  "resources", "solutions", "team", "home", "issues", "pulls", "dashboard", "account", "mobile", "premium-support",
]);
const HF_RESERVED = new Set([
  "docs", "blog", "papers", "models", "datasets", "spaces", "join", "login", "pricing", "learn", "tasks", "settings",
  "organizations", "collections", "enterprise", "posts", "chat", "inference-endpoints", "api", "terms-of-service",
  "privacy", "huggingface",
]);
const OSF_RESERVED = new Set(["preprints", "registries", "meetings", "institutions", "search", "support", "dashboard", "login", "register"]);
const IGNORED_HOSTS = /(?:^|\.)(?:creativecommons\.org|orcid\.org|ror\.org|w3\.org|schema\.org|crossref\.org|europepmc\.org|ncbi\.nlm\.nih\.gov\/pmc)$/i;

// Cues for whether a code link is the paper's own code or a tool it used.
const STRONG_CUE =
  /\b(?:we (?:release|provide|make|share|publish|open[- ]?source|deposit)|our (?:code|software|implementation|tool|toolkit|package|pipeline|scripts?|repository|framework|library|source code)|source code (?:for|of) (?:this|the|our)|code (?:to|for|that) reproduce|code (?:used|developed|written|generated) (?:in|for) this|(?:accompanying|supporting) this (?:paper|article|study|work)|to reproduce (?:the|our|all) (?:results|analys[ie]s|figures|experiments))\b/i;
const WEAK_CUE =
  /\b(?:source code|(?:code|scripts?|software|implementation|notebooks?|pipeline|package|repository|weights|checkpoints|models?) (?:is|are|has been|have been|was|were|will be) (?:\w+ ){0,3}?(?:available|released|deposited|provided|hosted|accessible|archived|shared)|(?:freely|publicly|openly) (?:available|accessible)|available (?:at|from|on|under|via|in|through)|(?:is|are) open[- ]source|open[- ]source (?:software|code|implementation|package|tool)|can be (?:found|accessed|downloaded|obtained))\b/i;
const TOOL_CUE =
  /\b(?:we used|were used|was used|we employed|developed (?:with|in|using)|implemented (?:in|with|using)|built (?:with|on)|was performed (?:with|using)|were performed (?:with|using)|with the help of)\b/i;
const VERSION_BEFORE_PAREN = /(?:\bv\.?\s?\d[\w.-]*|\bversion\s+\d[\w.-]*|\b\d+\.\d+(?:\.\d+)*)[^()]{0,40}\(\s*$/i;

const CODE_WORDS = /\b(?:code|software|source|scripts?|implementation|pipeline|package|notebooks?|program|tool|repository)\b/gi;
const DATA_WORDS = /\b(?:data repository|data|datasets?|database|raw|measurements|recordings|images|sequences|samples|files)\b/gi;

function trimUrl(raw: string): string {
  let u = raw.replace(/&gt;?$|&lt;?$/i, "");
  for (;;) {
    const before = u;
    u = u.replace(/[.,;:!?'"*»”’]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      if (u.endsWith(close) && count(u, open) < count(u, close)) u = u.slice(0, -1);
    }
    if (u === before) return u;
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function segments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
}

function classifyDoi(doiRaw: string, statement?: "code" | "data"): Classified | null {
  const doi = trimUrl(doiRaw).replace(/\.svg$/i, "");
  const d = doi.toLowerCase();
  const url = `https://doi.org/${doi}`;
  let m: RegExpMatchArray | null;
  if ((m = d.match(/^10\.5281\/zenodo\.(\d+)$/))) return { bucket: "either", url, codeHost: "zenodo", repository: "zenodo", id: `zenodo.${m[1]}` };
  if ((m = d.match(/^10\.6084\/m9\.figshare\.(\d+)(?:\.v\d+)?$/)))
    return { bucket: "either", url, codeHost: "figshare", repository: "figshare", id: `figshare.${m[1]}` };
  if ((m = d.match(/^10\.5061\/(dryad\.[a-z0-9]+)$/))) return { bucket: "data", url, repository: "dryad", id: m[1] ?? null };
  if ((m = d.match(/^10\.17605\/osf\.io\/([a-z0-9]{5})$/))) return { bucket: "either", url, codeHost: "osf", repository: "osf", id: m[1] ?? null };
  if ((m = d.match(/^10\.24433\/co\.(\d+)(?:\.v\d+)?$/))) return { bucket: "code", url, codeHost: "code_ocean", id: `co.${m[1]}` };
  if ((m = d.match(/^10\.2210\/pdb([0-9][a-z0-9]{3})\/pdb$/)))
    return { bucket: "data", url: PDB_URL(m[1]!.toUpperCase()), repository: "pdb", id: m[1]!.toUpperCase() };
  if ((m = d.match(/^10\.7910\/dvn\/([a-z0-9]+)$/))) return { bucket: "data", url, repository: "dataverse", id: `DVN/${m[1]!.toUpperCase()}` };
  if ((m = d.match(/^10\.17632\/([a-z0-9]+)(?:\.\d+)?$/))) return { bucket: "data", url, repository: "mendeley_data", id: m[1] ?? null };
  if (/^10\.48550\/arxiv\./.test(d)) return null;
  if (statement === "code") return { bucket: "code", url, codeHost: "other", id: doi };
  if (statement === "data") return { bucket: "data", url, repository: "other", id: doi };
  return null;
}

function accessionInUrl(url: string): Classified | null {
  for (const a of ACCESSIONS) {
    a.re.lastIndex = 0;
    const m = a.re.exec(url);
    if (m) return { bucket: "data", url: a.url(m[0]), repository: a.repository, id: m[0] };
  }
  return null;
}

function classifyUrl(raw: string, statement?: "code" | "data"): Classified | null {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const seg = segments(u.pathname);
  const first = seg[0]?.toLowerCase();

  if (host === "github.com") {
    const owner = seg[0];
    let repo = seg[1];
    if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase()) || !/^[A-Za-z0-9-]+$/.test(owner)) return null;
    repo = repo.replace(/\.git$/i, "").replace(/[.]+$/, "");
    if (!/^[A-Za-z0-9_.-]+$/.test(repo) || !repo) return null;
    const rest = seg.slice(2);
    let ref: string | null = null;
    if ((rest[0] === "tree" || rest[0] === "blob" || rest[0] === "commit") && rest[1]) ref = rest[1];
    else if (rest[0] === "releases" && rest[1] === "tag" && rest[2]) ref = rest[2];
    return { bucket: "code", url: `https://github.com/${owner}/${repo}`, codeHost: "github", id: `${owner}/${repo}`, ref };
  }
  if (host === "raw.githubusercontent.com" && seg[0] && seg[1]) {
    return {
      bucket: "code",
      url: `https://github.com/${seg[0]}/${seg[1]}`,
      codeHost: "github",
      id: `${seg[0]}/${seg[1]}`,
      ref: seg[2] ?? null,
    };
  }
  if (host === "gitlab.com" || host.startsWith("gitlab.")) {
    const dash = seg.indexOf("-");
    const proj = (dash >= 0 ? seg.slice(0, dash) : seg).slice(0, 6);
    if (proj.length < 2) return null;
    const last = proj.length - 1;
    proj[last] = proj[last]!.replace(/\.git$/i, "");
    const after = dash >= 0 ? seg.slice(dash + 1) : [];
    const ref = (after[0] === "tree" || after[0] === "blob" || after[0] === "commit") && after[1] ? after[1] : null;
    return { bucket: "code", url: `https://${host}/${proj.join("/")}`, codeHost: "gitlab", id: proj.join("/"), ref };
  }
  if ((host === "bitbucket.org" || host === "codeberg.org") && seg[0] && seg[1]) {
    const repo = seg[1].replace(/\.git$/i, "");
    const ref = (seg[2] === "src" || seg[2] === "commits") && seg[3] ? seg[3] : null;
    const codeHost: CodeHost = host === "bitbucket.org" ? "bitbucket" : "codeberg";
    return { bucket: "code", url: `https://${host}/${seg[0]}/${repo}`, codeHost, id: `${seg[0]}/${repo}`, ref };
  }
  if (host === "zenodo.org" || host.endsWith(".zenodo.org")) {
    const rec = u.pathname.match(/\/records?\/(\d+)/i);
    if (rec) return { bucket: "either", url: `https://zenodo.org/records/${rec[1]}`, codeHost: "zenodo", repository: "zenodo", id: `zenodo.${rec[1]}` };
    const doi = u.pathname.match(/(10\.5281\/zenodo\.\d+)/i);
    if (doi?.[1]) return classifyDoi(doi[1]);
    return null;
  }
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = seg.join("/");
    return doi.startsWith("10.") ? classifyDoi(doi, statement) : null;
  }
  if (host === "figshare.com" || host.endsWith(".figshare.com")) {
    const nums = seg.filter((s) => /^\d{5,}$/.test(s));
    const id = nums.length ? `figshare.${nums[nums.length - 1]}` : null;
    if (!id && first !== "s") return null;
    return { bucket: "either", url: `https://${host}${u.pathname}`.replace(/\/$/, ""), codeHost: "figshare", repository: "figshare", id };
  }
  if (host === "datadryad.org") {
    const doi = u.pathname.match(/(10\.5061\/dryad\.[a-z0-9]+)/i);
    if (doi?.[1]) return classifyDoi(doi[1]);
    return first === "stash" ? { bucket: "data", url: `https://datadryad.org${u.pathname}`, repository: "dryad", id: null } : null;
  }
  if (host === "osf.io") {
    if (!first || OSF_RESERVED.has(first) || !/^[a-z0-9]{5}$/i.test(first)) return null;
    return { bucket: "either", url: `https://osf.io/${first}`, codeHost: "osf", repository: "osf", id: first };
  }
  if (host === "archive.softwareheritage.org" || host === "softwareheritage.org") {
    const swh = decodeURIComponent(u.pathname + u.search).match(/swh:1:(?:cnt|dir|rev|rel|snp|ori):[0-9a-f]{40}/);
    if (!swh && host === "softwareheritage.org") return null;
    return { bucket: "code", url: raw, codeHost: "software_heritage", id: swh?.[0] ?? null };
  }
  if (host === "codeocean.com") {
    const cap = u.pathname.match(/\/capsule\/(\d+)/);
    return cap ? { bucket: "code", url: `https://codeocean.com/capsule/${cap[1]}`, codeHost: "code_ocean", id: `capsule.${cap[1]}` } : null;
  }
  if (host === "huggingface.co" || host === "hf.co") {
    if (first === "datasets" && seg[1] && seg[2])
      return { bucket: "data", url: `https://huggingface.co/datasets/${seg[1]}/${seg[2]}`, repository: "huggingface", id: `${seg[1]}/${seg[2]}` };
    if (first === "spaces" && seg[1] && seg[2])
      return { bucket: "code", url: `https://huggingface.co/spaces/${seg[1]}/${seg[2]}`, codeHost: "huggingface", id: `spaces/${seg[1]}/${seg[2]}` };
    if (seg[0] && seg[1] && !HF_RESERVED.has(seg[0].toLowerCase()))
      return { bucket: "code", url: `https://huggingface.co/${seg[0]}/${seg[1]}`, codeHost: "huggingface", id: `${seg[0]}/${seg[1]}` };
    return null;
  }
  if (host === "kaggle.com") {
    if (first === "datasets" && seg[1] && seg[2])
      return { bucket: "data", url: `https://www.kaggle.com/datasets/${seg[1]}/${seg[2]}`, repository: "kaggle", id: `${seg[1]}/${seg[2]}` };
    if ((first === "competitions" || first === "c") && seg[1])
      return { bucket: "data", url: `https://www.kaggle.com/competitions/${seg[1]}`, repository: "kaggle", id: `competitions/${seg[1]}` };
    return null;
  }
  if (host === "rcsb.org" || host === "files.rcsb.org" || host.endsWith(".rcsb.org") || host === "wwpdb.org" || host.endsWith("pdbj.org")) {
    const id =
      u.searchParams.get("structureId") ??
      u.pathname.match(/\/(?:structure|explore|download|entry|3d-view|sequence)\/([0-9][a-z0-9]{3})(?:\.(?:pdb|cif)(?:\.gz)?)?\b/i)?.[1];
    if (id && PDB_ID.test(id)) return { bucket: "data", url: PDB_URL(id.toUpperCase()), repository: "pdb", id: id.toUpperCase() };
  }
  if (host === "ebi.ac.uk") {
    const pdbe = u.pathname.match(/\/pdbe\/entry\/pdb\/([0-9][a-z0-9]{3})\b/i);
    if (pdbe?.[1]) return { bucket: "data", url: PDB_URL(pdbe[1].toUpperCase()), repository: "pdb", id: pdbe[1].toUpperCase() };
  }
  if (host === "uniprot.org" || host === "rest.uniprot.org") {
    const acc = u.pathname.match(/\/uniprot(?:kb)?\/([A-Z0-9]{6,10})\b/i)?.[1]?.toUpperCase();
    if (acc && UNIPROT_ID.test(acc)) return { bucket: "data", url: UNIPROT_URL(acc), repository: "uniprot", id: acc };
  }
  if (host.endsWith("ncbi.nlm.nih.gov") || host.endsWith("ebi.ac.uk") || host.endsWith("ddbj.nig.ac.jp")) {
    const acc = accessionInUrl(decodeURIComponent(u.pathname + u.search));
    if (acc) return acc;
  }
  if (host.includes("dataverse")) {
    const pid = u.searchParams.get("persistentId");
    const doi = pid?.replace(/^doi:/i, "");
    if (doi?.startsWith("10.7910/")) return classifyDoi(doi);
    return { bucket: "data", url: raw, repository: "dataverse", id: null };
  }
  if (host === "data.mendeley.com") {
    const id = u.pathname.match(/\/datasets\/([a-z0-9]+)/i)?.[1] ?? null;
    return id ? { bucket: "data", url: `https://data.mendeley.com/datasets/${id}`, repository: "mendeley_data", id } : null;
  }

  if (!statement || IGNORED_HOSTS.test(host) || IGNORED_HOSTS.test(host + u.pathname)) return null;
  const clean = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  return statement === "code"
    ? { bucket: "code", url: clean, codeHost: "other", id: null }
    : { bucket: "data", url: clean, repository: "other", id: null };
}

/** The sentence around [start, end), trimmed to at most 300 characters. */
function sentenceAt(text: string, start: number, end: number): { sentence: string; left: number } {
  let left = 0;
  const before = text.slice(0, start);
  const re = /[.!?]\s+(?=[A-Z0-9("'“])|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) left = m.index + m[0].length;
  const after = text.slice(end);
  const r = after.search(/[.!?](?=\s|$)|\n/);
  const right = r < 0 ? text.length : end + r + 1;
  let s = text.slice(left, right).replace(/\s+/g, " ").trim();
  if (s.length > 300) {
    const mid = start - left;
    const from = Math.max(0, Math.min(s.length - 300, mid - 150));
    s = `${from > 0 ? "…" : ""}${s.slice(from, from + 300).trim()}${from + 300 < s.length ? "…" : ""}`;
  }
  return { sentence: s, left };
}

function roleFor(text: string, start: number, sentence: string, defaultRole: CodeRole): CodeRole {
  const lead = text.slice(Math.max(0, start - 80), start);
  if (VERSION_BEFORE_PAREN.test(lead)) return "mentioned";
  const inParens = /\(\s*$/.test(lead);
  const strong = STRONG_CUE.test(sentence);
  const weak = WEAK_CUE.test(sentence);
  const tool = TOOL_CUE.test(sentence);
  if (strong && !(inParens && tool)) return "primary";
  if (defaultRole === "primary" && weak && !(inParens && tool)) return "primary";
  if (tool) return "mentioned";
  return defaultRole;
}

function bucketFor(text: string, start: number, left: number, sentence: string, statement?: "code" | "data"): "code" | "data" {
  // Nearest code/data word before the link in the same sentence wins, then any in the sentence.
  const lead = text.slice(left, start);
  // End position of the last match, so "data repository" (data) beats its own "repository" (code) on a tie.
  const lastOf = (re: RegExp, s: string) => {
    let pos = -1;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) pos = m.index + m[0].length;
    return pos;
  };
  const c = lastOf(CODE_WORDS, lead);
  const d = lastOf(DATA_WORDS, lead);
  if (c >= 0 || d >= 0) return c > d ? "code" : "data";
  const cs = lastOf(CODE_WORDS, sentence);
  const ds = lastOf(DATA_WORDS, sentence);
  if (cs >= 0 && ds < 0) return "code";
  if (ds >= 0 && cs < 0) return "data";
  return statement ?? "data";
}

/** PDB and UniProt IDs are short and ambiguous, so they are only taken right after a keyword. */
function keywordAccessions(text: string): { id: string; repository: "pdb" | "uniprot"; index: number }[] {
  const out: { id: string; repository: "pdb" | "uniprot"; index: number }[] = [];
  const kw =
    /\b(PDB|Protein Data Bank|UniProt(?:KB)?(?:\/Swiss-Prot)?)\b(?:\s+(?:with|under|using))?(?:\s+(?:accession|entry|entries|IDs?|codes?|identifiers?|numbers?)\b){0,3}\s*[:#]?\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = kw.exec(text))) {
    const repo: "pdb" | "uniprot" = /^u/i.test(m[1] ?? "") ? "uniprot" : "pdb";
    let pos = m.index + m[0].length;
    const tail = text.slice(pos, pos + 200);
    const tok = /\s*(\(?\s*([A-Za-z0-9]+)\s*\)?)\s*(?:,|;|\band\b|\bor\b|&)?/y;
    let t: RegExpExecArray | null;
    let found = 0;
    tok.lastIndex = 0;
    while ((t = tok.exec(tail)) && t[0].length > 0) {
      const id = t[2] ?? "";
      const ok =
        repo === "pdb" ? PDB_ID.test(id) && /[A-Za-z]/.test(id.slice(1)) : UNIPROT_ID.test(id.toUpperCase()) && id === id.toUpperCase();
      if (!ok) break;
      out.push({ id: id.toUpperCase(), repository: repo, index: pos + t.index });
      found++;
      if (found > 50) break;
    }
  }
  return out;
}

/**
 * Extract code links, data links and dataset accessions from free text. Pure: no network, no I/O.
 *
 * Recognizes GitHub, GitLab (including self-hosted `gitlab.*`), Bitbucket, Codeberg, Zenodo, Figshare,
 * Software Heritage (URLs and SWHIDs), Code Ocean, Hugging Face (models, spaces, datasets), OSF, Dryad,
 * Dataverse, Mendeley Data, Kaggle, and accessions for GEO, SRA/BioProject, ENA, ArrayExpress, EMDB, PDB and UniProt.
 */
export function findLinks(text: string, opts: FindLinksOptions = {}): FoundLinks {
  const src = (text ?? "").replace(/[​-‍⁠﻿­]/g, "");
  const defaultRole = opts.defaultRole ?? "mentioned";
  const code = new Map<string, FoundCode>();
  const data = new Map<string, FoundData>();

  const add = (c: Classified, index: number, length: number, kind: "link" | "accession") => {
    const { sentence, left } = sentenceAt(src, index, index + length);
    const bucket: "code" | "data" = c.bucket === "either" ? bucketFor(src, index, left, sentence, opts.statement) : c.bucket;
    if (bucket === "code") {
      const key = (c.id ? `${c.codeHost}:${c.id}` : c.url).toLowerCase();
      const prev = code.get(key);
      // Unknown hosts (project sites, tool homepages) need a strong cue to count as the paper's code.
      const role = roleFor(src, index, sentence, c.codeHost === "other" ? "mentioned" : defaultRole);
      if (prev) {
        if (role === "primary" && prev.role !== "primary") {
          prev.role = "primary";
          prev.context = sentence;
        }
        if (!prev.ref && c.ref) prev.ref = c.ref;
        return;
      }
      code.set(key, {
        url: c.url,
        host: c.codeHost ?? "other",
        id: c.id,
        ref: c.ref ?? null,
        role,
        context: sentence || null,
      });
    } else {
      const repository = c.repository ?? "other";
      const key = (c.id ? `${repository}:${c.id}` : c.url).toLowerCase();
      if (data.has(key)) return;
      data.set(key, { url: c.url, repository, id: c.id, kind, context: sentence || null });
    }
  };

  // 1. URLs (with or without scheme). Mask them so DOIs and accessions inside are not matched twice.
  let masked = src;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(src))) {
    const url = trimUrl(m[0]);
    masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
    const c = classifyUrl(url, opts.statement);
    if (c) add(c, m.index, url.length, "link");
  }

  // 2. Bare DOIs.
  DOI_RE.lastIndex = 0;
  while ((m = DOI_RE.exec(masked))) {
    const c = classifyDoi(m[0], opts.statement);
    if (c) add(c, m.index, m[0].length, "link");
  }

  // 3. Software Heritage IDs.
  SWH_RE.lastIndex = 0;
  while ((m = SWH_RE.exec(masked))) {
    add(
      { bucket: "code", url: `https://archive.softwareheritage.org/${m[0]}`, codeHost: "software_heritage", id: m[0] },
      m.index,
      m[0].length,
      "link",
    );
  }

  // 4. Accessions with distinctive formats.
  for (const a of ACCESSIONS) {
    a.re.lastIndex = 0;
    while ((m = a.re.exec(masked))) {
      add({ bucket: "data", url: a.url(m[0]), repository: a.repository, id: m[0] }, m.index, m[0].length, "accession");
    }
  }

  // 5. PDB and UniProt IDs after a keyword.
  for (const k of keywordAccessions(masked)) {
    const url = k.repository === "pdb" ? PDB_URL(k.id) : UNIPROT_URL(k.id);
    add({ bucket: "data", url, repository: k.repository, id: k.id }, k.index, k.id.length, "accession");
  }

  return { code: [...code.values()], data: [...data.values()] };
}
