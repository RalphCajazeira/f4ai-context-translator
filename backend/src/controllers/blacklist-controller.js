import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeBlacklistEntry } from "@/utils/serializers.js";
import {
  buildSearchVector,
  normalizeNullable,
  normalizeSearchTerm,
} from "@/utils/search.js";

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

    const gameFilter = normalizeNullable(game);
    if (gameFilter) filters.push({ OR: [{ game: gameFilter }, { game: null }] });
    const modFilter = normalizeNullable(mod);
    if (modFilter) filters.push({ OR: [{ mod: modFilter }, { mod: null }] });

    const searchTerm = normalizeSearchTerm(q);
    if (searchTerm) {
      filters.push({ searchText: { contains: searchTerm } });
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
        searchText: buildSearchVector(
          normalized,
          notes,
          normalizedGame,
          normalizedMod
        ),
      },
      create: {
        term: normalized,
        notes,
        game: normalizedGame,
        mod: normalizedMod,
        searchText: buildSearchVector(
          normalized,
          notes,
          normalizedGame,
          normalizedMod
        ),
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

    const updates = {};

    if (term !== undefined) {
      const normalizedTerm = String(term || "").trim();
      if (!normalizedTerm) {
        throw new AppError("term não pode ser vazio", 400);
      }
      updates.term = normalizedTerm;
    }

    if (notes !== undefined) {
      updates.notes = notes;
    }

    if (game !== undefined) {
      const normalizedGame = String(game || "").trim();
      if (!normalizedGame) {
        throw new AppError("game é obrigatório", 400);
      }
      updates.game = normalizedGame;
    }

    if (mod !== undefined) {
      const normalizedMod = String(mod || "").trim();
      if (!normalizedMod) {
        throw new AppError("mod é obrigatório", 400);
      }
      updates.mod = normalizedMod;
    }

    if (!Object.keys(updates).length) {
      throw new AppError("Nada para atualizar", 400);
    }

    const current = await prisma.blacklistEntry.findUnique({ where: { id } });
    if (!current) {
      throw new AppError("Registro não encontrado", 404);
    }

    const nextTerm =
      term !== undefined ? String(term || "").trim() : current.term;
    const nextNotes =
      notes !== undefined ? (notes === null ? null : notes) : current.notes;
    const nextGame =
      game !== undefined
        ? String(game || "").trim()
        : current.game ?? null;
    const nextMod =
      mod !== undefined
        ? String(mod || "").trim()
        : current.mod ?? null;

    try {
      const entry = await prisma.blacklistEntry.update({
        where: { id },
        data: {
          ...updates,
          game: nextGame,
          mod: nextMod,
          searchText: buildSearchVector(
            nextTerm,
            nextNotes ?? "",
            nextGame ?? "",
            nextMod ?? ""
          ),
        },
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
