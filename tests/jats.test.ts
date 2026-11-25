import { describe, expect, it } from "vitest";
import { jatsToText, normalizeLicense, parseJats } from "../src/index.js";
import { licenseUrl } from "../src/license.js";
import { fx } from "./helpers.js";

describe("parseJats", () => {
  it("pulls code and data statements from the AlphaFold 2 PMC XML", () => {
    const doc = parseJats(fx("pmc-alphafold2.xml"));
    expect(doc.hasBody).toBe(true);
    expect(doc.statements.code.join(" ")).toMatch(/Source code for the AlphaFold model.*https:\/\/github\.com\/deepmind\/alphafold/);
    expect(doc.statements.data.join(" ")).toMatch(/^All input data are freely available from public sources\..*https:\/\/www\.wwpdb\.org/s);
    expect(doc.license).toBe("CC-BY-4.0");
    expect(doc.openAccess).toBe(true);
    expect(doc.abstract).toMatch(/^Proteins are essential to life/);
  });

  it("reads a data statement kept in custom-meta (PLOS)", () => {
    const doc = parseJats(fx("pmc-plos.xml"));
    expect(doc.statements.data.join(" ")).toContain("https://github.com/markziemann/SurveyEnrichmentMethods");
    expect(doc.statements.data.join(" ")).toContain("https://doi.org/10.5281/zenodo.5763096");
    expect(doc.license).toBe("CC-BY-4.0");
  });

  it("finds statements by section title in any wrapper", () => {
    const xml = `<article><front><article-meta><permissions><license xlink:href="http://creativecommons.org/licenses/by-nc-nd/4.0/"/></permissions></article-meta></front>
      <body><sec><title>Methods</title><p>We did things.</p></sec></body>
      <back>
        <notes notes-type="data-availability"><title>Code availability</title><p>Code: <ext-link xlink:href="https://github.com/a/b">here</ext-link>.</p></notes>
        <sec><title>Data and materials availability</title><p>Reads are in SRA (<xref ref-type="bibr" rid="r1">12</xref>) PRJNA1.</p></sec>
        <fn-group><fn><p>Unrelated footnote.</p></fn></fn-group>
      </back></article>`;
    const doc = parseJats(xml);
    expect(doc.statements.code).toEqual(["Code: here (https://github.com/a/b)."]);
    expect(doc.statements.data).toEqual(["Reads are in SRA () PRJNA1."]);
    expect(doc.license).toBe("CC-BY-NC-ND-4.0");
    expect(doc.bodyText).toContain("We did things.");
  });

  it("handles an article with no body", () => {
    const doc = parseJats("<article><front><article-meta><abstract><p>Short.</p></abstract></article-meta></front></article>");
    expect(doc).toMatchObject({ hasBody: false, abstract: "Short.", statements: { code: [], data: [] }, license: null });
  });

  it("decodes entities and drops tags", () => {
    expect(jatsToText("<p>A &amp; B&#x2009;<italic>in vivo</italic> &lt;5</p>")).toBe("A & B in vivo <5");
  });
});

describe("normalizeLicense", () => {
  it.each([
    ["http://creativecommons.org/licenses/by/4.0/", "CC-BY-4.0"],
    ["https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode", "CC-BY-NC-ND-4.0"],
    ["https://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
    ["https://creativecommons.org/publicdomain/mark/1.0/", "PDM"],
    ["cc by", "CC-BY"],
    ["cc_by_nc_nd", "CC-BY-NC-ND"],
    ["CC BY 4.0", "CC-BY-4.0"],
    ["cc0", "CC0-1.0"],
    ["cc_no", "none"],
    ["https://www.springernature.com/gp/researchers/text-and-data-mining", null],
    ["https://www.elsevier.com/tdm/userlicense/1.0/", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (raw, out) => {
    expect(normalizeLicense(raw)).toBe(out);
  });

  it("builds canonical URLs", () => {
    expect(licenseUrl("CC-BY-4.0")).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(licenseUrl("CC0-1.0")).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(licenseUrl("CC-BY")).toBeNull();
    expect(licenseUrl(null)).toBeNull();
  });
});
