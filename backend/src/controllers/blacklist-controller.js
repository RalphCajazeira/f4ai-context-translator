import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeBlacklistEntry } from "@/utils/serializers.js";

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

class BlacklistController {
  async index(request, response) {
    const { game, mod, q = "", page = "1", limit = "25" } = request.query;

    const filters = [];

    if (game) filters.push({ OR: [{ game }, { game: null }] });
    if (mod) filters.push({ OR: [{ mod }, { mod: null }] });
    if (q) {
      filters.push({
        OR: [
          { term: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
          { game: { contains: q, mode: "insensitive" } },
          { mod: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    const perPage = clampLimit(limit);
    const currentPage = parsePage(page);
    const where = filters.length ? { AND: filters } : undefined;

    const [total, rows] = await Promise.all([
      prisma.blacklistEntry.count({ where }),
      prisma.blacklistEntry.findMany({
        where,
        orderBy: { term: "asc" },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
    ]);

    return response.json({
      items: rows.map(serializeBlacklistEntry),
      meta: {
        total,
        page: currentPage,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage) || 1),
      },
    });
  }

  async create(request, response) {
    const { term, notes = "", game = null, mod = null } = request.body || {};
    const normalized = String(term || "").trim();

    if (!normalized) {
      throw new AppError("term é obrigatório", 400);
    }

    const normalizedGame = typeof game === "string" ? game.trim() : "";
    const normalizedMod = typeof mod === "string" ? mod.trim() : "";

    if (!normalizedGame || !normalizedMod) {
      throw new AppError("game e mod são obrigatórios", 400);
    }

    const entry = await prisma.blacklistEntry.upsert({
      where: { term: normalized },
      update: {
        notes,
        game: normalizedGame,
        mod: normalizedMod,
      },
      create: {
        term: normalized,
        notes,
        game: normalizedGame,
        mod: normalizedMod,
      },
    });

    return response.status(201).json(serializeBlacklistEntry(entry));
  }

  async update(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const { term, notes, game, mod } = request.body || {};

    const data = {};

    if (term !== undefined) {
      const normalizedTerm = String(term || "").trim();
      if (!normalizedTerm) {
        throw new AppError("term não pode ser vazio", 400);
      }
      data.term = normalizedTerm;
    }

    if (notes !== undefined) {
      data.notes = notes;
    }

    if (game !== undefined) {
      const normalizedGame = String(game || "").trim();
      if (!normalizedGame) {
        throw new AppError("game é obrigatório", 400);
      }
      data.game = normalizedGame;
    }

    if (mod !== undefined) {
      const normalizedMod = String(mod || "").trim();
      if (!normalizedMod) {
        throw new AppError("mod é obrigatório", 400);
      }
      data.mod = normalizedMod;
    }

    if (!Object.keys(data).length) {
      throw new AppError("Nada para atualizar", 400);
    }

    try {
      const entry = await prisma.blacklistEntry.update({
        where: { id },
        data,
      });
      return response.json(serializeBlacklistEntry(entry));
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Registro não encontrado", 404);
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
      await prisma.blacklistEntry.delete({ where: { id } });
      return response.json({ ok: true });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Registro não encontrado", 404);
      }
      throw error;
    }
  }
}

export { BlacklistController };
