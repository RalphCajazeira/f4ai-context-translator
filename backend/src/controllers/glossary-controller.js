import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { serializeGlossaryEntry } from "@/utils/serializers.js";

class GlossaryController {
  async index(request, response) {
    const entries = await prisma.glossaryEntry.findMany();

    entries.sort((a, b) =>
      (a.termSource || "").localeCompare(b.termSource || "", "pt", {
        sensitivity: "base",
      })
    );

    return response.json(entries.map(serializeGlossaryEntry));
  }

  async create(request, response) {
    const {
      term_source,
      term_target,
      notes = null,
      game = null,
      mod = null,
      approved = true,
    } = request.body || {};

    if (!term_source || !term_target) {
      throw new AppError("term_source e term_target são obrigatórios", 400);
    }

    const entry = await prisma.glossaryEntry.create({
      data: {
        termSource: term_source,
        termTarget: term_target,
        notes,
        game,
        mod,
        approved: Boolean(approved),
      },
    });

    return response.status(201).json(serializeGlossaryEntry(entry));
  }

  async update(request, response) {
    const id = Number(request.params.id);
    if (!id) {
      throw new AppError("ID inválido", 400);
    }

    const {
      term_source,
      term_target,
      notes,
      game,
      mod,
      approved,
    } = request.body || {};

    const data = {};
    if (term_source !== undefined) data.termSource = term_source;
    if (term_target !== undefined) data.termTarget = term_target;
    if (notes !== undefined) data.notes = notes;
    if (game !== undefined) data.game = game;
    if (mod !== undefined) data.mod = mod;
    if (approved !== undefined) data.approved = Boolean(approved);

    if (!Object.keys(data).length) {
      throw new AppError("Nenhum campo para atualizar", 400);
    }

    try {
      const entry = await prisma.glossaryEntry.update({
        where: { id },
        data,
      });
      return response.json(serializeGlossaryEntry(entry));
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
      await prisma.glossaryEntry.delete({ where: { id } });
      return response.json({ ok: true });
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Registro não encontrado", 404);
      }
      throw error;
    }
  }
}

export { GlossaryController };
