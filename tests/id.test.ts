import { describe, expect, it } from "vitest";
import { parseId } from "../src/index.js";

describe("parseId", () => {
  const cases: [string, ReturnType<typeof parseId>][] = [
    // DOIs
    ["10.1038/s41586-021-03819-2", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["  doi:10.1038/S41586-021-03819-2  ", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["DOI: 10.1093/nar/gkab1061", { kind: "doi", value: "10.1093/nar/gkab1061", canonical: "doi:10.1093/nar/gkab1061" }],
    ["https://doi.org/10.1038/s41586-021-03819-2.", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["http://dx.doi.org/10.1126/science.abj8754", { kind: "doi", value: "10.1126/science.abj8754", canonical: "doi:10.1126/science.abj8754" }],
    ["https://doi.org/10.1038%2Fs41586-021-03819-2", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["https://www.science.org/doi/10.1126/science.abj8754", { kind: "doi", value: "10.1126/science.abj8754", canonical: "doi:10.1126/science.abj8754" }],
    ["https://www.pnas.org/doi/full/10.1073/pnas.2016239118", { kind: "doi", value: "10.1073/pnas.2016239118", canonical: "doi:10.1073/pnas.2016239118" }],
    ["https://onlinelibrary.wiley.com/doi/abs/10.1002/pro.4172/abstract", { kind: "doi", value: "10.1002/pro.4172", canonical: "doi:10.1002/pro.4172" }],
    ["https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1009935", { kind: "doi", value: "10.1371/journal.pcbi.1009935", canonical: "doi:10.1371/journal.pcbi.1009935" }],
    ["https://www.nature.com/articles/s41586-021-03819-2", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["https://www.nature.com/articles/s41586-021-03819-2.pdf", { kind: "doi", value: "10.1038/s41586-021-03819-2", canonical: "doi:10.1038/s41586-021-03819-2" }],
    ["(10.1016/S0140-6736(20)30183-5)", { kind: "doi", value: "10.1016/s0140-6736(20)30183-5", canonical: "doi:10.1016/s0140-6736(20)30183-5" }],
    ["10.1016/S0140-6736(20)30183-5).", { kind: "doi", value: "10.1016/s0140-6736(20)30183-5", canonical: "doi:10.1016/s0140-6736(20)30183-5" }],
    // Cold Spring Harbor journals share the 10.1101 prefix but are not preprints.
    ["10.1101/gr.123456.110", { kind: "doi", value: "10.1101/gr.123456.110", canonical: "doi:10.1101/gr.123456.110" }],
    // arXiv
    ["1706.03762", { kind: "arxiv", value: "1706.03762", canonical: "arxiv:1706.03762" }],
    ["arXiv:1706.03762v5", { kind: "arxiv", value: "1706.03762", canonical: "arxiv:1706.03762", version: 5 }],
    ["arxiv: 2106.09685", { kind: "arxiv", value: "2106.09685", canonical: "arxiv:2106.09685" }],
    ["https://arxiv.org/abs/1706.03762v7", { kind: "arxiv", value: "1706.03762", canonical: "arxiv:1706.03762", version: 7 }],
    ["https://arxiv.org/pdf/1706.03762v7.pdf", { kind: "arxiv", value: "1706.03762", canonical: "arxiv:1706.03762", version: 7 }],
    ["arxiv.org/pdf/2106.09685", { kind: "arxiv", value: "2106.09685", canonical: "arxiv:2106.09685" }],
    ["https://export.arxiv.org/abs/2106.09685?context=cs", { kind: "arxiv", value: "2106.09685", canonical: "arxiv:2106.09685" }],
    ["https://arxiv.org/html/2106.09685v2", { kind: "arxiv", value: "2106.09685", canonical: "arxiv:2106.09685", version: 2 }],
    ["10.48550/arXiv.1706.03762", { kind: "arxiv", value: "1706.03762", canonical: "arxiv:1706.03762" }],
    ["https://doi.org/10.48550/arXiv.2106.09685", { kind: "arxiv", value: "2106.09685", canonical: "arxiv:2106.09685" }],
    ["hep-th/9901001v2", { kind: "arxiv", value: "hep-th/9901001", canonical: "arxiv:hep-th/9901001", version: 2 }],
    ["math.GT/0309136", { kind: "arxiv", value: "math.GT/0309136", canonical: "arxiv:math.GT/0309136" }],
    ["https://arxiv.org/abs/hep-th/9901001", { kind: "arxiv", value: "hep-th/9901001", canonical: "arxiv:hep-th/9901001" }],
    // bioRxiv / medRxiv
    ["10.1101/2021.08.15.456425", { kind: "biorxiv", value: "10.1101/2021.08.15.456425", canonical: "doi:10.1101/2021.08.15.456425" }],
    [
      "https://www.biorxiv.org/content/10.1101/2021.08.15.456425v2.full.pdf",
      { kind: "biorxiv", value: "10.1101/2021.08.15.456425", canonical: "doi:10.1101/2021.08.15.456425", version: 2, server: "biorxiv" },
    ],
    [
      "https://www.biorxiv.org/content/10.1101/2021.08.15.456425v3.full",
      { kind: "biorxiv", value: "10.1101/2021.08.15.456425", canonical: "doi:10.1101/2021.08.15.456425", version: 3, server: "biorxiv" },
    ],
    [
      "https://www.medrxiv.org/content/10.1101/2020.03.04.20030395v1",
      { kind: "biorxiv", value: "10.1101/2020.03.04.20030395", canonical: "doi:10.1101/2020.03.04.20030395", version: 1, server: "medrxiv" },
    ],
    ["https://doi.org/10.1101/123456", { kind: "biorxiv", value: "10.1101/123456", canonical: "doi:10.1101/123456" }],
    // PubMed / PMC
    ["PMID: 34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["pmid:34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["https://pubmed.ncbi.nlm.nih.gov/34265844/", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["https://www.ncbi.nlm.nih.gov/pubmed/34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["https://europepmc.org/article/MED/34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["https://europepmc.org/abstract/MED/34265844", { kind: "pmid", value: "34265844", canonical: "pmid:34265844" }],
    ["PMC8371605", { kind: "pmcid", value: "PMC8371605", canonical: "pmcid:PMC8371605" }],
    ["pmc8371605", { kind: "pmcid", value: "PMC8371605", canonical: "pmcid:PMC8371605" }],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC8371605/", { kind: "pmcid", value: "PMC8371605", canonical: "pmcid:PMC8371605" }],
    ["https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8371605/", { kind: "pmcid", value: "PMC8371605", canonical: "pmcid:PMC8371605" }],
    ["https://europepmc.org/article/PMC/PMC8371605", { kind: "pmcid", value: "PMC8371605", canonical: "pmcid:PMC8371605" }],
  ];

  it.each(cases)("%s", (input, expected) => {
    expect(parseId(input)).toEqual(expected);
  });

  it.each(["", "   ", "hello world", "https://example.com/paper", "10.12/too-short-prefix", "arXiv:", "https://github.com/deepmind/alphafold"])(
    "rejects %j",
    (input) => {
      expect(parseId(input)).toBeNull();
    },
  );

  it("does not throw on non-string input", () => {
    expect(parseId(undefined as unknown as string)).toBeNull();
  });
});
