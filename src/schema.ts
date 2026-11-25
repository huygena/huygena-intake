import { z } from "zod";

/** Identifier kinds understood by `parseId`. */
export const IdKindSchema = z.enum(["doi", "arxiv", "biorxiv", "pmid", "pmcid"]);
export type IdKind = z.infer<typeof IdKindSchema>;

export const ParsedIdSchema = z.object({
  kind: IdKindSchema,
  /** Normalized value: lower-case DOI, arXiv ID without version, digits for PMID, `PMC123` for PMCID. */
  value: z.string(),
  /** Stable string form, for example `doi:10.1038/s41586-021-03819-2` or `arxiv:1706.03762`. */
  canonical: z.string(),
  /** arXiv or bioRxiv version if the input named one. */
  version: z.number().int().positive().optional(),
  /** Preprint server, when the input URL said which one. */
  server: z.enum(["biorxiv", "medrxiv"]).optional(),
});
export type ParsedId = z.infer<typeof ParsedIdSchema>;

export const CodeHostSchema = z.enum([
  "github",
  "gitlab",
  "bitbucket",
  "codeberg",
  "zenodo",
  "figshare",
  "software_heritage",
  "code_ocean",
  "huggingface",
  "osf",
  "other",
]);
export type CodeHost = z.infer<typeof CodeHostSchema>;

export const DataRepositorySchema = z.enum([
  "zenodo",
  "figshare",
  "dryad",
  "osf",
  "dataverse",
  "mendeley_data",
  "huggingface",
  "kaggle",
  "geo",
  "sra",
  "ena",
  "arrayexpress",
  "pdb",
  "emdb",
  "uniprot",
  "other",
]);
export type DataRepository = z.infer<typeof DataRepositorySchema>;

/**
 * - `primary`: the paper points to it as its own code (abstract, "code is available at", a code statement without tool cues).
 * - `mentioned`: cited as a tool or dependency ("we used HMMER v3.3 (url)").
 */
export const CodeRoleSchema = z.enum(["primary", "mentioned"]);
export type CodeRole = z.infer<typeof CodeRoleSchema>;

/** A code link as returned by the pure `findLinks`. */
export const FoundCodeSchema = z.object({
  /** Canonical URL: repository root for git hosts, record URL or DOI URL for archives. */
  url: z.string(),
  host: CodeHostSchema,
  /** Host-specific ID: `owner/repo`, `zenodo.123`, `swh:1:dir:…`. */
  id: z.string().nullable(),
  /** Branch, tag or commit named in the link (`/tree/<ref>`, `/commit/<sha>`). */
  ref: z.string().nullable(),
  role: CodeRoleSchema,
  /** The sentence the link appeared in, trimmed to 300 characters. */
  context: z.string().nullable(),
});
export type FoundCode = z.infer<typeof FoundCodeSchema>;

/** A data link or accession as returned by the pure `findLinks`. */
export const FoundDataSchema = z.object({
  url: z.string(),
  repository: DataRepositorySchema,
  /** Accession or record ID: `GSE12345`, `6Y4F`, `zenodo.123`. */
  id: z.string().nullable(),
  /** `accession` when matched from an ID in text, `link` when matched from a URL or DOI. */
  kind: z.enum(["link", "accession"]),
  context: z.string().nullable(),
});
export type FoundData = z.infer<typeof FoundDataSchema>;

export const FoundLinksSchema = z.object({
  code: z.array(FoundCodeSchema),
  data: z.array(FoundDataSchema),
});
export type FoundLinks = z.infer<typeof FoundLinksSchema>;

/** Where in the paper record a link was found. */
export const LinkOriginSchema = z.enum([
  "abstract",
  "arxiv_comment",
  "crossref_relation",
  "crossref_link",
  "code_statement",
  "data_statement",
  "full_text",
]);
export type LinkOrigin = z.infer<typeof LinkOriginSchema>;

export const GithubCheckSchema = z.object({
  /** `ok`: the API returned the repo. `not_found`: 404 (deleted, private or a typo). `unchecked`: not asked or no answer. */
  status: z.enum(["ok", "not_found", "unchecked"]),
  reason: z.string().nullable(),
  /** `owner/repo` as GitHub reports it now. Differs from the link when the repo was renamed or moved. */
  fullName: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  /** SPDX ID from GitHub's license detection, `null` when no license file was detected. */
  license: z.string().nullable(),
  stars: z.number().int().nullable(),
  pushedAt: z.string().nullable(),
  archived: z.boolean().nullable(),
  fork: z.boolean().nullable(),
  description: z.string().nullable(),
});
export type GithubCheck = z.infer<typeof GithubCheckSchema>;

export const CodeLinkSchema = FoundCodeSchema.extend({
  foundIn: z.array(LinkOriginSchema),
  /** Present for GitHub repositories. */
  github: GithubCheckSchema.nullable(),
});
export type CodeLink = z.infer<typeof CodeLinkSchema>;

export const DataLinkSchema = FoundDataSchema.extend({
  foundIn: z.array(LinkOriginSchema),
});
export type DataLink = z.infer<typeof DataLinkSchema>;

export const PaperSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  /** Publication or posting date, `YYYY-MM-DD` or `YYYY-MM` or `YYYY`. */
  published: z.string().nullable(),
  venue: z.string().nullable(),
  publisher: z.string().nullable(),
  /** `journal-article`, `preprint`, `proceedings-article`, … */
  type: z.string().nullable(),
  abstract: z.string().nullable(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  pmid: z.string().nullable(),
  pmcid: z.string().nullable(),
  /** Version of a preprint (arXiv `v5`, bioRxiv version 3). */
  version: z.number().int().nullable(),
  /** DOI of the journal version, when a preprint server reports one. */
  publishedDoi: z.string().nullable(),
  links: z.object({
    landing: z.string().nullable(),
    doi: z.string().nullable(),
    pdf: z.string().nullable(),
    europepmc: z.string().nullable(),
    pmc: z.string().nullable(),
  }),
});
export type Paper = z.infer<typeof PaperSchema>;

export const AccessSchema = z.object({
  /** `true` when free to read, `false` when the sources say it is not, `null` when unknown. */
  openAccess: z.boolean().nullable(),
  /** Which source decided `openAccess`. */
  basis: z.string().nullable(),
  /** Normalized license, for example `CC-BY-4.0`, `CC-BY-NC-ND`, `none` (all rights reserved). */
  license: z.string().nullable(),
  licenseUrl: z.string().nullable(),
  /** The full text that was read for statements and links, if any. */
  fullText: z
    .object({
      source: z.enum(["ncbi_pmc", "europepmc"]),
      id: z.string(),
    })
    .nullable(),
});
export type Access = z.infer<typeof AccessSchema>;

export const CheckStatusSchema = z.enum(["pass", "warn", "fail", "skip"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckIdSchema = z.enum([
  "code_found",
  "code_reachable",
  "code_license",
  "code_snapshot",
  "data_found",
  "open_access",
  "availability_statement",
]);
export type CheckId = z.infer<typeof CheckIdSchema>;

export const CheckSchema = z.object({
  id: CheckIdSchema,
  status: CheckStatusSchema,
  reason: z.string(),
  /** Whether this check takes part in the overall level. Advisory checks never change it. */
  core: z.boolean(),
});
export type Check = z.infer<typeof CheckSchema>;

export const ReadinessLevelSchema = z.enum(["ready", "partial", "not_ready"]);
export type ReadinessLevel = z.infer<typeof ReadinessLevelSchema>;

export const ReadinessSchema = z.object({
  level: ReadinessLevelSchema,
  summary: z.string(),
  checks: z.array(CheckSchema),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

export const SourceNameSchema = z.enum(["crossref", "arxiv", "biorxiv", "europepmc", "ncbi", "github"]);
export type SourceName = z.infer<typeof SourceNameSchema>;

/** One HTTP call made while building the brief. */
export const SourceCallSchema = z.object({
  name: SourceNameSchema,
  url: z.string(),
  ok: z.boolean(),
  status: z.number().int().nullable(),
  ms: z.number().int(),
  error: z.string().nullable(),
});
export type SourceCall = z.infer<typeof SourceCallSchema>;

export const BriefSchema = z.object({
  schema: z.literal("huygena.brief/v1"),
  tool: z.object({ name: z.literal("huygena-intake"), version: z.string() }),
  generatedAt: z.string(),
  input: z.string(),
  id: ParsedIdSchema,
  paper: PaperSchema,
  access: AccessSchema,
  code: z.array(CodeLinkSchema),
  data: z.array(DataLinkSchema),
  statements: z.object({
    code: z.string().nullable(),
    data: z.string().nullable(),
  }),
  readiness: ReadinessSchema,
  sources: z.array(SourceCallSchema),
  warnings: z.array(z.string()),
});
export type Brief = z.infer<typeof BriefSchema>;

export const SearchSortSchema = z.enum(["relevance", "cited", "date"]);
export type SearchSort = z.infer<typeof SearchSortSchema>;

export const SearchHitSchema = z.object({
  rank: z.number().int().positive(),
  /** Europe PMC record ID and source (`MED`, `PMC`, `PPR`, …). */
  id: z.string(),
  source: z.string(),
  title: z.string(),
  authors: z.string(),
  year: z.number().int().nullable(),
  journal: z.string().nullable(),
  doi: z.string().nullable(),
  pmid: z.string().nullable(),
  pmcid: z.string().nullable(),
  openAccess: z.boolean(),
  /** Citation count as Europe PMC returns it. */
  citedBy: z.number().int(),
  url: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResultSchema = z.object({
  query: z.string(),
  sort: SearchSortSchema,
  total: z.number().int(),
  hits: z.array(SearchHitSchema),
  source: SourceCallSchema,
});
export type SearchResult = z.infer<typeof SearchResultSchema>;
