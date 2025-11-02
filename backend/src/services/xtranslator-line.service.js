import { translateWithContext } from "@/services/mt-client.service.js";

function splitByTags(line = "") {
  return String(line).split(/(<[^>]+>)/g);
}

function splitByBrackets(segment = "") {
  return String(segment).split(/(\[[^\]]+\])/g);
}

function isTag(segment = "") {
  return /^<[^>]+>$/.test(segment);
}

function isBracket(segment = "") {
  return /^\[[^\]]+\]$/.test(segment);
}

function separateWhitespace(segment = "") {
  const value = String(segment);
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const start = leading.length;
  const end = value.length - trailing.length;
  const core = value.slice(start, end);
  return { leading, core, trailing };
}

async function translateTextualSegment(segment = "", options = {}) {
  const { segmentCache } = options;
  const cached = segmentCache?.get(segment);
  if (cached !== undefined) return cached;

  const { leading, core, trailing } = separateWhitespace(segment);
  if (!core) {
    if (segmentCache) segmentCache.set(segment, segment);
    return segment;
  }

  const payload = {
    text: core,
    src: options.src,
    tgt: options.tgt,
    shots: options.shots,
    glossary: options.glossary,
    noTranslate: options.noTranslate,
    backend: options.backend,
  };

  let translatedCore = core;
  try {
    const raw = await translateWithContext(payload);
    let normalized = typeof raw === "string" ? raw.replace(/\r\n/g, "\n") : "";
    if (normalized.includes("\n")) {
      if (segmentCache) segmentCache.set(segment, segment);
      return segment;
    }
    normalized = normalized.trim();
    if (!normalized) {
      normalized = core;
    }
    translatedCore = normalized;
  } catch (error) {
    translatedCore = core;
  }

  const rebuilt = `${leading}${translatedCore}${trailing}`;
  if (segmentCache) segmentCache.set(segment, rebuilt);
  return rebuilt;
}

async function translateLinePreservingMarkers(line = "", options = {}) {
  const parts = splitByTags(line);
  const rebuilt = [];
  for (const part of parts) {
    if (!part) {
      rebuilt.push(part);
      continue;
    }
    if (isTag(part)) {
      rebuilt.push(part);
      continue;
    }
    const innerParts = splitByBrackets(part);
    const innerRebuilt = [];
    for (const piece of innerParts) {
      if (!piece) {
        innerRebuilt.push(piece);
        continue;
      }
      if (isBracket(piece)) {
        innerRebuilt.push(piece);
        continue;
      }
      const translatedPiece = await translateTextualSegment(piece, options);
      innerRebuilt.push(translatedPiece);
    }
    rebuilt.push(innerRebuilt.join(""));
  }
  return rebuilt.join("");
}

async function translateTextPreservingStructure(text = "", options = {}) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const outputs = [];
  const lineCache = options.lineCache ?? new Map();
  const baseOptions = { ...options };
  baseOptions.segmentCache = options.segmentCache ?? new Map();

  for (const line of lines) {
    if (lineCache.has(line)) {
      outputs.push(lineCache.get(line));
      continue;
    }
    if (!line.trim()) {
      lineCache.set(line, line);
      outputs.push(line);
      continue;
    }
    const translated = await translateLinePreservingMarkers(line, baseOptions);
    lineCache.set(line, translated);
    outputs.push(translated);
  }

  return outputs.join("\n");
}

export { translateTextPreservingStructure };
