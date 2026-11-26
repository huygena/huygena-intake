# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## v0.8.0 · 2026-11-26

Code checks no longer depend on GitHub or on any token.

### Changed

- **Breaking:** `code[].github` is now `code[].repo` (`RepoCheck`), filled for every primary code link on any host. New fields: `via` (`git` or `http`), `head` (commit at the tip of the default branch), `details` and `licenseChecked`. `GithubCheck` is gone.
- Reachability is checked over the git protocol (`<repo>.git/info/refs`), the same request `git clone` makes, for GitHub, GitLab (including self-hosted), Codeberg and Bitbucket. Archives such as Zenodo or Software Heritage are checked by URL. No API, no account, no rate limit.
- The license comes from the host's license detection when its API answers, otherwise from the repository's own `LICENSE`/`COPYING` file.
- Host APIs only add extras (stars, last push, archived, moved). When one is down or rate-limited, the readiness result stays the same.
- Readiness and warnings no longer print token hints or rate-limit reset times.
- `checkGithub` and `--no-github` become `checkRepos` and `--no-repo-check`; the old names still work.

## v0.7.0 · 2026-11-26

Same API and brief format (`huygena.brief/v1`) as 0.1.0. This version is the one the Huygena app runs in production at dapp.huygena.xyz.

### Fixed

- Runs on Cloudflare Workers: the global `fetch` is bound before use, so calls no longer fail with "Illegal invocation" on edge runtimes.

### Changed

- README links point to huygena.xyz and to paper lookup at dapp.huygena.xyz/papers.
- Tagged releases are built, tested and published by `.github/workflows/release.yml`, with the packed tarball attached.

## v0.1.0 · 2026-11-25

First release.

### Added

- `intake(input)` turns a DOI, arXiv ID, bioRxiv or medRxiv DOI, PMID or PMCID (or any URL that carries one) into a replication brief (`huygena.brief/v1`).
- Paper metadata from Crossref, the arXiv export API, the bioRxiv API and Europe PMC.
- Full text from PMC through NCBI E-utilities, with Europe PMC as fallback. Code and data availability statements are pulled out of the JATS XML.
- Code link extraction for GitHub, GitLab, Bitbucket, Codeberg, Zenodo, Figshare, OSF, Software Heritage, Code Ocean and Hugging Face. Each link is marked `primary` (the paper's own code) or `mentioned` (a tool the paper used).
- Data link and accession extraction for Zenodo, Figshare, Dryad, OSF, Dataverse, Mendeley Data, Kaggle, Hugging Face datasets, GEO, SRA, ENA, ArrayExpress, PDB, UniProt and EMDB.
- GitHub REST check for the paper's own repositories: exists, moved, default branch, license, stars, last push, archived. Works without a token. A rate limit marks repos `unchecked` and never fails the brief.
- Rule-based readiness: five core checks, two advisory checks, and a `ready`, `partial` or `not_ready` level.
- `search(query)` over Europe PMC.
- `parseId`, `findLinks`, `assessReadiness`, `parseJats`, `normalizeLicense`, Zod schemas and TypeScript types.
- CLI `huygena-intake` with pretty and `--json` output, `search`, `--require` and documented exit codes.
