import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { recordApproval } from "@/services/suggest.service.js";
import { serializeTranslationLog } from "@/utils/serializers.js";

const STATUS_MAP = {
  pending: 0,
  approved: 1,
  rejected: -1,
};

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

class LogsController {
  async index(request, response) {
    const {
      status = "pending",
      limit = "25",
      all,
      game,
      mod,
      q = "",
      page = "1",
    } = request.query;

    response.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");

    const filters = [];
    if (all === "1") {
      // no filter
    } else if (STATUS_MAP[status] !== undefined) {
      filters.push({ approved: STATUS_MAP[status] });
    } else {
      filters.push({ approved: STATUS_MAP.pending });
    }

    if (game) {
      filters.push({ OR: [{ game }, { game: null }] });
    }

    if (mod) {
      filters.push({ OR: [{ mod }, { mod: null }] });
    }

    if (q) {
      filters.push({
        OR: [
          { sourceText: { contains: q, mode: "insensitive" } },
          { targetText: { contains: q, mode: "insensitive" } },
          { origin: { contains: q, mode: "insensitive" } },
          { game: { contains: q, mode: "insensitive" } },
          { mod: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const perPage = clampLimit(limit);
    const currentPage = parsePage(page);
    const where = filters.length ? { AND: filters } : undefined;

    const [total, rows] = await Promise.all([
      prisma.translationLog.count({ where }),
      prisma.translationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
    ]);

    return response.json({
      items: rows.map(serializeTranslationLog),
      meta: {
        total,
        page: currentPage,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage) || 1),
      },
    });
  }

  async update(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const { source_text, target_text, game, mod } = request.body || {};

    const data = {};
    if (source_text !== undefined) data.sourceText = source_text;
    if (target_text !== undefined) data.targetText = target_text;
    if (game !== undefined) data.game = game || null;
    if (mod !== undefined) data.mod = mod || null;

    if (!Object.keys(data).length) {
      throw new AppError("Nada para atualizar", 400);
    }

    try {
      const entry = await prisma.translationLog.update({
        where: { id },
        data,
      });
      return response.json({
        ok: true,
        row: serializeTranslationLog(entry),
      });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404);
      }
      throw error;
    }
  }

  async approve(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const { source_text, target_text, game, mod } = request.body || {};

    const log = await prisma.translationLog.findUnique({ where: { id } });
    if (!log) {
      throw new AppError("Log não encontrado", 404);
    }

    const sourceText = source_text ?? log.sourceText;
    const targetText = target_text ?? log.targetText;
    const gameValue = game ?? log.game;
    const modValue = mod ?? log.mod;

    await recordApproval(sourceText, targetText, undefined, undefined, {
      game: gameValue,
      mod: modValue,
    });

    const updated = await prisma.translationLog.update({
      where: { id },
      data: {
        sourceText,
        targetText,
        game: gameValue ?? null,
        mod: modValue ?? null,
        approved: STATUS_MAP.approved,
      },
    });

    return response.json({
      ok: true,
      row: serializeTranslationLog(updated),
    });
  }

  async reject(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    try {
      const entry = await prisma.translationLog.update({
        where: { id },
        data: { approved: STATUS_MAP.rejected },
      });
      return response.json({
        ok: true,
        row: serializeTranslationLog(entry),
      });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404);
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
      await prisma.translationLog.delete({ where: { id } });
      return response.json({ ok: true, id });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404);
      }
      throw error;
    }
  }
}

export { LogsController };
