import { describe, expect, it } from "vitest";
import { BriefSchema, IntakeError, intake, type Brief } from "../src/index.js";
import { fakeFetch, timeoutError, type Route } from "./helpers.js";

const repoJson = (full: string, license: string | null) =>
  JSON.stringify({ full_name: full, default_branch: "main", license: license ? { spdx_id: license } : null, stargazers_count: 7, pushed_at: "2024-05-06T00:00:00Z", archived: false, fork: false, description: null });

const AF2: Route[] = [
  { match: /api\.crossref\.org\/works\/10\.1038/, file: "crossref-alphafold2.json" },
  { match: /idconv/, file: "idconv-alphafold2.json" },
  { match: /efetch\.fcgi\?db=pmc&id=8371605/, file: "pmc-alphafold2.xml" },
  { match: /europepmc\/webservices\/rest\/search/, file: "epmc-alphafold2.json" },
  { match: /api\.github\.com\/repos\/deepmind\/alphafold$/, file: "github-alphafold.json" },
];

async function run(input: string, routes: Route[], opts: Parameters<typeof intake>[1] = {}) {
  const f = fakeFetch(routes);
  const brief = await intake(input, { fetch: f.fetch, githubToken: "", mailto: "", ...opts });
  // Every brief must match the published schema.
  expect(BriefSchema.parse(brief)).toEqual(brief);
  return { brief, ...f };
}

const ids = (b: Brief) => b.code.map((c) => `${c.role}:${c.id ?? c.url}`);

describe("intake (recorded responses)", () => {
  it("builds a ready brief for AlphaFold 2 from a DOI", async () => {
    const { brief, unrouted } = await run("https://doi.org/10.1038/s41586-021-03819-2", AF2);
    expect(unrouted).toEqual([]);
    expect(brief).toMatchObject({
      schema: "huygena.brief/v1",
      tool: { name: "huygena-intake", version: "0.7.0" },
      input: "https://doi.org/10.1038/s41586-021-03819-2",
      id: { kind: "doi", value: "10.1038/s41586-021-03819-2" },
      paper: { title: "Highly accurate protein structure prediction with AlphaFold", year: 2021, venue: "Nature", pmid: "34265844", pmcid: "PMC8371605" },
      access: { openAccess: true, license: "CC-BY-4.0", fullText: { source: "ncbi_pmc", id: "PMC8371605" } },
      readiness: { level: "ready", summary: "All 5 core checks pass" },
    });
    const primary = brief.code.filter((c) => c.role === "primary");
    expect(primary.map((c) => c.id)).toEqual(["deepmind/alphafold"]);
    expect(primary[0]!.github).toMatchObject({ status: "ok", fullName: "google-deepmind/alphafold", license: "Apache-2.0" });
    expect(primary[0]!.foundIn).toContain("code_statement");
    // Tools the paper used are listed but not promoted or checked.
    const tf = brief.code.find((c) => c.id === "tensorflow/tensorflow")!;
    expect(tf).toMatchObject({ role: "mentioned", github: { status: "unchecked" } });
    expect(brief.data.filter((d) => d.repository === "pdb").map((d) => d.id)).toEqual(expect.arrayContaining(["6Y4F", "7JTL"]));
    expect(brief.statements.code).toMatch(/^Source code for the AlphaFold model/);
    expect(brief.statements.data).toMatch(/^All input data are freely available/);
    expect(brief.sources.map((s) => s.name).sort()).toEqual(["crossref", "europepmc", "github", "ncbi", "ncbi"]);
    expect(brief.warnings).toEqual([]);
  });

  it("finds the same paper from a PMID through the ID converter", async () => {
    const { brief, calls } = await run("PMID:34265844", AF2);
    expect(brief.paper.doi).toBe("10.1038/s41586-021-03819-2");
    expect(brief.readiness.level).toBe("ready");
    expect(calls[0]!.url).toContain("idconv/api/v1/articles/?ids=34265844");
  });

  it("still answers when Europe PMC times out", async () => {
    const routes = AF2.map((r) => (/europepmc/.test(r.match.source) ? { match: r.match, error: timeoutError() } : r));
    const { brief } = await run("10.1038/s41586-021-03819-2", routes);
    expect(brief.readiness.level).toBe("ready");
    expect(brief.warnings).toEqual(["Europe PMC lookup: timed out after 12s; open-access flag and license from Europe PMC are missing"]);
  });

  it("marks repos unchecked when GitHub rate-limits and stays partial", async () => {
    const routes: Route[] = [
      ...AF2.filter((r) => !/github/.test(r.match.source)),
      { match: /api\.github\.com/, status: 403, body: '{"message":"API rate limit exceeded"}', headers: { "x-ratelimit-remaining": "0" } },
    ];
    const { brief } = await run("10.1038/s41586-021-03819-2", routes);
    expect(brief.code[0]!.github?.status).toBe("unchecked");
    expect(brief.readiness.level).toBe("partial");
    expect(brief.readiness.checks.find((c) => c.id === "code_reachable")!.reason).toMatch(/rate limit/);
  });

  it("fails code_reachable on a GitHub 404", async () => {
    const routes: Route[] = [...AF2.filter((r) => !/github/.test(r.match.source)), { match: /api\.github\.com/, status: 404, file: "github-404.json" }];
    const { brief } = await run("10.1038/s41586-021-03819-2", routes);
    expect(brief.readiness.level).toBe("not_ready");
  });

  it("skips network work that options turn off", async () => {
    const { brief, calls } = await run("10.1038/s41586-021-03819-2", AF2, { fullText: false, checkGithub: false });
    expect(calls.some((c) => /efetch|github/.test(c.url))).toBe(false);
    expect(brief.access.fullText).toBeNull();
    expect(brief.statements).toEqual({ code: null, data: null });
    // AlphaFold 2 names its code only in the full text.
    expect(brief.code).toEqual([]);
    const lora = await run("2106.09685", [{ match: /export\.arxiv\.org/, file: "arxiv-lora.xml" }], { checkGithub: false });
    expect(lora.brief.code[0]!.github).toMatchObject({ status: "unchecked", reason: "GitHub checks turned off" });
    expect(lora.calls.some((c) => /github/.test(c.url))).toBe(false);
  });

  it("reads the data statement of a PLOS paper from a PMCID", async () => {
    const { brief, unrouted } = await run("PMC8936487", [
      { match: /idconv/, file: "idconv-plos.json" },
      { match: /api\.crossref\.org/, file: "crossref-plos-enrichment.json" },
      { match: /efetch/, file: "pmc-plos.xml" },
      { match: /europepmc/, file: "epmc-plos-enrichment.json" },
      { match: /api\.github\.com\/repos\/markziemann\/SurveyEnrichmentMethods$/, file: "github-surveyenrichment.json" },
    ]);
    expect(unrouted).toEqual([]);
    expect(ids(brief)).toEqual(["primary:markziemann/SurveyEnrichmentMethods", "primary:zenodo.5763096"]);
    expect(brief.data.filter((d) => d.repository === "sra").length).toBe(7);
    expect(brief.readiness.level).toBe("ready");
    expect(brief.readiness.checks.find((c) => c.id === "code_snapshot")).toMatchObject({ status: "pass" });
  });

  it("builds an arXiv brief from the abstract", async () => {
    const { brief, unrouted } = await run("https://arxiv.org/abs/2106.09685", [
      { match: /export\.arxiv\.org/, file: "arxiv-lora.xml" },
      { match: /api\.github\.com\/repos\/microsoft\/LoRA$/, body: repoJson("microsoft/LoRA", "MIT") },
    ]);
    expect(unrouted).toEqual([]);
    expect(brief.paper).toMatchObject({ arxivId: "2106.09685", version: 2, title: "LoRA: Low-Rank Adaptation of Large Language Models" });
    expect(brief.access).toMatchObject({ openAccess: true, basis: "arXiv preprint server" });
    expect(ids(brief)).toEqual(["primary:microsoft/LoRA"]);
    expect(brief.code[0]!.foundIn).toEqual(["abstract"]);
    expect(brief.readiness.level).toBe("partial");
  });

  it("is not_ready for an arXiv paper with no code link", async () => {
    const { brief } = await run("1706.03762", [{ match: /export\.arxiv\.org/, file: "arxiv-attention.xml" }]);
    expect(brief.code).toEqual([]);
    expect(brief.readiness.level).toBe("not_ready");
  });

  it("builds a bioRxiv brief and points at the journal version", async () => {
    const { brief } = await run("https://www.biorxiv.org/content/10.1101/2021.08.15.456425v3", [
      { match: /api\.biorxiv\.org\/details\/biorxiv/, file: "biorxiv-colabfold.json" },
      { match: /europepmc/, file: "epmc-colabfold-preprint.json" },
      { match: /api\.github\.com\/repos\/sokrypton\/ColabFold$/, body: repoJson("sokrypton/ColabFold", "MIT") },
    ]);
    expect(brief.paper).toMatchObject({ version: 3, publishedDoi: "10.1038/s41592-022-01488-1", venue: "bioRxiv · bioinformatics" });
    expect(brief.access).toMatchObject({ openAccess: true, license: "CC-BY-NC-ND" });
    expect(ids(brief)[0]).toBe("primary:sokrypton/ColabFold");
    expect(brief.warnings.join(" ")).toContain("10.1038/s41592-022-01488-1");
  });

  it("throws typed errors", async () => {
    await expect(intake("hello", { fetch: fakeFetch([]).fetch })).rejects.toMatchObject({ code: "invalid_id" });
    await expect(intake("1706.03762", { fetch: fakeFetch([{ match: /arxiv/, file: "arxiv-missing.xml" }]).fetch })).rejects.toMatchObject({
      code: "not_found",
    });
    const err = await intake("10.9999/nothing", {
      fetch: fakeFetch([
        { match: /crossref/, status: 404 },
        { match: /europepmc/, body: '{"hitCount":0,"resultList":{"result":[]}}' },
      ]).fetch,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IntakeError);
    expect(err.code).toBe("not_found");
    const up = await intake("10.1038/s41586-021-03819-2", {
      fetch: fakeFetch([
        { match: /crossref/, status: 500 },
        { match: /europepmc/, status: 500 },
      ]).fetch,
    }).catch((e) => e);
    expect(up.code).toBe("upstream");
  });
});
