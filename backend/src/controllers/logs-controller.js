import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { recordApproval } from "@/services/suggest.service.js";
import { serializeTranslationLog } from "@/utils/serializers.js";

const STATUS_MAP = {
  pending: 0,
  approved: 1,
  rejected: -1,
};

class LogsController {
  async index(request, response) {
    const { status = "pending", limit, all, game, mod } = request.query;
    const take = Math.min(Number(limit) || 200, 1000);

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

    const rows = await prisma.translationLog.findMany({
      where: filters.length ? { AND: filters } : undefined,
      orderBy: { createdAt: "desc" },
      take,
    });

    return response.json(rows.map(serializeTranslationLog));
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
