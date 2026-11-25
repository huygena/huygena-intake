import type { Brief, Check, CheckId, CheckStatus, CodeLink, Readiness, ReadinessLevel } from "./schema.js";

/** The parts of a brief the readiness rules read. */
export type ReadinessInput = Pick<Brief, "code" | "data" | "access" | "statements">;

const ARCHIVE_HOSTS = new Set(["zenodo", "software_heritage", "code_ocean", "figshare", "osf"]);
const SHA = /^[0-9a-f]{7,40}$/i;

function label(c: CodeLink): string {
  return c.host === "github" && c.id ? `github.com/${c.id}` : c.url.replace(/^https?:\/\//, "");
}

function list(xs: string[], max = 3): string {
  return xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;
}

function check(id: CheckId, status: CheckStatus, reason: string, core: boolean): Check {
  return { id, status, reason, core };
}

/**
 * Rule-based readiness for a replication run. Pure: reads the brief, makes no calls.
 *
 * Core checks: code_found, code_reachable, code_license, data_found, open_access.
 * Advisory checks: code_snapshot, availability_statement.
 *
 * Level: `not_ready` if any core check fails; `ready` if every core check passes; `partial` otherwise.
 */
export function assessReadiness(brief: ReadinessInput): Readiness {
  const checks: Check[] = [];
  const primary = brief.code.filter((c) => c.role === "primary");
  const mentioned = brief.code.filter((c) => c.role === "mentioned");

  // code_found
  if (primary.length) {
    checks.push(check("code_found", "pass", `The paper links its own code: ${list(primary.map(label))}`, true));
  } else if (mentioned.length) {
    checks.push(
      check(
        "code_found",
        "warn",
        `Only tools the paper used are linked (${list(mentioned.map(label))}); the paper's own code was not found`,
        true,
      ),
    );
  } else {
    checks.push(check("code_found", "fail", "No code repository or archive found in the metadata, abstract or full text", true));
  }

  // code_reachable
  const gh = primary.filter((c) => c.host === "github");
  const ghOk = gh.filter((c) => c.github?.status === "ok");
  const ghMissing = gh.filter((c) => c.github?.status === "not_found");
  const nonGh = primary.filter((c) => c.host !== "github");
  if (!primary.length) {
    checks.push(check("code_reachable", "skip", "No primary code link to check", true));
  } else if (ghOk.length) {
    const c = ghOk[0]!;
    const g = c.github!;
    const bits = [g.defaultBranch && `default branch ${g.defaultBranch}`, g.pushedAt && `last push ${g.pushedAt.slice(0, 10)}`, g.archived && "archived (read-only)"]
      .filter(Boolean)
      .join(", ");
    checks.push(check("code_reachable", "pass", `github.com/${g.fullName ?? c.id} is live on GitHub${bits ? ` (${bits})` : ""}`, true));
  } else if (ghMissing.length && ghMissing.length === primary.length) {
    checks.push(check("code_reachable", "fail", `GitHub returned 404 for ${list(ghMissing.map((c) => c.id ?? c.url))}`, true));
  } else {
    const unchecked = gh.find((c) => c.github?.status === "unchecked" && c.github.reason);
    const why = unchecked?.github?.reason ?? (nonGh.length ? `only GitHub repositories are checked; ${list(nonGh.map(label))} not verified` : "not checked");
    checks.push(check("code_reachable", "warn", `Not verified: ${why}`, true));
  }

  // code_license
  if (!primary.length) {
    checks.push(check("code_license", "skip", "No primary code link", true));
  } else if (ghOk.length) {
    const licensed = ghOk.find((c) => c.github?.license && c.github.license !== "NOASSERTION");
    if (licensed) {
      checks.push(check("code_license", "pass", `${licensed.github!.license} (detected by GitHub in ${licensed.github!.fullName ?? licensed.id})`, true));
    } else if (ghOk.some((c) => c.github?.license === "NOASSERTION")) {
      checks.push(check("code_license", "warn", "GitHub found a license file but could not identify it; check reuse terms by hand", true));
    } else {
      checks.push(check("code_license", "warn", `No license file detected in ${list(ghOk.map((c) => c.github?.fullName ?? c.id ?? c.url))}; reuse terms are unclear`, true));
    }
  } else {
    checks.push(check("code_license", "warn", "License unknown: the code host was not checked", true));
  }

  // data_found
  const dataStmt = brief.statements.data ?? "";
  if (brief.data.length) {
    const accessions = brief.data.filter((d) => d.kind === "accession").length;
    const links = brief.data.length - accessions;
    const parts = [links && `${links} link${links === 1 ? "" : "s"}`, accessions && `${accessions} accession${accessions === 1 ? "" : "s"}`].filter(Boolean);
    checks.push(check("data_found", "pass", `${parts.join(" and ")} to datasets or database records`, true));
  } else if (/\b(?:upon|on) (?:reasonable )?request\b|\bfrom the (?:corresponding )?authors?\b/i.test(dataStmt)) {
    checks.push(check("data_found", "warn", "The data statement says data are available from the authors on request", true));
  } else if (dataStmt) {
    checks.push(check("data_found", "warn", "A data statement exists but names no repository link or accession", true));
  } else {
    checks.push(check("data_found", "warn", "No dataset links or accessions found (public benchmarks are often named without a link)", true));
  }

  // open_access
  const a = brief.access;
  if (a.openAccess === true) {
    checks.push(check("open_access", "pass", `Free to read${a.license ? ` (${a.license})` : ""}${a.basis ? `; source: ${a.basis}` : ""}`, true));
  } else if (a.openAccess === false) {
    checks.push(check("open_access", "warn", `Not open access${a.basis ? ` per ${a.basis}` : ""}: reported values must come from a licensed copy`, true));
  } else {
    checks.push(check("open_access", "warn", "Open-access status unknown", true));
  }

  // code_snapshot (advisory)
  if (!brief.code.length) {
    checks.push(check("code_snapshot", "skip", "No code link", false));
  } else {
    const archive = brief.code.find((c) => ARCHIVE_HOSTS.has(c.host) && c.role === "primary") ?? brief.code.find((c) => ARCHIVE_HOSTS.has(c.host));
    const pinned = brief.code.find((c) => c.ref && SHA.test(c.ref));
    if (archive) checks.push(check("code_snapshot", "pass", `Archived copy: ${label(archive)}`, false));
    else if (pinned) checks.push(check("code_snapshot", "pass", `Link pins commit ${pinned.ref!.slice(0, 12)} in ${label(pinned)}`, false));
    else checks.push(check("code_snapshot", "warn", "Code lives only in a git repository that can change after publication; a run must pin a commit", false));
  }

  // availability_statement (advisory)
  const found = [brief.statements.code && "code availability", brief.statements.data && "data availability"].filter(Boolean) as string[];
  if (found.length) {
    checks.push(check("availability_statement", "pass", `Found: ${found.join(" and ")}`, false));
  } else if (a.fullText) {
    checks.push(check("availability_statement", "warn", "Full text was read but has no code or data availability statement", false));
  } else {
    checks.push(check("availability_statement", "skip", "No open full text to read", false));
  }

  const core = checks.filter((c) => c.core);
  const level: ReadinessLevel = core.some((c) => c.status === "fail") ? "not_ready" : core.every((c) => c.status === "pass") ? "ready" : "partial";
  const open = core.filter((c) => c.status !== "pass").map((c) => `${c.id} ${c.status}`);
  const passed = core.length - open.length;
  const summary =
    level === "ready"
      ? `All ${core.length} core checks pass`
      : `${passed} of ${core.length} core checks pass (${open.join(", ")})`;
  return { level, summary, checks };
}
