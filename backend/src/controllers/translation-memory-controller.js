import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeTranslationMemory } from "@/utils/serializers.js";

function norm(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function clampLimit(raw, fallback = 25) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 50);
}

function parsePage(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 1;
  return parsed;
}

function normalizeNullable(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function buildLanguageFilter(field, lang) {
  const trimmed = normalizeNullable(lang) ?? "";
  return {
    OR: [{ [field]: trimmed }, { [field]: "" }],
  };
}

function buildOptionalFilter(field, value) {
  const normalized = normalizeNullable(value);
  if (normalized == null) return undefined;
  return {
    OR: [{ [field]: normalized }, { [field]: null }],
  };
}

class TranslationMemoryController {
  async index(request, response) {
    const { q, limit, src, tgt, game, mod, page = "1" } = request.query;
    const take = clampLimit(limit ?? 50, 50);
    const currentPage = parsePage(page);

    response.set("Cache-Control", "no-store");

    const filters = [];

    if (q) {
      filters.push({
        sourceNorm: {
          contains: norm(q),
        },
      });
    }

    if (src) filters.push({ srcLang: src });
    if (tgt) filters.push({ tgtLang: tgt });

    const gameFilter = normalizeNullable(game);
    if (gameFilter) {
      filters.push({ OR: [{ game: gameFilter }, { game: null }] });
    }

    const modFilter = normalizeNullable(mod);
    if (modFilter) {
      filters.push({ OR: [{ mod: modFilter }, { mod: null }] });
    }

    const where = filters.length ? { AND: filters } : {};

    const [total, rows] = await Promise.all([
      prisma.translationMemoryEntry.count({ where }),
      prisma.translationMemoryEntry.findMany({
        where,
        orderBy: { lastUsedAt: "desc" },
        skip: (currentPage - 1) * take,
        take,
      }),
    ]);

    return response.json({
      items: rows.map(serializeTranslationMemory),
      meta: {
        total,
        page: currentPage,
        per_page: take,
        total_pages: Math.max(1, Math.ceil(total / take) || 1),
      },
    });
  }

  async create(request, response) {
    const {
      source_text,
      target_text,
      quality = 0.9,
      src_lang,
      tgt_lang,
      game = null,
      mod = null,
    } = request.body || {};

    if (!source_text || !target_text) {
      throw new AppError("source_text e target_text são obrigatórios", 400);
    }

    const sourceNorm = norm(source_text);
    const srcLang = normalizeNullable(src_lang) ?? "";
    const tgtLang = normalizeNullable(tgt_lang) ?? "";
    const gameValue = normalizeNullable(game);
    const modValue = normalizeNullable(mod);

    const existing = await prisma.translationMemoryEntry.findFirst({
      where: {
        sourceNorm,
        AND: [
          buildLanguageFilter("srcLang", srcLang),
          buildLanguageFilter("tgtLang", tgtLang),
          buildOptionalFilter("game", gameValue),
          buildOptionalFilter("mod", modValue),
        ].filter(Boolean),
      },
    });

    if (existing) {
      const updated = await prisma.translationMemoryEntry.update({
        where: { id: existing.id },
        data: {
          targetText: target_text,
          quality: typeof quality === "number" ? quality : Number(quality) || 0.9,
          uses: { increment: 1 },
          srcLang: existing.srcLang || srcLang,
          tgtLang: existing.tgtLang || tgtLang,
          game: existing.game ?? gameValue,
          mod: existing.mod ?? modValue,
          lastUsedAt: new Date(),
        },
      });

      return response.json({
        ok: true,
        row: serializeTranslationMemory(updated),
        upsert: "update",
      });
    }

    const created = await prisma.translationMemoryEntry.create({
      data: {
        sourceNorm,
        targetText: target_text,
        quality: typeof quality === "number" ? quality : Number(quality) || 0.9,
        srcLang,
        tgtLang,
        game: gameValue,
        mod: modValue,
      },
    });

    return response.json({
      ok: true,
      row: serializeTranslationMemory(created),
      upsert: "insert",
    });
  }

  async update(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const {
      source_text,
      target_text,
      quality,
      src_lang,
      tgt_lang,
      game,
      mod,
    } = request.body || {};

    try {
      const entry = await prisma.translationMemoryEntry.update({
        where: { id },
        data: {
          sourceNorm: source_text !== undefined ? norm(source_text) : undefined,
          targetText: target_text,
          quality: quality !== undefined ? Number(quality) : undefined,
          srcLang: src_lang !== undefined ? normalizeNullable(src_lang) ?? "" : undefined,
          tgtLang: tgt_lang !== undefined ? normalizeNullable(tgt_lang) ?? "" : undefined,
          game: game !== undefined ? normalizeNullable(game) : undefined,
          mod: mod !== undefined ? normalizeNullable(mod) : undefined,
          lastUsedAt: new Date(),
        },
      });

      return response.json({
        ok: true,
        row: serializeTranslationMemory(entry),
      });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("TM não encontrado", 404);
      }
      throw error;
    }
  }

  async delete(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    try {
      await prisma.translationMemoryEntry.delete({ where: { id } });
      return response.json({ ok: true, id });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("TM não encontrado", 404);
      }
      throw error;
    }
  }
}

export { TranslationMemoryController };
