import { prisma } from "@/database/prisma.js"
import { AppError } from "@/utils/app-error.js"
import { serializeGlossaryEntry } from "@/utils/serializers.js"
import {
  buildSearchVector,
  normalizeNullable,
  normalizeSearchTerm,
} from "@/utils/search.js"

function clampLimit(raw, fallback = 25) {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 50)
}

function parsePage(raw) {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 1
  return parsed
}

class GlossaryController {
  async index(request, response) {
    const { game, mod, q = "", page = "1", limit = "25" } = request.query

    const filters = []

    const gameFilter = normalizeNullable(game)
    if (gameFilter) filters.push({ OR: [{ game: gameFilter }, { game: null }] })
    const modFilter = normalizeNullable(mod)
    if (modFilter) filters.push({ OR: [{ mod: modFilter }, { mod: null }] })

    const searchTerm = normalizeSearchTerm(q)
    if (searchTerm) {
      filters.push({ searchText: { contains: searchTerm } })
    }

    const perPage = clampLimit(limit)
    const currentPage = parsePage(page)
    const where = filters.length ? { AND: filters } : undefined

    const [total, entries] = await Promise.all([
      prisma.glossaryEntry.count({ where }),
      prisma.glossaryEntry.findMany({
        where,
        orderBy: { termSource: "asc" },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
    ])

    return response.json({
      items: entries.map(serializeGlossaryEntry),
      meta: {
        total,
        page: currentPage,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage) || 1),
      },
    })
  }

  async create(request, response) {
    const {
      term_source,
      term_target,
      notes = null,
      game = null,
      mod = null,
      approved = true,
    } = request.body || {}

    if (!term_source || !term_target) {
      throw new AppError("term_source e term_target são obrigatórios", 400)
    }

    const normalizedGame = typeof game === "string" ? game.trim() : ""
    const normalizedMod = typeof mod === "string" ? mod.trim() : ""

    if (!normalizedGame || !normalizedMod) {
      throw new AppError("game e mod são obrigatórios", 400)
    }

    const entry = await prisma.glossaryEntry.create({
      data: {
        termSource: term_source,
        termTarget: term_target,
        notes,
        game: normalizedGame,
        mod: normalizedMod,
        approved: Boolean(approved),
        searchText: buildSearchVector(
          term_source,
          term_target,
          notes,
          normalizedGame,
          normalizedMod
        ),
      },
    })

    return response.status(201).json(serializeGlossaryEntry(entry))
  }

  async update(request, response) {
    const id = Number(request.params.id)
    if (!id) {
      throw new AppError("ID inválido", 400)
    }

    const { term_source, term_target, notes, game, mod, approved } =
      request.body || {}

    const updates = {}
    if (term_source !== undefined) {
      const trimmed = String(term_source || "").trim()
      if (!trimmed) {
        throw new AppError("term_source não pode ser vazio", 400)
      }
      updates.termSource = trimmed
    }

    if (term_target !== undefined) {
      const trimmed = String(term_target || "").trim()
      if (!trimmed) {
        throw new AppError("term_target não pode ser vazio", 400)
      }
      updates.termTarget = trimmed
    }
    if (notes !== undefined) updates.notes = notes
    if (game !== undefined) {
      const trimmed = String(game || "").trim()
      if (!trimmed) {
        throw new AppError("game é obrigatório", 400)
      }
      updates.game = trimmed
    }
    if (mod !== undefined) {
      const trimmed = String(mod || "").trim()
      if (!trimmed) {
        throw new AppError("mod é obrigatório", 400)
      }
      updates.mod = trimmed
    }
    if (approved !== undefined) updates.approved = Boolean(approved)

    if (!Object.keys(updates).length) {
      throw new AppError("Nenhum campo para atualizar", 400)
    }

    const current = await prisma.glossaryEntry.findUnique({ where: { id } })
    if (!current) {
      throw new AppError("Registro não encontrado", 404)
    }

    const nextSource =
      term_source !== undefined
        ? String(term_source || "").trim()
        : current.termSource
    const nextTarget =
      term_target !== undefined
        ? String(term_target || "").trim()
        : current.termTarget
    const nextNotes =
      notes !== undefined ? (notes === null ? null : notes) : current.notes
    const nextGame =
      game !== undefined ? String(game || "").trim() : current.game ?? null
    const nextMod =
      mod !== undefined ? String(mod || "").trim() : current.mod ?? null

    try {
      const entry = await prisma.glossaryEntry.update({
        where: { id },
        data: {
          ...updates,
          game: nextGame,
          mod: nextMod,
          searchText: buildSearchVector(
            nextSource,
            nextTarget,
            nextNotes ?? "",
            nextGame ?? "",
            nextMod ?? ""
          ),
        },
      })
      return response.json(serializeGlossaryEntry(entry))
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Registro não encontrado", 404)
      }
      throw error
    }
  }

  async delete(request, response) {
    const id = Number(request.params.id)
    if (!id) {
      throw new AppError("ID inválido", 400)
    }

    try {
      await prisma.glossaryEntry.delete({ where: { id } })
      return response.json({ ok: true })
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Registro não encontrado", 404)
      }
      throw error
    }
  }
}

export { GlossaryController }
