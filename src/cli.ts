import { intake } from "./intake.js";
import { search } from "./search.js";
import { IntakeError } from "./errors.js";
import type { ReadinessLevel, SearchSort } from "./schema.js";
import { formatBrief, formatSearch } from "./format.js";
import { VERSION } from "./version.js";

const EXIT = { ok: 0, failed: 1, usage: 2, notFound: 3, notReady: 4 } as const;

const HELP = `huygena-intake ${VERSION}
Turn a paper ID into a replication brief, or search the literature.

Usage
  huygena-intake <id-or-url> [options]
  huygena-intake search <query> [--limit n] [--sort relevance|cited|date] [--json]

IDs
  DOI            10.1038/s41586-021-03819-2, doi:…, https://doi.org/…, publisher URLs with a DOI
  arXiv          1706.03762, arXiv:1706.03762v5, https://arxiv.org/abs/…, hep-th/9901001
  bioRxiv        10.1101/2021.08.15.456425, https://www.biorxiv.org/content/…  (medRxiv too)
  PubMed / PMC   PMID:34265844, 34265844, PMC8371605, pubmed / pmc / europepmc URLs

Options
  --json             Print the brief (or search result) as JSON
  --all              Show every link instead of the first few per group
  --no-full-text     Do not read PMC / Europe PMC full text
  --no-github        Do not call the GitHub API
  --require <level>  Exit 4 unless readiness is at least <level> (ready | partial)
  --timeout <sec>    Per-request timeout in seconds (default 30, search 60)
  --limit <n>        search: number of results, 1-100 (default 10)
  --sort <order>     search: relevance (default), cited, date
  -h, --help         Show this help
  -v, --version      Show the version

Environment
  GITHUB_TOKEN       Raise the GitHub API limit from 60 to 5,000 requests/hour
  HUYGENA_MAILTO     Contact email for Crossref's polite pool and NCBI
  NO_COLOR           Disable color

Exit codes
  0 ok · 1 lookup failed (network, upstream error, timeout) · 2 usage error or unrecognized ID
  3 paper not found · 4 readiness below --require
`;

interface Args {
  positional: string[];
  json: boolean;
  all: boolean;
  fullText: boolean;
  github: boolean;
  require?: ReadinessLevel;
  timeoutMs?: number;
  limit?: number;
  sort?: SearchSort;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args {
  const a: Args = { positional: [], json: false, all: false, fullText: true, github: true, help: false, version: false };
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const take = () => (inline !== undefined ? inline : value(i++, flag));
    switch (flag) {
      case "--json":
        a.json = true;
        break;
      case "--all":
        a.all = true;
        break;
      case "--no-full-text":
        a.fullText = false;
        break;
      case "--no-github":
        a.github = false;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      case "-v":
      case "--version":
        a.version = true;
        break;
      case "--require": {
        const v = take();
        if (v !== "ready" && v !== "partial") throw new UsageError("--require must be ready or partial");
        a.require = v;
        break;
      }
      case "--timeout": {
        const v = Number(take());
        if (!Number.isFinite(v) || v <= 0) throw new UsageError("--timeout must be a positive number of seconds");
        a.timeoutMs = Math.round(v * 1000);
        break;
      }
      case "--limit": {
        const v = Number(take());
        if (!Number.isInteger(v) || v < 1 || v > 100) throw new UsageError("--limit must be an integer from 1 to 100");
        a.limit = v;
        break;
      }
      case "--sort": {
        const v = take();
        if (v !== "relevance" && v !== "cited" && v !== "date") throw new UsageError("--sort must be relevance, cited or date");
        a.sort = v;
        break;
      }
      default:
        if (arg.startsWith("--")) throw new UsageError(`Unknown option ${arg}`);
        a.positional.push(arg);
    }
  }
  return a;
}

function useColor(): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return !!process.stdout.isTTY && env.TERM !== "dumb";
}

// ---------- main ----------

async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`huygena-intake: ${(e as Error).message}\nRun huygena-intake --help for usage.\n`);
    return EXIT.usage;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }
  if (args.help || !args.positional.length) {
    (args.help ? process.stdout : process.stderr).write(HELP);
    return args.help ? EXIT.ok : EXIT.usage;
  }

  try {
    if (args.positional[0] === "search") {
      const query = args.positional.slice(1).join(" ");
      if (!query) throw new UsageError("search needs a query");
      const r = await search(query, { limit: args.limit, sort: args.sort, timeoutMs: args.timeoutMs });
      const fmt = { color: useColor(), width: Math.max(60, Math.min(process.stdout.columns || 100, 110)) };
      process.stdout.write(`${args.json ? JSON.stringify(r, null, 2) : formatSearch(r, fmt)}\n`);
      return EXIT.ok;
    }
    if (args.positional.length > 1) throw new UsageError(`Expected one ID, got ${args.positional.length}. Quote IDs that contain spaces.`);
    const fmt = { color: useColor(), width: Math.max(60, Math.min(process.stdout.columns || 100, 110)), all: args.all };
    const brief = await intake(args.positional[0]!, { fullText: args.fullText, checkGithub: args.github, timeoutMs: args.timeoutMs });
    process.stdout.write(`${args.json ? JSON.stringify(brief, null, 2) : formatBrief(brief, fmt)}\n`);
    if (args.require) {
      const order: ReadinessLevel[] = ["not_ready", "partial", "ready"];
      if (order.indexOf(brief.readiness.level) < order.indexOf(args.require)) return EXIT.notReady;
    }
    return EXIT.ok;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`huygena-intake: ${e.message}\n`);
      return EXIT.usage;
    }
    if (e instanceof IntakeError) {
      process.stderr.write(`huygena-intake: ${e.message}\n`);
      if (e.code === "invalid_id" || e.code === "invalid_query") return EXIT.usage;
      if (e.code === "not_found") return EXIT.notFound;
      return EXIT.failed;
    }
    process.stderr.write(`huygena-intake: ${(e as Error)?.message ?? String(e)}\n`);
    return EXIT.failed;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`huygena-intake: ${String(e)}\n`);
    process.exitCode = EXIT.failed;
  },
);
