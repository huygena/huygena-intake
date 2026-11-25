import { decodeEntities } from "./text.js";
import { normalizeLicense } from "./license.js";

export interface JatsDocument {
  /** Code and data availability statements, as plain text with link targets kept inline. */
  statements: { code: string[]; data: string[] };
  /** Body and back matter (without the reference list) as plain text with link targets inline. */
  bodyText: string;
  /** Abstract as plain text. */
  abstract: string | null;
  /** True when the XML has a body (some PMC records only carry front matter). */
  hasBody: boolean;
  license: string | null;
  licenseUrl: string | null;
  openAccess: boolean | null;
}

interface Element {
  name: string;
  attrs: string;
  start: number;
  end: number;
  inner: string;
}

/** Find elements by tag name, handling nesting of the same tag. Small and forgiving; not a full XML parser. */
function elements(xml: string, names: string[]): Element[] {
  const re = new RegExp(`<(\\/?)(${names.join("|")})\\b([^>]*?)(\\/?)>`, "g");
  const stacks = new Map<string, { attrs: string; start: number; innerStart: number }[]>();
  const out: Element[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [, close, name = "", attrs = "", selfClose] = m;
    if (selfClose) continue;
    const stack = stacks.get(name) ?? [];
    stacks.set(name, stack);
    if (!close) {
      stack.push({ attrs, start: m.index, innerStart: m.index + m[0].length });
    } else {
      const open = stack.pop();
      if (open) out.push({ name, attrs: open.attrs, start: open.start, end: m.index + m[0].length, inner: xml.slice(open.innerStart, m.index) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(/[:.-]/g, "\\$&")}\\s*=\\s*"([^"]*)"`, "i"));
  return m?.[1] ?? null;
}

/** JATS fragment to text: drop citations, keep link targets, keep paragraph breaks. */
export function jatsToText(fragment: string): string {
  let s = fragment
    .replace(/<xref\b[^>]*\/>/g, "")
    .replace(/<xref\b[^>]*>[\s\S]*?<\/xref>/g, "")
    .replace(/<sup>\s*(?:[,–-]\s*)*<\/sup>/g, "")
    .replace(/<(ext-link|uri|self-uri)\b([^>]*)>([\s\S]*?)<\/\1>/g, (_m, _t, attrs: string, inner: string) => {
      const href = decodeEntities(attr(attrs, "xlink:href") ?? "").trim();
      const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, "").trim();
      if (!href) return ` ${text} `;
      const h = href.toLowerCase();
      const t = text.toLowerCase();
      if (!t || h.includes(t) || t.includes(h.replace(/^https?:\/\//, ""))) return ` ${href} `;
      return ` ${text} (${href}) `;
    })
    .replace(/<(?:inline-formula|disp-formula|mml:math|tex-math)\b[\s\S]*?<\/(?:inline-formula|disp-formula|mml:math|tex-math)>/g, " ")
    .replace(/<\/(?:p|title|li|list-item|td|th|tr|caption|label|meta-value|license-p|sec)>/g, "\n")
    .replace(/<break\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s).replace(/[​-‍⁠﻿­]/g, "");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").replace(/\s+([,.;:)\]])/g, "$1").replace(/([(\[])\s+/g, "$1").trim())
    .filter(Boolean)
    .join("\n");
}

const AVAIL_TITLE = /\b(?:availability|accessibility|accession (?:codes|numbers)|data deposition|deposited data)\b|^availability of\b/i;

function classifyTitle(title: string, type: string | null): { code: boolean; data: boolean } | null {
  const t = title.replace(/[.:]+$/, "").trim();
  const ty = (type ?? "").toLowerCase();
  const isAvail = AVAIL_TITLE.test(t) || /availability and implementation/i.test(t);
  if (!isAvail && !/availability/.test(ty)) return null;
  let code = /\b(?:code|software|implementation|scripts?)\b/i.test(t);
  let data = /\b(?:data|materials?|accession|deposition|deposited|datasets?)\b/i.test(t);
  if (!code && !data) {
    // Title says only "Availability": fall back to the type attribute, then to both.
    code = /code|software/.test(ty);
    data = /data/.test(ty) || !code;
  }
  return { code, data };
}

/**
 * Pull what a replication agent needs from a JATS article (PMC / Europe PMC full text):
 * availability statements, body text for link scanning, abstract, license and open-access flag.
 */
export function parseJats(xml: string): JatsDocument {
  const statements = { code: [] as string[], data: [] as string[] };
  const seen = new Set<string>();
  const push = (bucket: "code" | "data", text: string) => {
    const key = `${bucket}:${text}`;
    if (!text || seen.has(key)) return;
    // Skip a statement fully contained in one we already have (nested sections).
    if (statements[bucket].some((s) => s.includes(text))) return;
    seen.add(key);
    statements[bucket].push(text);
  };

  for (const el of elements(xml, ["sec", "notes", "fn", "boxed-text", "fn-group"])) {
    const titleM = el.inner.match(/^\s*(?:<label\b[^>]*>[\s\S]*?<\/label>\s*)?<title\b[^>]*>([\s\S]*?)<\/title>/);
    const type = attr(el.attrs, "sec-type") ?? attr(el.attrs, "notes-type") ?? attr(el.attrs, "fn-type") ?? attr(el.attrs, "content-type");
    let title = titleM ? jatsToText(titleM[1] ?? "") : "";
    let body = titleM ? el.inner.slice((titleM.index ?? 0) + titleM[0].length) : el.inner;
    if (!title && el.name === "fn") {
      // <fn><p><bold>Data availability:</bold> ...</p></fn>
      const lead = el.inner.match(/^\s*<p\b[^>]*>\s*<(?:bold|italic)>([\s\S]*?)<\/(?:bold|italic)>/);
      if (lead) {
        title = jatsToText(lead[1] ?? "");
        body = el.inner.replace(lead[0], "<p>");
      }
    }
    if (!title) continue;
    const cls = classifyTitle(title, type);
    if (!cls) continue;
    const text = jatsToText(body);
    if (cls.code) push("code", text);
    if (cls.data) push("data", text);
  }

  // PLOS and others: <custom-meta><meta-name>Data Availability</meta-name><meta-value>…</meta-value></custom-meta>
  for (const el of elements(xml, ["custom-meta"])) {
    const name = el.inner.match(/<meta-name>([\s\S]*?)<\/meta-name>/)?.[1];
    const value = el.inner.match(/<meta-value>([\s\S]*?)<\/meta-value>/)?.[1];
    if (!name || !value) continue;
    const cls = /availability/i.test(name) ? classifyTitle(jatsToText(name), null) : null;
    if (!cls) continue;
    const text = jatsToText(value);
    if (cls.code) push("code", text);
    if (cls.data) push("data", text);
  }

  const body = elements(xml, ["body"])[0]?.inner ?? "";
  const back = (elements(xml, ["back"])[0]?.inner ?? "").replace(/<ref-list\b[\s\S]*?<\/ref-list>/g, "");
  const bodyText = jatsToText(`${body}\n${back}`);

  const abstracts = elements(xml, ["abstract"]).filter((a) => !/abstract-type="(?:graphical|teaser|toc)"/.test(a.attrs));
  const abstract = abstracts[0] ? jatsToText(abstracts[0].inner.replace(/^\s*<title\b[^>]*>[\s\S]*?<\/title>/, "")).replace(/\n/g, " ") : null;

  // License: <license xlink:href=…>, <ali:license_ref>, a CC link in <license-p>, or PMC's custom-meta.
  let license: string | null = null;
  let licUrl: string | null = null;
  let oa: boolean | null = null;
  const selfClosing = [...xml.matchAll(/<license\b([^>]*)\/>/g)].map((m) => ({ attrs: m[1] ?? "", inner: "" }));
  for (const el of [...elements(xml, ["license"]), ...selfClosing]) {
    const href = attr(el.attrs, "xlink:href");
    const ref = el.inner.match(/<ali:license_ref\b[^>]*>([\s\S]*?)<\/ali:license_ref>/)?.[1]?.trim();
    const inText = el.inner.match(/https?:\/\/creativecommons\.org\/[^\s"<]+/)?.[0];
    const type = attr(el.attrs, "license-type");
    for (const cand of [href, ref, inText]) {
      const n = normalizeLicense(cand);
      if (n && !license) {
        license = n;
        licUrl = cand ?? null;
      }
    }
    if (type && /open[- ]?access/i.test(type)) oa = true;
  }
  const pmcLicense = xml.match(/<meta-name>pmc-license-ref<\/meta-name>\s*<meta-value>([^<]*)<\/meta-value>/)?.[1];
  if (!license && pmcLicense) license = normalizeLicense(pmcLicense);
  const pmcOa = xml.match(/<meta-name>pmc-prop-open-access<\/meta-name>\s*<meta-value>([^<]*)<\/meta-value>/)?.[1];
  if (pmcOa) oa = /^yes$/i.test(pmcOa.trim()) ? true : oa ?? false;

  return {
    statements,
    bodyText,
    abstract,
    hasBody: body.trim().length > 0,
    license,
    licenseUrl: licUrl,
    openAccess: oa,
  };
}
