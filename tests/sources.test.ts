import { describe, expect, it } from "vitest";
import { makeCtx } from "../src/http.js";
import { fetchArxiv, parseArxivAtom } from "../src/sources/arxiv.js";
import { fetchBiorxiv, parseBiorxiv } from "../src/sources/biorxiv.js";
import { fetchCrossref, parseCrossref } from "../src/sources/crossref.js";
import { fetchEpmcFullText, fetchEpmcRecord, fetchEpmcSearch, parseEpmcRecord } from "../src/sources/europepmc.js";
import { checkRepo, detectLicense, parseGithubRepo, parseRefs, spdx, type RepoCtx } from "../src/sources/repo.js";
import { fetchIdConv, fetchPmcFullText, parseIdConv } from "../src/sources/ncbi.js";
import { fakeFetch, fx, gitRefs, timeoutError, type Route } from "./helpers.js";

const ctxWith = (routes: Route[], extra: Partial<RepoCtx> = {}) => {
  const f = fakeFetch(routes);
  const ctx: RepoCtx = { ...makeCtx({ fetch: f.fetch, mailto: "" }), ...extra };
  return { ctx, ...f };
};

describe("crossref", () => {
  it("parses a journal article", () => {
    const w = parseCrossref(JSON.parse(fx("crossref-alphafold2.json")))!;
    expect(w).toMatchObject({
      doi: "10.1038/s41586-021-03819-2",
      title: "Highly accurate protein structure prediction with AlphaFold",
      year: 2021,
      published: "2021-07-15",
      venue: "Nature",
      type: "journal-article",
      license: "CC-BY-4.0",
      pdf: "https://www.nature.com/articles/s41586-021-03819-2.pdf",
    });
    expect(w.authors[0]).toBe("John Jumper");
    expect(w.authors.length).toBeGreaterThan(30);
    expect(w.abstract).toMatch(/^Proteins are essential to life/);
    expect(w.abstract).not.toMatch(/<jats:/);
  });

  it("returns null for junk", () => {
    expect(parseCrossref(null)).toBeNull();
    expect(parseCrossref({ message: {} })).toBeNull();
  });

  it("maps 404 to null and 5xx to an upstream error, and adds mailto only when set", async () => {
    const a = ctxWith([{ match: /crossref/, status: 404 }]);
    expect(await fetchCrossref(a.ctx, "10.1/x")).toBeNull();
    const b = ctxWith([{ match: /crossref/, status: 503 }]);
    await expect(fetchCrossref(b.ctx, "10.1/x")).rejects.toMatchObject({ code: "upstream", message: "Crossref: HTTP 503" });
    const c = ctxWith([{ match: /crossref/, file: "crossref-plos-enrichment.json" }]);
    c.ctx.mailto = "ops@example.org";
    await fetchCrossref(c.ctx, "10.1371/journal.pcbi.1009935");
    expect(c.calls[0]!.url).toBe("https://api.crossref.org/works/10.1371%2Fjournal.pcbi.1009935?mailto=ops%40example.org");
    // The recorded source URL never carries the email.
    expect(c.ctx.sources[0]!.url).not.toContain("example.org");
  });
});

describe("arxiv", () => {
  it("parses an Atom entry", () => {
    expect(parseArxivAtom(fx("arxiv-lora.xml"))).toMatchObject({
      id: "2106.09685",
      version: 2,
      title: "LoRA: Low-Rank Adaptation of Large Language Models",
      published: "2021-06-17",
      primaryCategory: "cs.CL",
      pdf: "https://arxiv.org/pdf/2106.09685v2",
      landing: "https://arxiv.org/abs/2106.09685v2",
    });
    expect(parseArxivAtom(fx("arxiv-lora.xml"))!.abstract).toContain("https://github.com/microsoft/LoRA");
  });

  it("returns null for an empty feed", async () => {
    expect(parseArxivAtom(fx("arxiv-missing.xml"))).toBeNull();
    const { ctx, calls } = ctxWith([{ match: /arxiv/, file: "arxiv-missing.xml" }]);
    expect(await fetchArxiv(ctx, "2399.99999", 3)).toBeNull();
    expect(calls[0]!.url).toBe("https://export.arxiv.org/api/query?id_list=2399.99999v3");
  });

  it("reports timeouts", async () => {
    const { ctx } = ctxWith([{ match: /arxiv/, error: timeoutError() }]);
    await expect(fetchArxiv(ctx, "1706.03762")).rejects.toMatchObject({ code: "timeout", message: "arXiv: timed out after 30s" });
  });
});

describe("biorxiv", () => {
  const json = JSON.parse(fx("biorxiv-colabfold.json"));
  it("takes the latest version by default and a given version on request", () => {
    expect(parseBiorxiv(json, "biorxiv")).toMatchObject({ version: 3, date: "2022-02-08", license: "CC-BY-NC-ND", publishedDoi: "10.1038/s41592-022-01488-1" });
    expect(parseBiorxiv(json, "biorxiv", 1)).toMatchObject({
      version: 1,
      authors: ["M. Mirdita", "S. Ovchinnikov", "M. Steinegger"],
      landing: "https://www.biorxiv.org/content/10.1101/2021.08.15.456425v1",
    });
  });

  it("falls through to medRxiv and returns null when neither has it", async () => {
    const { ctx, calls } = ctxWith([{ match: /api\.biorxiv\.org/, file: "biorxiv-missing.json" }]);
    expect(await fetchBiorxiv(ctx, "10.1101/2099.01.01.000000")).toBeNull();
    expect(calls.map((c) => c.url.split("/")[4])).toEqual(["biorxiv", "medrxiv"]);
  });

  it("throws only when no server answered", async () => {
    const { ctx } = ctxWith([{ match: /api\.biorxiv\.org/, status: 502 }]);
    await expect(fetchBiorxiv(ctx, "10.1101/2021.08.15.456425")).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("europepmc", () => {
  it("parses a core record", () => {
    const r = parseEpmcRecord(JSON.parse(fx("epmc-alphafold2.json")).resultList.result[0])!;
    expect(r).toMatchObject({
      source: "MED",
      pmid: "34265844",
      pmcid: "PMC8371605",
      doi: "10.1038/s41586-021-03819-2",
      journal: "Nature",
      isOpenAccess: true,
      license: "CC-BY",
      fullTextIds: ["PMC8371605"],
      url: "https://europepmc.org/article/MED/34265844",
    });
  });

  it("parses a preprint record", () => {
    const r = parseEpmcRecord(JSON.parse(fx("epmc-colabfold-preprint.json")).resultList.result[0])!;
    expect(r).toMatchObject({ source: "PPR", id: "PPR383435", journal: "bioRxiv", pmid: null, isOpenAccess: false });
  });

  it("builds the lookup query and maps errors", async () => {
    const a = ctxWith([{ match: /europepmc/, file: "epmc-plos-enrichment.json" }]);
    const r = await fetchEpmcRecord(a.ctx, "EXT_ID:35263338 AND SRC:MED", 5000);
    expect(r?.pmcid).toBe("PMC8936487");
    expect(a.calls[0]!.url).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID%3A35263338%20AND%20SRC%3AMED&resultType=core&format=json&pageSize=1",
    );
    const b = ctxWith([{ match: /europepmc/, error: timeoutError() }]);
    await expect(fetchEpmcRecord(b.ctx, "x", 20_000)).rejects.toMatchObject({ code: "timeout", message: "Europe PMC lookup: timed out after 20s" });
    const c = ctxWith([{ match: /europepmc/, body: '{"hitCount":0,"resultList":{"result":[]}}' }]);
    expect(await fetchEpmcRecord(c.ctx, "x")).toBeNull();
  });

  it("returns null when there is no full text and throws on 5xx", async () => {
    expect(await fetchEpmcFullText(ctxWith([{ match: /fullTextXML/, status: 404 }]).ctx, "PMC1")).toBeNull();
    await expect(fetchEpmcFullText(ctxWith([{ match: /fullTextXML/, status: 500 }]).ctx, "PMC1")).rejects.toMatchObject({ code: "upstream" });
    expect(await fetchEpmcFullText(ctxWith([{ match: /fullTextXML/, file: "pmc-plos.xml" }]).ctx, "PMC8936487")).toContain("<article");
  });

  it("searches", async () => {
    const { ctx, calls } = ctxWith([{ match: /europepmc/, file: "epmc-search.json" }]);
    const r = await fetchEpmcSearch(ctx, "protein structure", { limit: 5, sort: "CITED desc" });
    expect(r.total).toBeGreaterThan(1000);
    expect(r.results).toHaveLength(5);
    expect(calls[0]!.url).toContain("&pageSize=5&sort=CITED%20desc");
    await expect(fetchEpmcSearch(ctxWith([{ match: /europepmc/, body: "<html>" }]).ctx, "q", { limit: 1 })).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("ncbi", () => {
  it("parses the ID converter", () => {
    expect(parseIdConv(JSON.parse(fx("idconv-alphafold2.json")))).toEqual({ doi: "10.1038/s41586-021-03819-2", pmid: "34265844", pmcid: "PMC8371605" });
    expect(parseIdConv(JSON.parse(fx("idconv-plos.json")))).toEqual({ doi: "10.1371/journal.pcbi.1009935", pmid: "35263338", pmcid: "PMC8936487" });
    expect(parseIdConv(JSON.parse(fx("idconv-missing.json")))).toBeNull();
    expect(parseIdConv("nope")).toBeNull();
  });

  it("never throws from the ID converter", async () => {
    expect(await fetchIdConv(ctxWith([{ match: /idconv/, error: timeoutError() }]).ctx, "35263338")).toBeNull();
    const { ctx, calls } = ctxWith([{ match: /idconv/, file: "idconv-plos.json" }]);
    expect((await fetchIdConv(ctx, "35263338"))?.doi).toBe("10.1371/journal.pcbi.1009935");
    expect(calls[0]!.url).toBe("https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=35263338&format=json&tool=huygena-intake");
  });

  it("fetches PMC full text and rejects bodiless records", async () => {
    const { ctx, calls } = ctxWith([{ match: /efetch/, file: "pmc-alphafold2.xml" }]);
    expect(await fetchPmcFullText(ctx, "PMC8371605")).toContain("<body>");
    expect(calls[0]!.url).toContain("db=pmc&id=8371605&tool=huygena-intake");
    const bodiless = ctxWith([{ match: /efetch/, body: "<pmc-articleset><article><front/></article></pmc-articleset>" }]);
    expect(await fetchPmcFullText(bodiless.ctx, "PMC1")).toBeNull();
  });
});

describe("repo checks (any host)", () => {
  const GH = { host: "github" as const, id: "deepmind/alphafold", url: "https://github.com/deepmind/alphafold" };
  const refs: Route = { match: /\.git\/info\/refs\?service=git-upload-pack$/, body: gitRefs() };

  it("parses a git ref advertisement", () => {
    expect(parseRefs(gitRefs("master"))).toEqual({ head: "c77e5d2a8961d1a353632c462914ff0a32a950f6", defaultBranch: "master" });
    expect(parseRefs("<html>login</html>")).toBeNull();
  });

  it("checks reachability over git, then adds GitHub details and records a move", async () => {
    const { ctx, calls } = ctxWith([refs, { match: /api\.github\.com/, file: "github-alphafold.json" }]);
    expect(await checkRepo(ctx, GH)).toEqual({
      status: "ok",
      reason: "Repository moved: deepmind/alphafold now redirects to google-deepmind/alphafold",
      via: "git",
      fullName: "google-deepmind/alphafold",
      defaultBranch: "main",
      head: "c77e5d2a8961d1a353632c462914ff0a32a950f6",
      license: "Apache-2.0",
      stars: 14956,
      pushedAt: "2026-04-22T17:58:21Z",
      archived: false,
      fork: false,
      description: "Open source code for AlphaFold 2.",
      details: true,
      licenseChecked: true,
    });
    expect(calls[0]!.url).toBe("https://github.com/deepmind/alphafold.git/info/refs?service=git-upload-pack");
    expect(parseGithubRepo(JSON.parse(fx("github-surveyenrichment.json"))).fullName).toBe("markziemann/SurveyEnrichmentMethods");
  });

  it("maps a git 401/404 to not_found without calling any API", async () => {
    const { ctx, calls } = ctxWith([{ match: /\.git\/info\/refs/, status: 401, body: "Authentication required" }]);
    expect(await checkRepo(ctx, { host: "codeberg", id: "a/b", url: "https://codeberg.org/a/b" })).toMatchObject({ status: "not_found", via: "git" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the result when the API rate-limits, skips that API afterwards and never mentions tokens", async () => {
    const { ctx, calls } = ctxWith([
      refs,
      { match: /api\.github\.com/, status: 403, body: '{"message":"API rate limit exceeded for 1.2.3.4."}', headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1764093600" } },
    ]);
    const a = await checkRepo(ctx, GH);
    expect(a).toMatchObject({ status: "ok", via: "git", details: false, reason: null });
    const b = await checkRepo(ctx, { ...GH, id: "c/d", url: "https://github.com/c/d" });
    expect(b.status).toBe("ok");
    expect(calls.filter((c) => /api\.github/.test(c.url))).toHaveLength(1);
    expect(JSON.stringify([a, b])).not.toMatch(/token|rate|reset/i);
  });

  it("sends a GitHub token only to api.github.com and never records it", async () => {
    const { ctx, calls } = ctxWith([refs, { match: /api\.github\.com/, file: "github-surveyenrichment.json" }], { githubToken: "test-token" });
    await checkRepo(ctx, { host: "github", id: "markziemann/SurveyEnrichmentMethods", url: "https://github.com/markziemann/SurveyEnrichmentMethods" });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[1]!.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.stringify(ctx.sources)).not.toContain("test-token");
  });

  it("uses each host's public API for details", async () => {
    const { ctx, calls } = ctxWith([
      refs,
      { match: /codeberg\.org\/api\/v1\/repos\/a\/b$/, body: JSON.stringify({ full_name: "a/b", default_branch: "main", stars_count: 2, updated_at: "2025-01-01T00:00:00Z", archived: false, fork: false, description: "" }) },
      { match: /api\.bitbucket\.org\/2\.0\/repositories\/a\/b$/, body: JSON.stringify({ full_name: "a/b", mainbranch: { name: "trunk" }, updated_on: "2025-01-01T00:00:00Z" }) },
    ]);
    expect(await checkRepo(ctx, { host: "codeberg", id: "a/b", url: "https://codeberg.org/a/b" })).toMatchObject({ status: "ok", stars: 2, license: null, details: true, licenseChecked: true });
    expect(await checkRepo(ctx, { host: "bitbucket", id: "a/b", url: "https://bitbucket.org/a/b" })).toMatchObject({ status: "ok", defaultBranch: "main", details: true });
    expect(calls.map((c) => c.url)).toContain("https://bitbucket.org/a/b.git/info/refs?service=git-upload-pack");
    expect(calls.map((c) => c.url)).toContain("https://codeberg.org/a/b/raw/branch/main/COPYING");
    expect(spdx("apache-2.0")).toBe("Apache-2.0");
    expect(detectLicense("MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy")).toBe("MIT");
    expect(detectLicense("GNU GENERAL PUBLIC LICENSE\n   Version 3, 29 June 2007")).toBe("GPL-3.0");
    expect(detectLicense("Copyright me. All rights reserved.")).toBe("NOASSERTION");
    expect(spdx("gpl-3.0-only")).toBe("GPL-3.0");
  });

  it("checks archives with a plain GET", async () => {
    const { ctx } = ctxWith([{ match: /zenodo\.org\/records\/9$/, body: "<html></html>" }]);
    expect(await checkRepo(ctx, { host: "zenodo", id: "zenodo.9", url: "https://zenodo.org/records/9" })).toMatchObject({ status: "ok", via: "http", details: false });
    const gone = ctxWith([{ match: /zenodo/, status: 410 }]);
    expect(await checkRepo(gone.ctx, { host: "zenodo", id: "zenodo.9", url: "https://zenodo.org/records/9" })).toMatchObject({ status: "not_found" });
  });

  it("turns network errors into unchecked", async () => {
    const { ctx } = ctxWith([{ match: /\.git\/info\/refs/, error: new TypeError("fetch failed") }]);
    expect(await checkRepo(ctx, GH)).toMatchObject({ status: "unchecked", reason: "GitHub did not answer: network error: fetch failed" });
  });
});
