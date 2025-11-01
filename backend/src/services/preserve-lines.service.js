import {
  translateWithContext,
  forceTranslateWithOllama,
} from "@/services/mt-client.service.js";
import { promoteViaTm } from "@/services/tm.service.js";

function normalizeForCompare(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function translatePreservingLines({
  text,
  src,
  tgt,
  shots,
  glossary,
  contextBlock = "",
  noTranslate = [],
  tmPairs = [],
  tmConfig = {},
}) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  const cache = new Map();
  const {
    fuzzyPromoteMin = 0.92,
    maxLenDelta = 0.1,
    requirePatch = true,
  } = tmConfig || {};
  for (const ln of lines) {
    if (ln.trim() === "") {
      out.push("");
      continue;
    }

    if (cache.has(ln)) {
      out.push(cache.get(ln));
      continue;
    }

    const tmResult = promoteViaTm({
      text: ln,
      tmPairs,
      fuzzyPromoteMin,
      maxLenDelta,
      requirePatch,
    });
    if (tmResult?.translation) {
      cache.set(ln, tmResult.translation);
      out.push(tmResult.translation);
      continue;
    }

    const promptLine =
      (contextBlock ? contextBlock + "\n\n" : "") +
      `Traduza LITERALMENTE para ${tgt}. Responda só a tradução desta linha, sem explicações, sem aspas:\n${ln}`;

    try {
      let clean = await translateWithContext({
        text: promptLine,
        src,
        tgt,
        shots,
        glossary,
        noTranslate,
      });
      clean = String(clean || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i, "")
        .replace(
          /^(?:en|english)\s*:\s*[^\n]*\n\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i,
          ""
        )
        .replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/i, "$1")
        .trimEnd();

      if (normalizeForCompare(clean) === normalizeForCompare(ln)) {
        const forced = await forceTranslateWithOllama(ln, src, tgt);
        if (normalizeForCompare(forced) !== normalizeForCompare(ln)) clean = forced;
      }
      cache.set(ln, clean);
      out.push(clean);
    } catch {
      try {
        const forced = (await forceTranslateWithOllama(ln, src, tgt)) || ln;
        cache.set(ln, forced);
        out.push(forced);
      } catch {
        out.push(ln);
      }
    }
  }
  return out.join("\n");
}

export { translatePreservingLines };
