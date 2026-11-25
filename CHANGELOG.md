# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## 0.1.0 · 2026-11-25

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
