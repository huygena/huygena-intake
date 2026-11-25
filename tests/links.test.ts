import { describe, expect, it } from "vitest";
import { findLinks } from "../src/index.js";

const code = (text: string, opts?: Parameters<typeof findLinks>[1]) => findLinks(text, opts).code;
const data = (text: string, opts?: Parameters<typeof findLinks>[1]) => findLinks(text, opts).data;

describe("findLinks: code hosts", () => {
  it("strips trailing punctuation and brackets", () => {
    for (const t of [
      "Code: https://github.com/microsoft/LoRA.",
      "Code (https://github.com/microsoft/LoRA).",
      "Code [https://github.com/microsoft/LoRA];",
      "Code at <https://github.com/microsoft/LoRA>,",
      "“https://github.com/microsoft/LoRA”",
      "Code: https://github.com/microsoft/LoRA.git.",
      "Code: https://github.com/microsoft/LoRA/",
    ]) {
      expect(code(t).map((c) => c.url), t).toEqual(["https://github.com/microsoft/LoRA"]);
    }
  });

  it("finds scheme-less links", () => {
    const [c] = code("ColabFold is open-source software available at github.com/sokrypton/ColabFold. Its databases are at colabfold.mmseqs.com");
    expect(c).toMatchObject({ url: "https://github.com/sokrypton/ColabFold", host: "github", id: "sokrypton/ColabFold" });
    expect(code("see www.github.com/a-b/c_d.e for details")[0]?.id).toBe("a-b/c_d.e");
  });

  it("reduces tree, blob, commit and release links to the repo and keeps the ref", () => {
    const out = code(
      "https://github.com/org/repo/tree/main/src/model and https://github.com/org/repo/blob/v1.2/README.md " +
        "and https://github.com/other/thing/commit/3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f and https://github.com/x/y/releases/tag/v0.3.1",
    );
    expect(out.map((c) => [c.id, c.ref])).toEqual([
      ["org/repo", "main"],
      ["other/thing", "3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f"],
      ["x/y", "v0.3.1"],
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(code("https://github.com/Org/Repo and https://github.com/org/repo/issues").length).toBe(1);
  });

  it("ignores GitHub pages that are not repositories", () => {
    expect(code("https://github.com/features/actions https://github.com/orgs/foo/people https://github.com/sponsors/bar https://github.com/deepmind")).toEqual([]);
  });

  it("maps raw.githubusercontent.com to the repo", () => {
    expect(code("https://raw.githubusercontent.com/user/proj/main/data.csv")[0]).toMatchObject({ id: "user/proj", ref: "main" });
  });

  it("handles GitLab groups, subgroups and self-hosted instances", () => {
    const out = code("https://gitlab.com/group/sub/project/-/tree/dev and https://gitlab.inria.fr/team/tool.git");
    expect(out.map((c) => [c.host, c.url, c.ref])).toEqual([
      ["gitlab", "https://gitlab.com/group/sub/project", "dev"],
      ["gitlab", "https://gitlab.inria.fr/team/tool", null],
    ]);
  });

  it("recognizes Bitbucket, Codeberg, Code Ocean, Software Heritage and Hugging Face", () => {
    const out = code(
      "https://bitbucket.org/lab/pipeline/src/master/ https://codeberg.org/me/tool " +
        "https://codeocean.com/capsule/1234567/tree/v1 https://doi.org/10.24433/CO.7654321.v2 " +
        "swh:1:dir:d198bc9d7a6bcf6db04f476d29314f157507d505 https://archive.softwareheritage.org/browse/origin/?origin_url=https://github.com/a/b " +
        "https://huggingface.co/facebook/esm2_t33_650M_UR50D https://huggingface.co/spaces/user/demo https://huggingface.co/docs/transformers",
    );
    expect(out.map((c) => [c.host, c.id])).toEqual([
      ["bitbucket", "lab/pipeline"],
      ["codeberg", "me/tool"],
      ["code_ocean", "capsule.1234567"],
      ["code_ocean", "co.7654321"],
      ["software_heritage", null],
      ["huggingface", "facebook/esm2_t33_650M_UR50D"],
      ["huggingface", "spaces/user/demo"],
      ["software_heritage", "swh:1:dir:d198bc9d7a6bcf6db04f476d29314f157507d505"],
    ]);
  });
});

describe("findLinks: code roles", () => {
  const af2 =
    "Source code for the AlphaFold model, trained weights and inference script are available under an open-source license at https://github.com/deepmind/alphafold. " +
    "Neural networks were developed with TensorFlow v.1 (https://github.com/tensorflow/tensorflow), Sonnet v.1 (https://github.com/deepmind/sonnet). " +
    "For MSA search on BFD+Uniclust30, we used HHBlits and HHSearch from hh-suite v.3.0-beta.3 release 14/07/2017 (https://github.com/soedinglab/hh-suite). " +
    "For MSA search on UniRef90, we used jackhmmer from HMMER v.3.3 (http://eddylab.org/software/hmmer/).";

  it("separates the paper's code from tools it used (AlphaFold 2 code statement)", () => {
    const out = code(af2, { statement: "code", defaultRole: "primary" });
    expect(out.map((c) => [c.id ?? c.url, c.role])).toEqual([
      ["deepmind/alphafold", "primary"],
      ["tensorflow/tensorflow", "mentioned"],
      ["deepmind/sonnet", "mentioned"],
      ["soedinglab/hh-suite", "mentioned"],
      ["http://eddylab.org/software/hmmer/", "mentioned"],
    ]);
    expect(out[0]?.context).toMatch(/^Source code for the AlphaFold model/);
  });

  it("needs a strong cue in body text", () => {
    expect(code("Reads were aligned with BWA (https://github.com/lh3/bwa).")[0]?.role).toBe("mentioned");
    expect(code("Our code is at https://github.com/lab/method.")[0]?.role).toBe("primary");
    expect(code("We release all scripts at https://github.com/lab/method to reproduce the figures.")[0]?.role).toBe("primary");
    // "available at" alone is weak: enough in an abstract, not in a methods paragraph.
    expect(code("Bowtie2 is available at https://github.com/BenLangmead/bowtie2.")[0]?.role).toBe("mentioned");
    expect(code("Bowtie2 is available at https://github.com/BenLangmead/bowtie2.", { defaultRole: "primary" })[0]?.role).toBe("primary");
  });

  it("does not promote unknown hosts in a statement without a strong cue", () => {
    const out = code("Predictions were run in Colab (https://research.google.com/colaboratory).", { statement: "code", defaultRole: "primary" });
    expect(out).toMatchObject([{ host: "other", role: "mentioned" }]);
  });
});

describe("findLinks: data", () => {
  it("finds GEO, SRA, BioProject, ENA, ArrayExpress and EMDB accessions", () => {
    const out = data("RNA-seq data are in GEO (GSE12345; GSE7) and SRA SRP128998, BioProject PRJNA123456, ENA PRJEB40210 / ERR1234567, ArrayExpress E-MTAB-1234, map EMD-12345.");
    expect(out.map((d) => [d.repository, d.id])).toEqual([
      ["geo", "GSE12345"],
      ["sra", "SRP128998"],
      ["sra", "PRJNA123456"],
      ["ena", "PRJEB40210"],
      ["ena", "ERR1234567"],
      ["arrayexpress", "E-MTAB-1234"],
      ["emdb", "EMD-12345"],
    ]);
    expect(out[0]?.url).toBe("https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE12345");
    expect(out.every((d) => d.kind === "accession")).toBe(true);
  });

  it("takes PDB and UniProt IDs only after a keyword", () => {
    const out = data("Structures: PDB IDs 6Y4F, 6YJ1 and 7jtl. UniProt accession P69905. The 2020 cohort had 1234 samples and 4ABC.");
    expect(out.map((d) => `${d.repository}:${d.id}`)).toEqual(["pdb:6Y4F", "pdb:6YJ1", "pdb:7JTL", "uniprot:P69905"]);
    expect(data("deposited in the Protein Data Bank under accession code 7MEZ")[0]?.id).toBe("7MEZ");
    expect(data("PDB 2019 release")).toEqual([]);
  });

  it("reads PDB IDs from DOIs and URLs", () => {
    const out = data("http://doi.org/10.2210/pdb6Y4F/pdb https://www.rcsb.org/structure/1abc https://www.ebi.ac.uk/pdbe/entry/pdb/2xyz");
    expect(out.map((d) => d.id)).toEqual(["6Y4F", "1ABC", "2XYZ"]);
  });

  it("recognizes dataset repositories", () => {
    const out = data(
      "https://zenodo.org/records/5763096 https://figshare.com/articles/dataset/My_data/12345678 https://datadryad.org/stash/dataset/doi:10.5061/dryad.abc123 " +
        "https://osf.io/x7k2m/ https://huggingface.co/datasets/squad/v2 https://www.kaggle.com/datasets/user/set " +
        "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/ABC123 https://data.mendeley.com/datasets/abc123def4/1 " +
        "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE99999",
    );
    expect(out.map((d) => [d.repository, d.id])).toEqual([
      ["zenodo", "zenodo.5763096"],
      ["figshare", "figshare.12345678"],
      ["dryad", "dryad.abc123"],
      ["osf", "x7k2m"],
      ["huggingface", "squad/v2"],
      ["kaggle", "user/set"],
      ["dataverse", "DVN/ABC123"],
      ["mendeley_data", "abc123def4"],
      ["geo", "GSE99999"],
    ]);
  });

  it("dedupes a Zenodo record given as URL, DOI link, bare DOI and badge", () => {
    const out = data(
      "Data: https://doi.org/10.5281/zenodo.123456, also 10.5281/zenodo.123456. [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.123456.svg)](https://doi.org/10.5281/zenodo.123456)",
    );
    expect(out.map((d) => d.id)).toEqual(["zenodo.123456"]);
  });

  it("files Zenodo, Figshare and OSF under code or data by context", () => {
    expect(findLinks("The analysis code is archived at https://doi.org/10.5281/zenodo.111.").code[0]?.id).toBe("zenodo.111");
    expect(findLinks("The raw images are archived at https://doi.org/10.5281/zenodo.222.").data[0]?.id).toBe("zenodo.222");
    expect(findLinks("Deposited in the Zenodo data repository: https://doi.org/10.5281/zenodo.333").data[0]?.id).toBe("zenodo.333");
    expect(findLinks("We used Zenodo to assign a DOI to the repository: https://doi.org/10.5281/zenodo.444").code[0]?.id).toBe("zenodo.444");
    // No cue: the statement decides.
    expect(findLinks("https://osf.io/abcde", { statement: "code" }).code[0]?.id).toBe("abcde");
    expect(findLinks("https://osf.io/abcde").data[0]?.id).toBe("abcde");
  });

  it("keeps unknown URLs only inside a statement", () => {
    const t = "Models are at http://files.ipd.uw.edu/pub/RoseTTAFold/human_prot.tar.gz.";
    expect(findLinks(t).data).toEqual([]);
    expect(findLinks(t, { statement: "data" }).data).toMatchObject([
      { repository: "other", url: "http://files.ipd.uw.edu/pub/RoseTTAFold/human_prot.tar.gz", kind: "link" },
    ]);
    expect(findLinks("https://creativecommons.org/licenses/by/4.0/ https://orcid.org/0000-0001-6169-6580", { statement: "data" }).data).toEqual([]);
  });

  it("does not take arXiv DOIs or unknown DOIs outside statements", () => {
    expect(findLinks("See 10.48550/arXiv.1706.03762 and 10.1038/nature14539.")).toEqual({ code: [], data: [] });
  });

  it("survives zero-width spaces and soft hyphens inside URLs", () => {
    expect(code("https://git​hub.com/org/re­po")[0]?.id).toBe("org/repo");
  });

  it("returns empty lists for empty input", () => {
    expect(findLinks("")).toEqual({ code: [], data: [] });
  });
});
