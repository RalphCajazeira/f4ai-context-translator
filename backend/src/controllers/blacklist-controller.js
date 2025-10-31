import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeBlacklistEntry } from "@/utils/serializers.js";

class BlacklistController {
  async index(request, response) {
    const { game, mod } = request.query;
    const filters = [];

    if (game) filters.push({ OR: [{ game }, { game: null }] });
    if (mod) filters.push({ OR: [{ mod }, { mod: null }] });

    const rows = await prisma.blacklistEntry.findMany({
      where: filters.length ? { AND: filters } : undefined,
    });

    rows.sort((a, b) =>
      (a.term || "").localeCompare(b.term || "", "pt", { sensitivity: "base" })
    );

    return response.json(rows.map(serializeBlacklistEntry));
  }

  async create(request, response) {
    const { term, notes = "", game = null, mod = null } = request.body || {};
    const normalized = String(term || "").trim();

    if (!normalized) {
      throw new AppError("term é obrigatório", 400);
    }

    const entry = await prisma.blacklistEntry.upsert({
      where: { term: normalized },
      update: {
        notes,
        game: game || null,
        mod: mod || null,
      },
      create: {
        term: normalized,
        notes,
        game: game || null,
        mod: mod || null,
      },
    });

    return response.status(201).json(serializeBlacklistEntry(entry));
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
