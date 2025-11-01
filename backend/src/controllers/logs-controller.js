import { prisma } from "@/database/prisma.js"
import { AppError } from "@/utils/app-error.js"
import { recordApproval } from "@/services/suggest.service.js"
import { serializeTranslationLog } from "@/utils/serializers.js"
import {
  buildSearchVector,
  normalizeNullable,
  normalizeSearchTerm,
} from "@/utils/search.js"

const STATUS_MAP = {
  pending: 0,
  approved: 1,
  rejected: -1,
}

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
    } = request.query

    response.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    )
    response.set("Pragma", "no-cache")
    response.set("Expires", "0")

    const filters = []
    if (all === "1") {
      // no filter
    } else if (STATUS_MAP[status] !== undefined) {
      filters.push({ approved: STATUS_MAP[status] })
    } else {
      filters.push({ approved: STATUS_MAP.pending })
    }

    const gameFilter = normalizeNullable(game)
    if (gameFilter) {
      filters.push({ OR: [{ game: gameFilter }, { game: null }] })
    }

    const modFilter = normalizeNullable(mod)
    if (modFilter) {
      filters.push({ OR: [{ mod: modFilter }, { mod: null }] })
    }

    const rawSearch = String(q ?? "").trim()
    const searchTerm = normalizeSearchTerm(q)
    if (searchTerm) {
      const orFilters = [{ searchText: { contains: searchTerm } }]
      if (rawSearch) {
        const caseVariants = new Set([
          rawSearch,
          rawSearch.toLowerCase(),
          rawSearch.toUpperCase(),
          rawSearch[0]
            ? rawSearch[0].toUpperCase() + rawSearch.slice(1).toLowerCase()
            : rawSearch,
        ])

        for (const variant of caseVariants) {
          orFilters.push({ sourceText: { contains: variant } })
          orFilters.push({ targetText: { contains: variant } })
        }
      }
      filters.push({ OR: orFilters })
    }

    const perPage = clampLimit(limit)
    const currentPage = parsePage(page)
    const where = filters.length ? { AND: filters } : undefined

    const [total, rows] = await Promise.all([
      prisma.translationLog.count({ where }),
      prisma.translationLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (currentPage - 1) * perPage,
        take: perPage,
      }),
    ])

    return response.json({
      items: rows.map(serializeTranslationLog),
      meta: {
        total,
        page: currentPage,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage) || 1),
      },
    })
  }

  async update(request, response) {
    const id = Number(request.params.id)
    if (!id) {
      throw new AppError("ID inválido", 400)
    }

    const { source_text, target_text, game, mod } = request.body || {}

    const changes = {}
    if (source_text !== undefined) changes.sourceText = String(source_text)
    if (target_text !== undefined) changes.targetText = String(target_text)
    if (game !== undefined) changes.game = normalizeNullable(game)
    if (mod !== undefined) changes.mod = normalizeNullable(mod)

    if (!Object.keys(changes).length) {
      throw new AppError("Nada para atualizar", 400)
    }

    const current = await prisma.translationLog.findUnique({ where: { id } })
    if (!current) {
      throw new AppError("Log não encontrado", 404)
    }

    const nextSource =
      source_text !== undefined ? String(source_text) : current.sourceText
    const nextTarget =
      target_text !== undefined ? String(target_text) : current.targetText
    const nextGame =
      game !== undefined ? normalizeNullable(game) : current.game ?? null
    const nextMod =
      mod !== undefined ? normalizeNullable(mod) : current.mod ?? null

    try {
      const entry = await prisma.translationLog.update({
        where: { id },
        data: {
          ...changes,
          game: nextGame,
          mod: nextMod,
          searchText: buildSearchVector(
            nextSource,
            nextTarget,
            current.origin,
            nextGame ?? "",
            nextMod ?? ""
          ),
        },
      })
      return response.json({
        ok: true,
        row: serializeTranslationLog(entry),
      })
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404)
      }
      throw error
    }
  }

  async approve(request, response) {
    const id = Number(request.params.id)
    if (!id) {
      throw new AppError("ID inválido", 400)
    }

    const { source_text, target_text, game, mod } = request.body || {}

    const log = await prisma.translationLog.findUnique({ where: { id } })
    if (!log) {
      throw new AppError("Log não encontrado", 404)
    }

    const sourceText = source_text ?? log.sourceText
    const targetText = target_text ?? log.targetText
    const normalizedGame = normalizeNullable(game)
    const normalizedMod = normalizeNullable(mod)
    const gameValue = normalizedGame ?? log.game
    const modValue = normalizedMod ?? log.mod

    const searchText = buildSearchVector(
      sourceText,
      targetText,
      log.origin,
      gameValue ?? "",
      modValue ?? ""
    )

    await recordApproval(sourceText, targetText, undefined, undefined, {
      game: gameValue,
      mod: modValue,
    })

    const updated = await prisma.translationLog.update({
      where: { id },
      data: {
        sourceText,
        targetText,
        game: gameValue ?? null,
        mod: modValue ?? null,
        approved: STATUS_MAP.approved,
        searchText,
      },
    })

    return response.json({
      ok: true,
      row: serializeTranslationLog(updated),
    })
  }

  async reject(request, response) {
    const id = Number(request.params.id)
    if (!id) {
      throw new AppError("ID inválido", 400)
    }

    try {
      const entry = await prisma.translationLog.update({
        where: { id },
        data: { approved: STATUS_MAP.rejected },
      })
      return response.json({
        ok: true,
        row: serializeTranslationLog(entry),
      })
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404)
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
      await prisma.translationLog.delete({ where: { id } })
      return response.json({ ok: true, id })
    } catch (error) {
      if (error.code === "P2025") {
        throw new AppError("Log não encontrado", 404)
      }
      throw error
    }
  }
}

export { LogsController }
