# huygena-intake

**Give it a paper ID. Get back what a replication run needs: the code, the data, the license and a readiness verdict with reasons.**

huygena-intake reads a DOI, arXiv ID, bioRxiv or medRxiv DOI, PubMed ID or PMCID. It asks Crossref, arXiv, bioRxiv, Europe PMC, NCBI PMC and GitHub, reads the open full text when there is one, and returns a replication brief. The brief is plain JSON with a Zod schema. It works as a library and as a CLI. No API keys needed.

It is the first step of [Huygena](https://docs.huygena.xyz): before anyone re-runs a paper, someone has to find out whether it can be re-run at all.

```console
$ huygena-intake 10.1038/s41586-021-03819-2
Highly accurate protein structure prediction with AlphaFold
John Jumper, Richard Evans, Alexander Pritzel +31 more · Nature · 2021
doi:10.1038/s41586-021-03819-2  PMID 34265844  PMC8371605
Open access: yes, CC-BY-4.0 (Europe PMC) · full text read from PMC (NCBI) PMC8371605

Readiness  READY  All 5 core checks pass
  pass  code_found              The paper links its own code: github.com/deepmind/alphafold
  pass  code_reachable          github.com/google-deepmind/alphafold is live on GitHub (default
                                branch main, last push 2026-04-22)
  pass  code_license            Apache-2.0 (detected by GitHub in google-deepmind/alphafold)
  pass  data_found              16 links to datasets or database records
  pass  open_access             Free to read (CC-BY-4.0); source: Europe PMC
  warn  code_snapshot           Code lives only in a git repository that can change after
                                publication; a run must pin a commit (advisory)
  pass  availability_statement  Found: code availability and data availability (advisory)

Code  1 from the paper, 21 tools mentioned
  github.com/deepmind/alphafold
      live · Apache-2.0 · 14,956 stars · branch main · last push 2026-04-22
      Repository moved: deepmind/alphafold now redirects to google-deepmind/alphafold
      found in: code statement, full text
  mentioned: tensorflow/tensorflow, deepmind/sonnet, google/jax, deepmind/dm-haiku,
  soedinglab/hh-suite, eddylab.org/software/hmmer/, openmm/openmm, soedinglab/MMseqs2 (+13 more)

Data  16 links and accessions
  other  www.wwpdb.org/ftp/pdb-ftp-sites
         ftp.wwpdb.org/pub/pdb/derived_data/
         cdn.rcsb.org/resources/sequence/clusters/bc-40.out
         wwwuser.gwdg.de/~compbiol/data/hhsuite/databases/hhsuite_dbs/
         +4 more (--all)
  PDB    6Y4F 6YJ1 6VR4 6SK0 6FES 6W6W 6T1Z 7JTL

  (code and data availability statements trimmed here)

Sources: ncbi 200 0.3s · crossref 200 1.2s · europepmc 200 0.7s · ncbi 200 0.9s · github 200 0.7s
```

That is a real run from 2026-11-25. Look at what it got right. The code availability statement of the AlphaFold 2 paper links 17 GitHub repositories. One is the paper's code. The rest are tools it used: TensorFlow, JAX, HH-suite and so on. huygena-intake keeps them apart, checks only the paper's own repository, and notices that `deepmind/alphafold` has moved to `google-deepmind/alphafold`.

## What you get

- **Paper metadata.** Title, authors, year, venue, abstract, DOI, PMID, PMCID, arXiv ID, preprint version and the journal DOI when a preprint was published.
- **Access.** Open-access status, where that answer came from, the license (normalized to `CC-BY-4.0` and friends) and whether full text was read.
- **Code links.** GitHub, GitLab, Bitbucket, Codeberg, Zenodo, Figshare, OSF, Software Heritage, Code Ocean and Hugging Face. Each link is marked `primary` (the paper's own code) or `mentioned` (a tool the paper used), with the sentence it came from and where it was found.
- **GitHub check.** For the paper's own repositories: exists or 404, moved, default branch, license, stars, last push, archived. Works without a token.
- **Data links and accessions.** Zenodo, Figshare, Dryad, OSF, Dataverse, Mendeley Data, Kaggle, Hugging Face datasets, GEO, SRA and BioProject, ENA, ArrayExpress, PDB, UniProt and EMDB.
- **Availability statements.** The raw "Code availability" and "Data availability" text from the full text, untouched.
- **Readiness.** Seven checks with a status and a one-line reason each, and an overall `ready`, `partial` or `not_ready`. The rules are below. There is no score.
- **Provenance.** Every request it made, with status and timing, and a plain-English note for anything that went wrong.

## Install

```sh
npm i github:huygena/huygena-intake
# or
pnpm add github:huygena/huygena-intake
```

The package builds itself on install. An npm release is coming.

Node 20 or newer. The library itself uses only `fetch`, so it also runs on Cloudflare Workers, Deno and Bun. Only the CLI uses Node APIs.

## CLI

```sh
huygena-intake <id-or-url> [options]
huygena-intake search <query> [--limit n] [--sort relevance|cited|date] [--json]
```

It accepts IDs in the forms people paste:

| Kind | Examples |
|---|---|
| DOI | `10.1038/s41586-021-03819-2`, `doi:…`, `https://doi.org/…`, publisher URLs that contain a DOI, `nature.com/articles/…` |
| arXiv | `1706.03762`, `arXiv:1706.03762v5`, `https://arxiv.org/abs/…`, `/pdf/…`, `hep-th/9901001`, `10.48550/arXiv.…` |
| bioRxiv / medRxiv | `10.1101/2021.08.15.456425`, `https://www.biorxiv.org/content/10.1101/…v3.full.pdf` |
| PubMed / PMC | `PMID:34265844`, `34265844`, `PMC8371605`, pubmed, pmc and europepmc.org URLs |

| Option | Meaning |
|---|---|
| `--json` | Print the brief (or search result) as JSON |
| `--all` | Show every link and the full statements |
| `--no-full-text` | Do not read PMC or Europe PMC full text |
| `--no-repo-check` | Do not contact code hosts (`--no-github` still works) |
| `--require ready\|partial` | Exit 4 unless readiness is at least this level. Handy in scripts and CI |
| `--timeout <sec>` | Per-request timeout. Default 30, search 60 |
| `--limit <n>` | search: results to return, 1 to 100. Default 10 |
| `--sort <order>` | search: `relevance` (default), `cited` or `date` |

| Variable | Meaning |
|---|---|
| `GITHUB_TOKEN` | Optional, never needed. Only used for GitHub repository extras (stars, last push). Sent only to api.github.com |
| `HUYGENA_MAILTO` | Contact email for Crossref's polite pool and NCBI. Sent only to those two. Never required |
| `NO_COLOR` | Turn off color. Output always prints `pass`, `warn` and `fail` as words, so it reads fine in monochrome |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Brief or search printed |
| 1 | Lookup failed: network error, upstream error or timeout |
| 2 | Usage error or an ID it does not recognize |
| 3 | The paper was not found |
| 4 | Readiness below `--require` |

Search uses Europe PMC, which covers PubMed, PMC, bioRxiv, medRxiv, arXiv and more. Field queries work:

```sh
huygena-intake search 'TITLE:"protein structure" AND OPEN_ACCESS:y' --sort cited --limit 5
```

## Library

```ts
import { intake, search, parseId, findLinks, assessReadiness, BriefSchema } from "huygena-intake";

const brief = await intake("arXiv:2106.09685");
brief.readiness.level;                        // "partial"
brief.code.filter((c) => c.role === "primary"); // [{ url: "https://github.com/microsoft/LoRA", github: { status: "ok", license: "MIT", … }, … }]

parseId("https://www.biorxiv.org/content/10.1101/2021.08.15.456425v2.full.pdf");
// { kind: "biorxiv", value: "10.1101/2021.08.15.456425", canonical: "doi:10.1101/2021.08.15.456425", version: 2, server: "biorxiv" }

findLinks("Our code is archived at https://doi.org/10.5281/zenodo.5763096 and reads are in GEO (GSE12345).");
// { code: [{ host: "zenodo", id: "zenodo.5763096", role: "primary", … }], data: [{ repository: "geo", id: "GSE12345", kind: "accession", … }] }

const hits = await search("ColabFold", { limit: 5, sort: "cited" });
```

| Export | Signature |
|---|---|
| `intake` | `(input: string, opts?: IntakeOptions) => Promise<Brief>` |
| `search` | `(query: string, opts?: SearchOptions) => Promise<SearchResult>` |
| `parseId` | `(input: string) => ParsedId \| null` |
| `findLinks` | `(text: string, opts?: { statement?: "code" \| "data"; defaultRole?: "primary" \| "mentioned" }) => FoundLinks`. Pure |
| `assessReadiness` | `(brief: Pick<Brief, "code" \| "data" \| "access" \| "statements">) => Readiness`. Pure |
| `parseJats`, `jatsToText` | JATS XML to statements, body text, license |
| `normalizeLicense` | License URL or label to `CC-BY-4.0`, `CC0-1.0`, `none` or `null` |
| `formatBrief`, `formatSearch` | The CLI's text output |
| `BriefSchema`, `SearchResultSchema`, … | Zod schemas for every type |
| `IntakeError` | Thrown with `code`: `invalid_id`, `invalid_query`, `not_found`, `upstream` or `timeout` |

`IntakeOptions`: `fetch` (bring your own, for tests, proxies or edge runtimes), `timeoutMs` (default 30000), `signal`, `userAgent`, `mailto`, `githubToken` (optional), `fullText` (default true), `checkRepos` (default true; `checkGithub` is a deprecated alias), `maxRepoChecks` (default 5).

`intake` throws only when it cannot identify the paper at all. A slow Europe PMC, a code host that does not answer or a missing full text become entries in `brief.warnings` and the brief still comes back.

### The brief

```ts
interface Brief {
  schema: "huygena.brief/v1";
  tool: { name: "huygena-intake"; version: string };
  generatedAt: string;          // ISO 8601
  input: string;                // what you passed in
  id: ParsedId;                 // kind, value, canonical, version?, server?
  paper: Paper;                 // title, authors, year, published, venue, publisher, type, abstract, doi, arxivId, pmid, pmcid, version, publishedDoi, links
  access: Access;               // openAccess, basis, license, licenseUrl, fullText
  code: CodeLink[];             // url, host, id, ref, role, context, foundIn, github
  data: DataLink[];             // url, repository, id, kind, context, foundIn
  statements: { code: string | null; data: string | null };
  readiness: Readiness;         // level, summary, checks[]
  sources: SourceCall[];        // name, url, ok, status, ms, error
  warnings: string[];
}
```

## Readiness rules

Seven checks. Five are core and set the level. Two are advisory and never change it.

| Check | Core | pass | warn | fail | skip |
|---|---|---|---|---|---|
| `code_found` | yes | The paper links its own code | Only tools the paper used are linked | No code link anywhere | |
| `code_reachable` | yes | A primary code link answers: git hosts over the git protocol, archives by URL | Not verified: the host did not answer, or `--no-repo-check` | Every primary link is private, deleted or mistyped (401/403/404) | No primary code link |
| `code_license` | yes | A license was identified (host detection or the repo's LICENSE/COPYING file) | No license file, an unidentified license, or not checked | | No primary code link |
| `data_found` | yes | At least one dataset link or accession | None found. The reason says whether the statement says "on request" or names nothing | | |
| `open_access` | yes | Free to read | Closed, or status unknown | | |
| `code_snapshot` | no | An archived copy (Zenodo, Software Heritage, Code Ocean, Figshare, OSF) or a link pinned to a commit | Code only in a git repo that can change | | No code link |
| `availability_statement` | no | A code or data availability statement was found | Full text was read and has neither | | No open full text |

**Level**

- `not_ready`: any core check fails.
- `ready`: every core check passes.
- `partial`: everything else.

Why `data_found` only warns: many papers use public benchmarks they name without a link. Missing data links are worth a look, not a verdict.

**How `primary` and `mentioned` are decided**

- A link counts as the paper's own code when its sentence says so. "Our code", "source code for this study", "we release", "is available at" in the abstract or an availability statement.
- A link right after a tool name and version, like "TensorFlow v.1 (url)", is a tool.
- In the body text only strong cues count, because methods sections cite many tools. Unknown hosts always need a strong cue.
- Zenodo, Figshare and OSF can hold code or data. The nearest "code" or "data" word in the sentence decides. Without one, the statement it came from decides, then data.

## Sources

| Source | Used for | Key |
|---|---|---|
| [Crossref](https://api.crossref.org) | DOI metadata, license, relations, links | none |
| [arXiv export API](https://info.arxiv.org/help/api/) | arXiv metadata, abstract, author comment | none |
| [bioRxiv / medRxiv API](https://api.biorxiv.org) | preprint metadata, versions, license, journal DOI | none |
| [Europe PMC](https://europepmc.org/RestfulWebService) | open-access flag, license, search, full text fallback | none |
| [NCBI PMC](https://www.ncbi.nlm.nih.gov/pmc/tools/developers/) | ID converter, full text JATS through E-utilities | none |
| Code hosts over git (GitHub, GitLab incl. self-hosted, Codeberg, Bitbucket) | reachability, default branch, head commit (`<repo>.git/info/refs`), license file (raw URL) | none |
| Host APIs (GitHub, GitLab, Codeberg, Bitbucket) | optional extras: stars, last push, archived, moved | none (`GITHUB_TOKEN` optional) |

Every request sends `User-Agent: huygena-intake/0.8.0 (+https://github.com/huygena/huygena-intake)`. NCBI also gets `tool=huygena-intake`. Full text comes from NCBI first because it is much faster than Europe PMC from most places. Europe PMC is asked in parallel and its wait is capped, so a slow day there costs a few seconds, not the brief.

## How it fits Huygena

Huygena is a market for replicating papers: agents re-run computational papers on GPU TEEs, a second node confirms the result, and the outcome goes on-chain as a certificate. huygena-intake is the front door. It decides whether a paper is worth sending to a node, and it hands the node a brief with the exact repo, license and data it needs.

- Try paper lookup in the app: https://dapp.huygena.xyz/papers
- Read the design: https://docs.huygena.xyz

## Status

What works today:

- Everything on this page. Briefs for DOIs, arXiv, bioRxiv, medRxiv, PubMed and PMC, the readiness rules, search, the CLI and the library.
- 147 unit tests run offline against recorded API responses. `pnpm smoke` runs five real papers and a search against the live APIs.

What is not live yet:

- Huygena bounties, replication nodes and contracts. This package does not touch any chain and does not need a wallet.

Known limits:

- arXiv full text is not parsed. For arXiv papers, links come from the abstract and the author comment.
- bioRxiv full text XML is behind a bot check, so preprints get no availability statements unless Europe PMC has the full text. When a preprint has a journal version, the brief says so and you can run intake on that DOI.
- Code checks are the same for every host and need no account or token: reachability over the git protocol, the license from the repository's own LICENSE/COPYING file. Host APIs only add extras (stars, last push); if one is down or rate-limited the result does not change. Archives (Zenodo, Software Heritage, Code Ocean, Figshare, OSF) are checked by URL.
- The `primary` / `mentioned` split is a rule set, not a model. It is right on the papers we test against and it will be wrong on some papers. Every link carries its sentence, so you can check.
- Europe PMC can be slow. A brief takes 1 to 5 seconds when it answers quickly. On a slow day the brief waits up to 12 seconds for it (20 for papers not in PMC), then goes on without it and says so.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test        # offline
pnpm build
pnpm smoke       # live APIs, no token needed
```

## License

Apache-2.0. Copyright 2026 Huygena.
