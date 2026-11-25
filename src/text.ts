const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
};

/** Decode the XML/HTML entities that show up in Crossref, arXiv and JATS text. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Remove tags, decode entities and collapse whitespace. */
export function stripTags(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]+>/g, " ")));
}

/** Collapse runs of whitespace (and drop zero-width characters and soft hyphens). */
export function collapse(s: string): string {
  return s
    .replace(/[​-‍⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const v = env?.[name];
  return v && v.trim() ? v.trim() : undefined;
}
