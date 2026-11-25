import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatBrief, formatSearch, intake, search, SearchResultSchema } from "../src/index.js";
import { fakeFetch, type Route } from "./helpers.js";

describe("search", () => {
  it("maps Europe PMC hits", async () => {
    const f = fakeFetch([{ match: /europepmc/, file: "epmc-search.json" }]);
    const r = await search("  protein structure prediction deep learning ", { fetch: f.fetch, limit: 5, sort: "cited" });
    expect(SearchResultSchema.parse(r)).toEqual(r);
    expect(r.query).toBe("protein structure prediction deep learning");
    expect(r.sort).toBe("cited");
    expect(r.hits).toHaveLength(5);
    expect(r.hits[0]).toMatchObject({ rank: 1 });
    expect(r.hits.every((h) => h.url.startsWith("https://europepmc.org/article/"))).toBe(true);
    expect(f.calls[0]!.url).toContain("sort=CITED%20desc");
    expect(r.source.name).toBe("europepmc");
  });

  it("rejects bad queries before any request", async () => {
    const f = fakeFetch([]);
    await expect(search("x", { fetch: f.fetch })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(search("a".repeat(1001), { fetch: f.fetch })).rejects.toMatchObject({ code: "invalid_query" });
    expect(f.calls).toHaveLength(0);
  });

  it("clamps the limit", async () => {
    const f = fakeFetch([{ match: /europepmc/, file: "epmc-search.json" }]);
    await search("protein", { fetch: f.fetch, limit: 500 });
    expect(f.calls[0]!.url).toContain("pageSize=100");
  });
});

const AF2: Route[] = [
  { match: /api\.crossref\.org/, file: "crossref-alphafold2.json" },
  { match: /idconv/, file: "idconv-alphafold2.json" },
  { match: /efetch/, file: "pmc-alphafold2.xml" },
  { match: /europepmc/, file: "epmc-alphafold2.json" },
  { match: /api\.github\.com/, file: "github-alphafold.json" },
];

describe("formatBrief", () => {
  it("prints plain text that reads without color", async () => {
    const brief = await intake("10.1038/s41586-021-03819-2", { fetch: fakeFetch(AF2).fetch, githubToken: "" });
    const out = formatBrief(brief, { width: 100 });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out.split("\n")[0]).toBe("Highly accurate protein structure prediction with AlphaFold");
    expect(out).toContain("Readiness  READY  All 5 core checks pass");
    expect(out).toMatch(/^ {2}pass {2}code_found {14}The paper links its own code: github\.com\/deepmind\/alphafold$/m);
    expect(out).toMatch(/live · Apache-2\.0 · 14,956 stars · branch main/);
    expect(out).toMatch(/Code availability\n {2}Source code for the AlphaFold model/);
    expect(out.split("\n").every((l) => l.length <= 100)).toBe(true);
    expect(formatBrief(brief, { color: true })).toMatch(/\x1b\[32m/);
  });
});

describe("formatSearch", () => {
  it("numbers hits and shows IDs", async () => {
    const r = await search("protein", { fetch: fakeFetch([{ match: /europepmc/, file: "epmc-search.json" }]).fetch, limit: 5 });
    const out = formatSearch(r, { width: 100 });
    expect(out).toMatch(/^Europe PMC {2}[\d,]+ results for "protein" · sorted by relevance · \d+\.\ds/);
    expect(out).toMatch(/^1\. /m);
    expect(out).toMatch(/^5\. /m);
  });
});

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
describe.skipIf(!existsSync(cli))("cli (built)", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

  it("prints help and version", () => {
    const h = run("--help");
    expect(h.status).toBe(0);
    expect(h.stdout).toContain("Exit codes");
    expect(run("-v").stdout.trim()).toBe("0.1.0");
  });

  it("exits 2 on usage errors without touching the network", () => {
    expect(run().status).toBe(2);
    expect(run("not an id").status).toBe(2);
    expect(run("--limit", "0", "search", "x").status).toBe(2);
    expect(run("--require", "maybe", "1706.03762").status).toBe(2);
    expect(run("--bogus").status).toBe(2);
    expect(run("search", "x").status).toBe(2);
  });
});
