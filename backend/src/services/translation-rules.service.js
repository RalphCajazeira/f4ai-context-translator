import { translateWithContext } from "@/services/mt-client.service.js";
import {
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "@/services/case.service.js";

function normalizeForTm(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function reEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWBRegex(terms = []) {
  const parts = [
    ...new Set(terms.map((t) => String(t || "").trim()).filter(Boolean)),
  ]
    .sort((a, b) => b.length - a.length)
    .map(reEscape);
  if (!parts.length) return null;
  return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?![\\w-])`, "gi");
}

function pickBlacklistMatches(text, rows) {
  const terms = (rows || []).map((r) => r.term).filter(Boolean);
  const regex = buildWBRegex(terms);
  if (!regex) return [];
  const found = new Set();
  String(text).replace(regex, (m) => {
    found.add(m.toLowerCase());
    return m;
  });
  return terms.filter((term) => found.has(String(term).toLowerCase()));
}

function pickGlossaryMatches(text, rows) {
  const terms = (rows || []).map((r) => r.termSource).filter(Boolean);
  const regex = buildWBRegex(terms);
  if (!regex) return [];
  const seen = new Set();
  const byKey = new Map(
    (rows || []).map((r) => [String(r.termSource).toLowerCase(), r])
  );
  String(text).replace(regex, (m) => {
    seen.add(m.toLowerCase());
    return m;
  });
  return [...seen].map((key) => byKey.get(key)).filter(Boolean);
}

function buildGlossPatterns(glossary = [], noTranslate = []) {
  const blocked = new Set((noTranslate || []).map((t) => String(t).toLowerCase()));
  const rows = (glossary || [])
    .filter((g) => g && g.termSource && g.termTarget && (g.approved ?? 1))
    .filter((g) => !blocked.has(String(g.termSource).toLowerCase()))
    .sort((a, b) => b.termSource.length - a.termSource.length);
  return rows.map((g) => {
    const pattern = `(?<![\\w-])${reEscape(g.termSource)}(?![\\w-])`;
    return { re: new RegExp(pattern, "gi"), target: g.termTarget };
  });
}

function applyGlossaryHardReplace(
  sourceText,
  translatedText,
  glossary,
  noTranslate
) {
  if (!translatedText) return translatedText;
  const patterns = buildGlossPatterns(glossary, noTranslate);
  if (!patterns.length) return translatedText;
  let output = String(translatedText);
  for (const { re, target } of patterns) output = output.replace(re, target);
  return output;
}

function capsOnly(arr) {
  const set = new Set();
  for (const word of arr) {
    if (/\b[\p{Lu}]{2,}\b/u.test(word)) set.add(word);
  }
  return Array.from(set);
}

async function enforceAllCapsTerms({
  original,
  best,
  src,
  tgt,
  shots,
  glossary,
}) {
  let output = String(best || "");
  const caps = extractAllCapsTerms(original);
  if (!caps.length || !output) return output;

  const uniqueCaps = Array.from(new Set(capsOnly(caps)));
  for (const term of uniqueCaps) {
    let translated = "";
    try {
      const promptWord = `Traduza apenas esta palavra (forma básica):\n${term}`;
      translated = await translateWithContext({
        text: promptWord,
        src,
        tgt,
        shots,
        glossary,
      });
      translated = String(translated || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^.*?\n/, "")
        .trim();
    } catch {
      translated = "";
    }
    if (!translated) continue;
    const projected = applyCaseLike(term, translated);
    output = replaceWordUnicode(output, translated, projected);
  }
  return output;
}

function buildContextBlock(matchedGlossary = [], matchedBlacklistRows = []) {
  const lines = [];
  if (matchedBlacklistRows.length) {
    lines.push("### CONTEXTO — BLACKLIST (não traduzir):");
    for (const entry of matchedBlacklistRows) {
      const term = entry.term;
      const notes = (entry.notes || "").trim();
      lines.push(`- ${term}${notes ? ` — ${notes}` : ""}`);
    }
    lines.push("");
  }
  if (matchedGlossary.length) {
    lines.push("### CONTEXTO — GLOSSÁRIO (usar tradução fixa):");
    for (const entry of matchedGlossary) {
      const src = entry.termSource;
      const tgt = entry.termTarget;
      const notes = (entry.notes || "").trim();
      lines.push(`- ${src} → ${tgt}${notes ? ` — ${notes}` : ""}`);
    }
    lines.push("");
  }
  return lines.length ? lines.join("\n") : "";
}

export {
  normalizeForTm,
  buildWBRegex,
  pickBlacklistMatches,
  pickGlossaryMatches,
  buildGlossPatterns,
  applyGlossaryHardReplace,
  enforceAllCapsTerms,
  buildContextBlock,
};
