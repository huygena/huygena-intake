#!/usr/bin/env node
// Live smoke test against the real APIs. Not part of `pnpm test`.
// Usage: pnpm build && pnpm smoke        (no token needed)
import { formatBrief, intake, search } from "../dist/index.js";

const PAPERS = [
  { label: "AlphaFold 2 (Nature DOI)", input: "10.1038/s41586-021-03819-2", expect: { level: "ready", repo: "deepmind/alphafold" } },
  { label: "LoRA (arXiv, code in abstract)", input: "arXiv:2106.09685", expect: { level: "partial", repo: "microsoft/LoRA" } },
  { label: "Attention Is All You Need (arXiv, no code link)", input: "https://arxiv.org/abs/1706.03762", expect: { level: "not_ready" } },
  { label: "ColabFold (bioRxiv preprint)", input: "https://www.biorxiv.org/content/10.1101/2021.08.15.456425v3", expect: { repo: "sokrypton/ColabFold" } },
  { label: "Enrichment standards (PLOS Comp Biol, PMC OA, data statement)", input: "PMC8936487", expect: { level: "ready", repo: "markziemann/SurveyEnrichmentMethods" } },
];

const verbose = process.argv.includes("--verbose");
let failed = 0;

for (const p of PAPERS) {
  const t0 = Date.now();
  try {
    const b = await intake(p.input);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const primary = b.code.filter((c) => c.role === "primary");
    const problems = [];
    if (p.expect.level && b.readiness.level !== p.expect.level) problems.push(`level ${b.readiness.level}, expected ${p.expect.level}`);
    if (p.expect.repo && !primary.some((c) => c.id?.toLowerCase() === p.expect.repo.toLowerCase())) problems.push(`primary repo ${p.expect.repo} not found`);
    const gh = primary.find((c) => c.repo)?.repo;
    console.log(`${problems.length ? "FAIL" : "ok  "}  ${p.label}  [${secs}s]`);
    console.log(`      ${b.paper.title}`);
    console.log(`      readiness ${b.readiness.level.toUpperCase()} · ${b.readiness.summary}`);
    console.log(
      `      code: ${primary.map((c) => c.id ?? c.url).join(", ") || "none"}${gh ? ` (repo ${gh.status}${gh.license ? `, ${gh.license}` : ""})` : ""} · tools mentioned ${b.code.length - primary.length} · data ${b.data.length}`,
    );
    console.log(`      statements: code ${b.statements.code ? "yes" : "no"}, data ${b.statements.data ? "yes" : "no"} · full text ${b.access.fullText ? b.access.fullText.id : "none"}`);
    for (const w of b.warnings) console.log(`      note: ${w}`);
    for (const pr of problems) console.log(`      problem: ${pr}`);
    if (verbose) console.log(`\n${formatBrief(b)}\n`);
    if (problems.length) failed++;
  } catch (e) {
    failed++;
    console.log(`FAIL  ${p.label}  [${((Date.now() - t0) / 1000).toFixed(1)}s]\n      ${e?.code ?? "error"}: ${e?.message ?? e}`);
  }
}

{
  const t0 = Date.now();
  try {
    const r = await search("ColabFold protein structure", { limit: 3 });
    console.log(`ok    search "ColabFold protein structure"  [${((Date.now() - t0) / 1000).toFixed(1)}s]  ${r.total} results`);
    for (const h of r.hits) console.log(`      ${h.rank}. ${h.title} (${h.year ?? "n.d."})`);
    if (!r.hits.length) failed++;
  } catch (e) {
    failed++;
    console.log(`FAIL  search  ${e?.code ?? "error"}: ${e?.message ?? e}`);
  }
}

console.log(failed ? `\n${failed} smoke check(s) failed` : "\nAll smoke checks passed");
process.exitCode = failed ? 1 : 0;
