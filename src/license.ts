/**
 * Normalize a license string or URL to a short form: `CC-BY-4.0`, `CC-BY-NC-ND`, `CC0-1.0`, `none`.
 * Returns `null` for anything that is not a Creative Commons or public-domain license
 * (publisher text-and-data-mining licenses are not reuse licenses).
 */
export function normalizeLicense(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const url = s.match(/creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?(\d\.\d)?/);
  if (url) {
    if (url[1] === "publicdomain") return url[2] === "zero" ? `CC0${url[3] ? `-${url[3]}` : ""}` : "PDM";
    return `CC-${url[2]!.toUpperCase()}${url[3] ? `-${url[3]}` : ""}`;
  }
  if (/^(?:cc[_ -]?no|none|no license|all rights reserved)$/.test(s)) return "none";
  if (/^cc[_ -]?0(?:[_ -]?1\.0)?$|^cc[_ -]?zero$/.test(s)) return "CC0-1.0";
  const cc = s.match(/^cc[_ -]?(by(?:[_ -](?:nc|sa|nd))*)(?:[_ -]?(\d\.\d))?$/);
  if (cc) return `CC-${cc[1]!.replace(/[_ ]/g, "-").toUpperCase()}${cc[2] ? `-${cc[2]}` : ""}`;
  return null;
}

/** Canonical URL for a normalized Creative Commons license, when one can be built. */
export function licenseUrl(norm: string | null): string | null {
  if (!norm) return null;
  const m = norm.match(/^CC-(BY(?:-(?:NC|SA|ND))*)-(\d\.\d)$/);
  if (m) return `https://creativecommons.org/licenses/${m[1]!.toLowerCase()}/${m[2]}/`;
  if (norm === "CC0-1.0") return "https://creativecommons.org/publicdomain/zero/1.0/";
  return null;
}
