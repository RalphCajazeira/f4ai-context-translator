import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeSegment } from "@/utils/serializers.js";

class SegmentsController {
  async create(request, response) {
    const { file, context, source_text, game = null, mod = null } =
      request.body || {};

    if (!source_text) {
      throw new AppError("source_text é obrigatório", 400);
    }

    const segment = await prisma.segment.create({
      data: {
        file,
        context,
        sourceText: source_text,
        game,
        mod,
      },
    });

    return response.status(201).json({ id: segment.id });
  }

  async index(request, response) {
    const { limit, game, mod } = request.query;

    const parsedLimit = Number(limit);
    const hasValidLimit = Number.isFinite(parsedLimit) && parsedLimit > 0;
    const desiredLimit = hasValidLimit ? Math.floor(parsedLimit) : 200;
    const take = Math.max(1, Math.min(desiredLimit, 1000));

    const filters = [];
    if (game) filters.push({ OR: [{ game }, { game: null }] });
    if (mod) filters.push({ OR: [{ mod }, { mod: null }] });

    const rows = await prisma.segment.findMany({
      where: filters.length ? { AND: filters } : undefined,
      orderBy: { id: "asc" },
      take,
    });

    return response.json(rows.map(serializeSegment));
  }

  async update(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const { target_text, status, game, mod } = request.body || {};

    try {
      await prisma.segment.update({
        where: { id },
        data: {
          targetText: target_text,
          status,
          game: game !== undefined ? game : undefined,
          mod: mod !== undefined ? mod : undefined,
        },
      });

      return response.json({ ok: true });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Segmento não encontrado", 404);
      }
      throw error;
    }
  }
}

export { SegmentsController };
