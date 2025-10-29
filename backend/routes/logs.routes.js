import { Router } from "express"
import { all, run, get } from "../db.js"
import { recordApproval } from "../services/suggest.service.js"

export const logsRouter = Router()

// Helper: sem cache em listagens
function noStore(res) {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  )
  res.set("Pragma", "no-cache")
  res.set("Expires", "0")
}

/**
 * GET /api/logs?status=pending|approved|rejected&limit=200&all=1
 */
logsRouter.get("/", async (req, res) => {
  noStore(res)
  const { status, limit, all: allFlag } = req.query
  const lim = Math.min(Number(limit) || 200, 1000)

  let where = "approved = 0" // default: pendentes
  if (status === "approved") where = "approved = 1"
  if (status === "rejected") where = "approved = -1"
  if (allFlag === "1") where = "1=1"

  const rows = await all(
    `SELECT * FROM translation_logs WHERE ${where} ORDER BY created_at DESC LIMIT ${lim}`
  )
  res.json(rows)
})

/**
 * PATCH /api/logs/:id
 * body: { target_text?: string, source_text?: string }
 * - atualiza o item do log (não aprova)
 */
logsRouter.patch("/:id", async (req, res) => {
  const { id } = req.params
  const { target_text, source_text } = req.body || {}
  if (target_text == null && source_text == null) {
    return res.status(400).json({ error: "Nada para atualizar" })
  }

  const sets = []
  const params = []
  if (source_text != null) {
    sets.push("source_text = ?")
    params.push(source_text)
  }
  if (target_text != null) {
    sets.push("target_text = ?")
    params.push(target_text)
  }

  params.push(id)
  const info = await run(
    `UPDATE translation_logs SET ${sets.join(
      ", "
    )}, created_at = created_at WHERE id = ?`,
    params
  )
  if (!info || info.changes === 0) {
    return res.status(404).json({ error: "Log não encontrado para editar" })
  }
  const row = await get("SELECT * FROM translation_logs WHERE id = ?", [id])
  res.json({ ok: true, row })
})

/**
 * POST /api/logs/:id/approve
 * body: { target_text?: string, source_text?: string }
 * - aprova o log (approved = 1) e grava na TM
 */
logsRouter.post("/:id/approve", async (req, res) => {
  const { id } = req.params
  const { target_text, source_text } = req.body || {}

  const row = await get("SELECT * FROM translation_logs WHERE id = ?", [id])
  if (!row) return res.status(404).json({ error: "Log não encontrado" })

  const src = (source_text != null ? source_text : row.source_text) || ""
  const tgt = (target_text != null ? target_text : row.target_text) || ""

  await recordApproval(src, tgt)
  const info = await run(
    "UPDATE translation_logs SET source_text = ?, target_text = ?, approved = 1 WHERE id = ?",
    [src, tgt, id]
  )
  if (!info || info.changes === 0) {
    return res
      .status(409)
      .json({ error: "Não foi possível aprovar (concorrência?)" })
  }
  const updated = await get("SELECT * FROM translation_logs WHERE id = ?", [id])
  res.json({ ok: true, row: updated })
})

/**
 * POST /api/logs/:id/reject
 * - marca como reprovado (approved = -1)
 */
logsRouter.post("/:id/reject", async (req, res) => {
  const { id } = req.params
  const info = await run(
    "UPDATE translation_logs SET approved = -1 WHERE id = ?",
    [id]
  )
  if (!info || info.changes === 0) {
    return res.status(404).json({ error: "Log não encontrado para reprovar" })
  }
  const updated = await get("SELECT * FROM translation_logs WHERE id = ?", [id])
  res.json({ ok: true, row: updated })
})

/**
 * DELETE /api/logs/:id
 * - remove o item do log (não mexe na TM)
 */
logsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params
  const info = await run("DELETE FROM translation_logs WHERE id = ?", [id])
  if (!info || info.changes === 0) {
    return res.status(404).json({ error: "Log não encontrado para excluir" })
  }
  res.json({ ok: true, id: Number(id) })
})
