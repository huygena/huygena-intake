import { describe, expect, it } from "vitest";
import { assessReadiness, type CodeLink, type DataLink, type GithubCheck, type ReadinessInput } from "../src/index.js";

const gh = (over: Partial<GithubCheck> = {}): GithubCheck => ({
  status: "ok",
  reason: null,
  fullName: "lab/method",
  defaultBranch: "main",
  license: "MIT",
  stars: 10,
  pushedAt: "2025-01-02T03:04:05Z",
  archived: false,
  fork: false,
  description: null,
  ...over,
});

const repo = (over: Partial<CodeLink> = {}): CodeLink => ({
  url: "https://github.com/lab/method",
  host: "github",
  id: "lab/method",
  ref: null,
  role: "primary",
  context: "Our code is at https://github.com/lab/method.",
  foundIn: ["code_statement"],
  github: gh(),
  ...over,
});

const dataset = (over: Partial<DataLink> = {}): DataLink => ({
  url: "https://doi.org/10.5281/zenodo.1",
  repository: "zenodo",
  id: "zenodo.1",
  kind: "link",
  context: "",
  foundIn: ["data_statement"],
  ...over,
});

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  code: [repo()],
  data: [dataset()],
  access: { openAccess: true, basis: "PMC open-access subset", license: "CC-BY-4.0", licenseUrl: null, fullText: { source: "ncbi_pmc", id: "PMC1" } },
  statements: { code: "Our code is at https://github.com/lab/method.", data: "Data: zenodo." },
  ...over,
});

const status = (input: ReadinessInput) => Object.fromEntries(assessReadiness(input).checks.map((c) => [c.id, c.status]));

describe("assessReadiness", () => {
  it("is ready when every core check passes", () => {
    const r = assessReadiness(base());
    expect(r.level).toBe("ready");
    expect(r.summary).toBe("All 5 core checks pass");
    expect(r.checks.map((c) => [c.id, c.core])).toEqual([
      ["code_found", true],
      ["code_reachable", true],
      ["code_license", true],
      ["data_found", true],
      ["open_access", true],
      ["code_snapshot", false],
      ["availability_statement", false],
    ]);
  });

  it("is not_ready when no code is found", () => {
    const r = assessReadiness(base({ code: [] }));
    expect(r.level).toBe("not_ready");
    expect(status(base({ code: [] }))).toMatchObject({ code_found: "fail", code_reachable: "skip", code_license: "skip", code_snapshot: "skip" });
    expect(r.summary).toBe("2 of 5 core checks pass (code_found fail, code_reachable skip, code_license skip)");
  });

  it("warns when only tools the paper used are linked", () => {
    const r = assessReadiness(base({ code: [repo({ role: "mentioned", id: "tensorflow/tensorflow" })] }));
    expect(r.level).toBe("partial");
    expect(r.checks[0]).toMatchObject({ id: "code_found", status: "warn" });
    expect(r.checks[0]!.reason).toContain("github.com/tensorflow/tensorflow");
  });

  it("fails code_reachable when every primary repo is a GitHub 404", () => {
    const s = status(base({ code: [repo({ github: gh({ status: "not_found", fullName: null }) })] }));
    expect(s.code_reachable).toBe("fail");
    expect(assessReadiness(base({ code: [repo({ github: gh({ status: "not_found" }) })] })).level).toBe("not_ready");
  });

  it("passes code_reachable when one of several repos is live", () => {
    const s = status(base({ code: [repo({ id: "a/gone", github: gh({ status: "not_found" }) }), repo()] }));
    expect(s.code_reachable).toBe("pass");
  });

  it("warns with the reason when GitHub was not checked", () => {
    const r = assessReadiness(base({ code: [repo({ github: gh({ status: "unchecked", reason: "GitHub rate limit reached" }) })] }));
    expect(r.checks[1]).toMatchObject({ status: "warn", reason: "Not verified: GitHub rate limit reached" });
    expect(r.checks[2]).toMatchObject({ id: "code_license", status: "warn" });
    expect(r.level).toBe("partial");
  });

  it("warns that non-GitHub hosts are not verified", () => {
    const r = assessReadiness(base({ code: [repo({ host: "gitlab", url: "https://gitlab.com/g/p", id: "g/p", github: null })] }));
    expect(r.checks[1]!.status).toBe("warn");
    expect(r.checks[1]!.reason).toContain("only GitHub repositories are checked; gitlab.com/g/p");
  });

  it("checks the license GitHub detected", () => {
    expect(status(base({ code: [repo({ github: gh({ license: null }) })] })).code_license).toBe("warn");
    expect(assessReadiness(base({ code: [repo({ github: gh({ license: "NOASSERTION" }) })] })).checks[2]!.reason).toMatch(/could not identify/);
    expect(assessReadiness(base()).checks[2]!.reason).toBe("MIT (detected by GitHub in lab/method)");
  });

  it("notes archived repos and moved repos without failing", () => {
    const r = assessReadiness(base({ code: [repo({ github: gh({ archived: true, fullName: "neworg/method" }) })] }));
    expect(r.checks[1]).toMatchObject({ status: "pass" });
    expect(r.checks[1]!.reason).toBe("github.com/neworg/method is live on GitHub (default branch main, last push 2025-01-02, archived (read-only))");
  });

  it("separates 'data on request' from no data statement", () => {
    const onRequest = assessReadiness(base({ data: [], statements: { code: null, data: "Data are available from the corresponding author upon reasonable request." } }));
    expect(onRequest.checks[3]).toMatchObject({ status: "warn", reason: "The data statement says data are available from the authors on request" });
    expect(assessReadiness(base({ data: [], statements: { code: null, data: "All data are in the paper." } })).checks[3]!.reason).toMatch(/names no repository/);
    expect(assessReadiness(base({ data: [], statements: { code: null, data: null } })).checks[3]!.reason).toMatch(/^No dataset links/);
  });

  it("counts links and accessions", () => {
    const r = assessReadiness(base({ data: [dataset(), dataset({ id: "GSE1", repository: "geo", kind: "accession" }), dataset({ id: "GSE2", kind: "accession" })] }));
    expect(r.checks[3]!.reason).toBe("1 link and 2 accessions to datasets or database records");
  });

  it("warns on closed or unknown access", () => {
    expect(status(base({ access: { openAccess: false, basis: "Europe PMC", license: null, licenseUrl: null, fullText: null } })).open_access).toBe("warn");
    expect(assessReadiness(base({ access: { openAccess: null, basis: null, license: null, licenseUrl: null, fullText: null } })).checks[4]!.reason).toBe(
      "Open-access status unknown",
    );
  });

  it("passes code_snapshot for an archive or a pinned commit, and never changes the level", () => {
    expect(status(base()).code_snapshot).toBe("warn");
    expect(assessReadiness(base()).level).toBe("ready");
    const zen = repo({ host: "zenodo", url: "https://doi.org/10.5281/zenodo.9", id: "zenodo.9", github: null });
    expect(assessReadiness(base({ code: [repo(), zen] })).checks[5]!.reason).toBe("Archived copy: doi.org/10.5281/zenodo.9");
    expect(status(base({ code: [repo({ ref: "3f2a9c1d0e8b" })] })).code_snapshot).toBe("pass");
    expect(status(base({ code: [repo({ ref: "main" })] })).code_snapshot).toBe("warn");
  });

  it("reports the availability statement as advisory", () => {
    expect(status(base()).availability_statement).toBe("pass");
    expect(status(base({ statements: { code: null, data: null } })).availability_statement).toBe("warn");
    const noFt = base({ statements: { code: null, data: null }, access: { ...base().access, fullText: null } });
    expect(status(noFt).availability_statement).toBe("skip");
  });
});
