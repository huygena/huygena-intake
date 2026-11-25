import { IntakeError } from "./errors.js";
import { makeCtx, type HttpOptions } from "./http.js";
import { parseId } from "./id.js";
import { parseJats } from "./jats.js";
import { licenseUrl as ccUrl } from "./license.js";
import { findLinks, type FindLinksOptions } from "./links.js";
import { assessReadiness } from "./readiness.js";
import type { Access, Brief, CodeLink, CodeRole, DataLink, LinkOrigin, Paper } from "./schema.js";
import { fetchArxiv } from "./sources/arxiv.js";
import { fetchBiorxiv, type BiorxivRecord } from "./sources/biorxiv.js";
import { fetchCrossref, type CrossrefWork } from "./sources/crossref.js";
import { fetchEpmcFullText, fetchEpmcRecord, type EpmcRecord } from "./sources/europepmc.js";
import { checkGithubRepo, unchecked, type GithubCtx } from "./sources/github.js";
import { fetchIdConv, fetchPmcFullText } from "./sources/ncbi.js";
import { readEnv } from "./text.js";
import { VERSION } from "./version.js";

export interface IntakeOptions extends HttpOptions {
  /** GitHub token for 5,000 API requests/hour instead of 60. Default: `GITHUB_TOKEN` env var. Only sent to api.github.com. */
  githubToken?: string;
  /** Read open-access full text from PMC / Europe PMC for statements and links. Default `true`. */
  fullText?: boolean;
  /** Check GitHub repositories through the API. Default `true`. */
  checkGithub?: boolean;
  /** Most GitHub repositories to check per brief. Default 5. Only links the paper gives as its own code are checked. */
  maxRepoChecks?: number;
}

interface TextSource {
  origin: LinkOrigin;
  text: string;
  statement?: "code" | "data";
  defaultRole: CodeRole;
}

const ORIGIN_RANK: Record<LinkOrigin, number> = {
  code_statement: 0,
  abstract: 1,
  arxiv_comment: 2,
  crossref_relation: 3,
  data_statement: 4,
  full_text: 5,
  crossref_link: 6,
};

function emptyPaper(): Paper {
  return {
    title: "Untitled",
    authors: [],
    year: null,
    published: null,
    venue: null,
    publisher: null,
    type: null,
    abstract: null,
    doi: null,
    arxivId: null,
    pmid: null,
    pmcid: null,
    version: null,
    publishedDoi: null,
    links: { landing: null, doi: null, pdf: null, europepmc: null, pmc: null },
  };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fromCrossref(p: Paper, w: CrossrefWork) {
  p.title = w.title;
  p.authors = w.authors;
  p.year = w.year;
  p.published = w.published;
  p.venue = w.venue;
  p.publisher = w.publisher;
  p.type = w.type;
  p.abstract = w.abstract;
  p.doi = w.doi;
  p.links.landing = w.landing;
  p.links.doi = `https://doi.org/${w.doi}`;
}

function fromEpmc(p: Paper, r: EpmcRecord, fillOnly: boolean) {
  const set = <K extends keyof Paper>(k: K, v: Paper[K]) => {
    if (v == null || (Array.isArray(v) && !v.length)) return;
    if (!fillOnly || p[k] == null || (Array.isArray(p[k]) && !(p[k] as unknown[]).length) || (k === "title" && p.title === "Untitled")) p[k] = v;
  };
  set("title", r.title);
  set("authors", r.authors);
  set("year", r.year);
  set("published", r.published);
  set("venue", r.journal);
  set("abstract", r.abstract);
  set("doi", r.doi);
  if (r.source === "PPR") set("type", "preprint");
  p.pmid = p.pmid ?? r.pmid;
  p.pmcid = p.pmcid ?? r.pmcid;
  p.links.europepmc = r.url;
  if (r.doi) p.links.doi = p.links.doi ?? `https://doi.org/${r.doi}`;
  if (r.pdfUrl) p.links.pdf = p.links.pdf ?? r.pdfUrl;
}

function fromBiorxiv(p: Paper, r: BiorxivRecord) {
  p.title = r.title;
  p.authors = r.authors;
  p.published = r.date;
  p.year = r.date ? Number(r.date.slice(0, 4)) : null;
  p.venue = `${r.server === "medrxiv" ? "medRxiv" : "bioRxiv"}${r.category ? ` · ${r.category}` : ""}`;
  p.publisher = "Cold Spring Harbor Laboratory";
  p.type = "preprint";
  p.abstract = r.abstract;
  p.doi = r.doi;
  p.version = r.version;
  p.publishedDoi = r.publishedDoi;
  p.links.landing = r.landing;
  p.links.doi = `https://doi.org/${r.doi}`;
  p.links.pdf = r.pdf;
}

/**
 * Build a replication brief for a paper: metadata, open-access status, code and data links,
 * availability statements, GitHub checks and a rule-based readiness assessment.
 *
 * Throws `IntakeError` with code `invalid_id`, `not_found`, `upstream` or `timeout` when the paper itself
 * cannot be resolved. Failures of enrichment sources (Europe PMC, NCBI, GitHub) become `warnings` instead.
 */
export async function intake(input: string, opts: IntakeOptions = {}): Promise<Brief> {
  const id = parseId(input);
  if (!id) {
    throw new IntakeError(
      "invalid_id",
      `Not a DOI, arXiv ID, bioRxiv/medRxiv DOI, PubMed ID or PMCID: ${JSON.stringify(String(input).slice(0, 200))}`,
    );
  }
  const ctx: GithubCtx = { ...makeCtx(opts), githubToken: opts.githubToken ?? readEnv("GITHUB_TOKEN") };
  const paper = emptyPaper();
  const access: Access = { openAccess: null, basis: null, license: null, licenseUrl: null, fullText: null };
  const statements: Brief["statements"] = { code: null, data: null };
  const texts: TextSource[] = [];
  let crossref: CrossrefWork | null = null;
  let epmc: EpmcRecord | null = null;
  let preprintServer: string | null = null;
  let biorxivLicense: string | null = null;

  // Enrichment calls: a failure becomes a warning that says what is missing because of it.
  const soft = async <T>(consequence: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p;
    } catch (e) {
      ctx.warnings.push(`${message(e)}; ${consequence}`);
      return null;
    }
  };
  let pmcFullText: Promise<string | null> | null = null;

  // 1. Resolve the paper.
  if (id.kind === "arxiv") {
    const e = await fetchArxiv(ctx, id.value, id.version);
    if (!e) throw new IntakeError("not_found", `arXiv has no paper ${id.value}`);
    paper.title = e.title;
    paper.authors = e.authors;
    paper.published = e.published;
    paper.year = e.published ? Number(e.published.slice(0, 4)) : null;
    paper.venue = `arXiv${e.primaryCategory ? ` · ${e.primaryCategory}` : ""}`;
    paper.publisher = "arXiv";
    paper.type = "preprint";
    paper.abstract = e.abstract;
    paper.arxivId = e.id;
    paper.version = e.version;
    paper.doi = `10.48550/arxiv.${e.id.toLowerCase()}`;
    paper.publishedDoi = e.doi;
    paper.links = { ...paper.links, landing: e.landing, doi: `https://doi.org/${paper.doi}`, pdf: e.pdf };
    preprintServer = "arXiv";
    if (e.comment) texts.push({ origin: "arxiv_comment", text: e.comment, defaultRole: "primary" });
  } else if (id.kind === "biorxiv") {
    const rec = await fetchBiorxiv(ctx, id.value, { server: id.server, version: id.version });
    if (rec) {
      fromBiorxiv(paper, rec);
      preprintServer = rec.server === "medrxiv" ? "medRxiv" : "bioRxiv";
      biorxivLicense = rec.license;
    } else {
      crossref = await fetchCrossref(ctx, id.value);
      if (!crossref) throw new IntakeError("not_found", `Neither bioRxiv, medRxiv nor Crossref know ${id.value}`);
      fromCrossref(paper, crossref);
    }
    // Europe PMC carries full text for some preprints (PPR records).
    if (opts.fullText !== false) {
      epmc = await soft(
        "preprint full text from Europe PMC was not checked",
        fetchEpmcRecord(ctx, `DOI:"${id.value}"`, Math.min(ctx.timeoutMs, 15_000)),
      );
    }
    if (epmc) fromEpmc(paper, epmc, true);
  } else {
    // DOI, PMID or PMCID. NCBI's ID converter is fast and links all three for papers in PMC.
    let doi: string | null = id.kind === "doi" ? id.value : null;
    const crossrefOf = (d: string) =>
      fetchCrossref(ctx, d).then(
        (w) => ({ w, err: null as unknown }),
        (err: unknown) => ({ w: null as CrossrefWork | null, err }),
      );
    let cr: { w: CrossrefWork | null; err: unknown } = { w: null, err: null };
    let conv: Awaited<ReturnType<typeof fetchIdConv>>;
    if (doi) {
      [cr, conv] = await Promise.all([crossrefOf(doi), fetchIdConv(ctx, doi)]);
    } else {
      conv = await fetchIdConv(ctx, id.value);
      if (conv?.doi) {
        doi = conv.doi;
        cr = await crossrefOf(doi);
      }
    }
    crossref = cr.w;
    const pmid = id.kind === "pmid" ? id.value : (conv?.pmid ?? null);
    const pmcid = id.kind === "pmcid" ? id.value : (conv?.pmcid ?? null);
    // Start on the PMC full text while Europe PMC (often slow) is asked for the rest.
    if (pmcid && opts.fullText !== false) pmcFullText = fetchPmcFullText(ctx, pmcid);
    const q = pmid ? `EXT_ID:${pmid} AND SRC:MED` : pmcid ? `PMCID:${pmcid}` : `DOI:"${doi}"`;
    if (crossref) {
      // Crossref already gave the metadata, so cap the wait.
      epmc = await soft("open-access flag and license from Europe PMC are missing", fetchEpmcRecord(ctx, q, Math.min(ctx.timeoutMs, pmcid ? 12_000 : 20_000)));
    } else {
      try {
        epmc = await fetchEpmcRecord(ctx, q);
      } catch (e) {
        if (cr.err) throw cr.err;
        const code = e instanceof IntakeError ? e.code : "upstream";
        const what = doi ? `Crossref has no record of ${doi}` : `NCBI has no PMC record for ${id.canonical}`;
        throw new IntakeError(code, `${what}, and ${message(e)}`);
      }
    }
    if (!crossref && !epmc) {
      if (cr.err) throw cr.err;
      throw new IntakeError("not_found", `Crossref and Europe PMC have no record of ${id.canonical}`);
    }
    if (crossref) fromCrossref(paper, crossref);
    if (epmc) fromEpmc(paper, epmc, !!crossref);
    if (cr.err) ctx.warnings.push(`${message(cr.err)}; metadata comes from Europe PMC only`);
    paper.pmid = paper.pmid ?? pmid;
    paper.pmcid = paper.pmcid ?? pmcid;
  }
  if (paper.pmcid) paper.links.pmc = `https://pmc.ncbi.nlm.nih.gov/articles/${paper.pmcid}/`;

  // 2. Open access and license from metadata.
  if (preprintServer) {
    access.openAccess = true;
    access.basis = `${preprintServer} preprint server`;
  } else if (epmc && epmc.source !== "PPR") {
    if (epmc.isOpenAccess) {
      access.openAccess = true;
      access.basis = "Europe PMC";
    } else if (crossref?.license && crossref.license !== "none") {
      access.openAccess = true;
      access.basis = "Crossref license";
    } else {
      access.openAccess = false;
      access.basis = "Europe PMC";
    }
  } else if (crossref?.license && crossref.license !== "none") {
    access.openAccess = true;
    access.basis = "Crossref license";
  }
  access.license = epmc?.license ?? crossref?.license ?? biorxivLicense ?? null;
  access.licenseUrl = crossref?.license && access.license === crossref.license ? crossref.licenseUrl : ccUrl(access.license);

  // 3. Full text (PMC open-access subset via NCBI, then Europe PMC).
  if (opts.fullText !== false) {
    let xml: string | null = null;
    if (paper.pmcid) {
      xml = await (pmcFullText ?? fetchPmcFullText(ctx, paper.pmcid));
      if (xml) access.fullText = { source: "ncbi_pmc", id: paper.pmcid };
      else if (epmc?.isOpenAccess || epmc?.fullTextIds.includes(paper.pmcid)) {
        xml = await soft("full text could not be read", fetchEpmcFullText(ctx, paper.pmcid));
        if (xml) access.fullText = { source: "europepmc", id: paper.pmcid };
      }
    } else if (epmc?.source === "PPR" && epmc.fullTextIds[0]) {
      const ppr = epmc.fullTextIds[0];
      xml = await soft("full text could not be read", fetchEpmcFullText(ctx, ppr));
      if (xml) access.fullText = { source: "europepmc", id: ppr };
    }
    if (xml) {
      const doc = parseJats(xml);
      for (const s of doc.statements.code) texts.push({ origin: "code_statement", text: s, statement: "code", defaultRole: "primary" });
      for (const s of doc.statements.data) texts.push({ origin: "data_statement", text: s, statement: "data", defaultRole: "primary" });
      if (doc.bodyText) texts.push({ origin: "full_text", text: doc.bodyText, defaultRole: "mentioned" });
      if (!paper.abstract && doc.abstract) paper.abstract = doc.abstract;
      if (doc.license) {
        access.license = doc.license;
        access.licenseUrl = doc.licenseUrl ?? ccUrl(doc.license);
      }
      if (access.openAccess !== true && access.fullText?.source === "ncbi_pmc") {
        access.openAccess = true;
        access.basis = "PMC open-access subset";
      }
      statements.code = doc.statements.code.join("\n\n") || null;
      statements.data = doc.statements.data.join("\n\n") || null;
    } else if (id.kind === "arxiv") {
      ctx.warnings.push("arXiv full text is not parsed: links come from the abstract and the author comments");
    } else {
      ctx.warnings.push("No open full text in PMC or Europe PMC: code and data statements could not be read");
    }
  }

  if (paper.publishedDoi && paper.publishedDoi !== paper.doi) {
    ctx.warnings.push(`A journal version exists (doi:${paper.publishedDoi}); run intake on it too, it may carry code and data statements`);
  }

  // 4. Links.
  if (paper.abstract) texts.unshift({ origin: "abstract", text: paper.abstract, defaultRole: "primary" });
  if (crossref?.relationText) texts.push({ origin: "crossref_relation", text: crossref.relationText, defaultRole: "primary" });
  if (crossref?.linkUrls.length) texts.push({ origin: "crossref_link", text: crossref.linkUrls.join("\n"), defaultRole: "mentioned" });

  const selfDois = [paper.doi, paper.publishedDoi, id.kind === "doi" || id.kind === "biorxiv" ? id.value : null]
    .filter((d): d is string => !!d)
    .map((d) => d.toLowerCase());
  const isSelf = (url: string) => {
    const u = url.toLowerCase();
    return selfDois.some((d) => u.includes(d)) || (!!paper.arxivId && u.includes(`arxiv.org/abs/${paper.arxivId.toLowerCase()}`));
  };

  const code = new Map<string, CodeLink>();
  const data = new Map<string, DataLink>();
  for (const t of texts) {
    const fl: FindLinksOptions = { defaultRole: t.defaultRole };
    if (t.statement) fl.statement = t.statement;
    const found = findLinks(t.text, fl);
    for (const c of found.code) {
      if (isSelf(c.url)) continue;
      const key = (c.id ? `${c.host}:${c.id}` : c.url).toLowerCase();
      const prev = code.get(key);
      if (!prev) {
        code.set(key, { ...c, foundIn: [t.origin], github: null });
        continue;
      }
      if (!prev.foundIn.includes(t.origin)) prev.foundIn.push(t.origin);
      if (c.role === "primary" && prev.role !== "primary") {
        prev.role = "primary";
        prev.context = c.context;
      }
      if (!prev.ref && c.ref) prev.ref = c.ref;
    }
    for (const d of found.data) {
      if (isSelf(d.url)) continue;
      const key = (d.id ? `${d.repository}:${d.id}` : d.url).toLowerCase();
      const prev = data.get(key);
      if (!prev) data.set(key, { ...d, foundIn: [t.origin] });
      else if (!prev.foundIn.includes(t.origin)) prev.foundIn.push(t.origin);
    }
  }

  const rank = (o: LinkOrigin[]) => Math.min(...o.map((x) => ORIGIN_RANK[x]));
  const codeList = [...code.values()].sort((a, b) => (a.role === b.role ? rank(a.foundIn) - rank(b.foundIn) : a.role === "primary" ? -1 : 1));
  const dataList = [...data.values()].sort((a, b) => rank(a.foundIn) - rank(b.foundIn));

  // 5. GitHub checks for the paper's own repositories.
  const max = opts.maxRepoChecks ?? 5;
  const targets = codeList.filter((c) => c.host === "github" && c.role === "primary" && c.id).slice(0, opts.checkGithub === false ? 0 : max);
  await Promise.all(
    targets.map(async (c) => {
      c.github = await checkGithubRepo(ctx, c.id!);
    }),
  );
  for (const c of codeList) {
    if (c.host !== "github" || c.github) continue;
    c.github = unchecked(
      opts.checkGithub === false
        ? "GitHub checks turned off"
        : c.role === "mentioned"
          ? "Not checked: cited as a tool, not as the paper's code"
          : `Not checked: more than ${max} repositories`,
    );
  }

  const partial = { code: codeList, data: dataList, access, statements };
  return {
    schema: "huygena.brief/v1",
    tool: { name: "huygena-intake", version: VERSION },
    generatedAt: new Date().toISOString(),
    input,
    id,
    paper,
    access,
    code: codeList,
    data: dataList,
    statements,
    readiness: assessReadiness(partial),
    sources: ctx.sources,
    warnings: ctx.warnings,
  };
}
