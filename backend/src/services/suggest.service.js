import { prisma } from "@/database/prisma.js";
import { normalize } from "./normalize.service.js";
import { scoreFuzzy } from "./scoring.service.js";
import { applyCaseLike } from "./case.service.js";

function esc(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

export function buildTmFilters({ srcLang, tgtLang, game, mod }) {
  const filters = [];
  const normalizedSrc = normalizeOptional(srcLang) ?? "";
  const normalizedTgt = normalizeOptional(tgtLang) ?? "";
  const normalizedGame = normalizeOptional(game);
  const normalizedMod = normalizeOptional(mod);

  filters.push({ OR: [{ srcLang: normalizedSrc }, { srcLang: "" }] });
  filters.push({ OR: [{ tgtLang: normalizedTgt }, { tgtLang: "" }] });

  if (normalizedGame !== null) {
    filters.push({ OR: [{ game: normalizedGame }, { game: null }] });
  }

  if (normalizedMod !== null) {
    filters.push({ OR: [{ mod: normalizedMod }, { mod: null }] });
  }

  return filters;
}

export async function topKExamples(srcText, k = 5, options = {}) {
  const srcNorm = normalize(srcText);
  const filters = buildTmFilters(options);

  const rows = await prisma.translationMemoryEntry.findMany({
    where: { AND: [{ sourceNorm: { not: "" } }, ...filters] },
    select: {
      sourceNorm: true,
      targetText: true,
      uses: true,
      quality: true,
    },
    take: 500,
  });

  const scored = rows.map((row) => ({
    ...row,
    score: scoreFuzzy(srcNorm, row.sourceNorm),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((row) => ({ src: row.sourceNorm, tgt: row.targetText }));
}

export async function recordApproval(
  sourceText,
  targetText,
  src = "en",
  tgt = process.env.MT_TGT || "pt-BR",
  metadata = {}
) {
  const srcNorm = normalize(sourceText);
  const srcLang = normalizeOptional(src) ?? "";
  const tgtLang = normalizeOptional(tgt) ?? "";
  const game = normalizeOptional(metadata.game);
  const mod = normalizeOptional(metadata.mod);

  const filters = buildTmFilters({ srcLang, tgtLang, game, mod });

  const existing = await prisma.translationMemoryEntry.findFirst({
    where: {
      sourceNorm: srcNorm,
      AND: filters,
    },
    orderBy: [
      { updatedAt: "desc" },
      { id: "desc" },
    ],
  });

  if (existing) {
    const targetChanged = existing.targetText !== targetText;
    const nextUses = Number(existing.uses || 0) + 1;
    const currentQuality = Number.isFinite(existing.quality)
      ? existing.quality
      : 0.9;
    const nextQuality = targetChanged
      ? 0.92
      : Math.min(1, currentQuality + 0.02);

    await prisma.translationMemoryEntry.update({
      where: { id: existing.id },
      data: {
        targetText,
        uses: nextUses,
        quality: nextQuality,
        srcLang: existing.srcLang || srcLang,
        tgtLang: existing.tgtLang || tgtLang,
        game: existing.game ?? game,
        mod: existing.mod ?? mod,
        lastUsedAt: new Date(),
      },
    });
    return;
  }

  await prisma.translationMemoryEntry.create({
    data: {
      sourceNorm: srcNorm,
      targetText,
      srcLang,
      tgtLang,
      uses: 1,
      quality: 0.92,
      game,
      mod,
    },
  });
}

export async function getGlossary(options = {}) {
  const { game } = options;
  const filters = [{ approved: true }];

  const normalizedGame = normalizeOptional(game);
  if (normalizedGame) {
    filters.push({ OR: [{ game: normalizedGame }, { game: null }] });
  }

  return prisma.glossaryEntry.findMany({
    where: { AND: filters },
    orderBy: { termSource: "asc" },
  });
}

export async function getSuggestions(
  text,
  src = "en",
  tgt = process.env.MT_TGT || "pt-BR",
  topN = 8,
  options = {}
) {
  const original = String(text || "");
  const srcNorm = normalize(original);
  const filters = buildTmFilters({ srcLang: src, tgtLang: tgt, ...options });

  const tmExact = await prisma.translationMemoryEntry.findMany({
    where: {
      sourceNorm: srcNorm,
      AND: filters,
    },
    orderBy: [
      { quality: "desc" },
      { uses: "desc" },
      { updatedAt: "desc" },
    ],
    take: 3,
  });

  const exactHits = tmExact.map((entry) => ({
    text: applyCaseLike(original, entry.targetText),
    score: 0.95 * entry.quality,
    origin: "TM",
  }));

  const tmAll = await prisma.translationMemoryEntry.findMany({
    where: { AND: filters },
    take: 1000,
  });

  const fuzzy = [];
  for (const item of tmAll) {
    const score = scoreFuzzy(srcNorm, item.sourceNorm);
    if (score >= 0.55) {
      fuzzy.push({
        text: applyCaseLike(original, item.targetText),
        score: score * 0.9,
        origin: "Fuzzy",
      });
    }
  }

  const glossaryRows = await getGlossary(options);
  const glossHits = [];
  for (const entry of glossaryRows) {
    const re = new RegExp(`\\b${esc(entry.termSource)}\\b`, "i");
    const match = original.match(re);
    if (match) {
      const projected = applyCaseLike(match[0], entry.termTarget);
      glossHits.push({ text: projected, score: 0.78, origin: "Glossary" });
    }
  }

  const merged = [...exactHits, ...glossHits, ...fuzzy].sort(
    (a, b) => b.score - a.score
  );

  const seen = new Set();
  const unique = [];
  for (const suggestion of merged) {
    const key = (suggestion.text || "").trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(suggestion);
    }
    if (unique.length >= topN) break;
  }

  return unique;
}
