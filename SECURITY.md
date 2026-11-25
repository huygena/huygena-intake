# Security policy

## Reporting a vulnerability

Email **cto@huygena.xyz** with the details and, if you can, steps to reproduce. Please do not open a public issue for a security problem.

We aim to reply within three working days and to agree on a fix and disclosure date with you.

## Supported versions

Only the latest release gets security fixes. The project is at 0.1.x.

## Scope

huygena-intake reads public APIs (Crossref, arXiv, bioRxiv, Europe PMC, NCBI, GitHub) and parses their responses. Reports we care about most:

- Parsing input that makes the library hang, crash or use unbounded memory.
- A `GITHUB_TOKEN` or `HUYGENA_MAILTO` value leaking anywhere other than the service it is meant for (the token goes only to api.github.com; the email only to Crossref and NCBI).
- Anything in the CLI output or JSON brief that could run code when displayed.
