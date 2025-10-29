import { Router } from "express"
import { all, get, run } from "../db.js"

export const tmRouter = Router()

function norm(s = "") {
  return String(s).trim().replace(/\s+/g, " ").toLowerCase()
}

/**
 * GET /api/tm?limit=200&q=texto
 * Lista a memória (tm_entries)
 */
tmRouter.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store")
  const lim = Math.min(Number(req.query.limit) || 200, 1000)
  const q = (req.query.q || "").trim()
  let rows
  if (q) {
    const qn = `%${norm(q)}%`
    rows = await all(
      "SELECT * FROM tm_entries WHERE source_norm LIKE ? ORDER BY last_used_at DESC LIMIT ?",
      [qn, lim]
    )
  } else {
    rows = await all(
      "SELECT * FROM tm_entries ORDER BY last_used_at DESC LIMIT ?",
      [lim]
    )
  }
  res.json(rows)
})

/**
 * POST /api/tm
 * body: { source_text, target_text, quality? }
 * Upsert na TM
 */
tmRouter.post("/", async (req, res) => {
  const { source_text, target_text, quality = 0.9 } = req.body || {}
  if (!source_text || !target_text)
    return res
      .status(400)
      .json({ error: "source_text e target_text são obrigatórios" })
  const source_norm = norm(source_text)

  // tenta atualizar se já existe
  const row = await get("SELECT * FROM tm_entries WHERE source_norm = ?", [
    source_norm,
  ])
  if (row) {
    await run(
      "UPDATE tm_entries SET target_text=?, quality=?, uses=uses+1, last_used_at=CURRENT_TIMESTAMP WHERE id=?",
      [target_text, Number(quality) || 0.9, row.id]
    )
    const updated = await get("SELECT * FROM tm_entries WHERE id=?", [row.id])
    return res.json({ ok: true, row: updated, upsert: "update" })
  } else {
    const info = await run(
      "INSERT INTO tm_entries (source_norm, target_text, uses, quality) VALUES (?, ?, 1, ?)",
      [source_norm, target_text, Number(quality) || 0.9]
    )
    const created = await get("SELECT * FROM tm_entries WHERE id=?", [
      info.lastID,
    ])
    return res.json({ ok: true, row: created, upsert: "insert" })
  }
})

/**
 * PATCH /api/tm/:id
 * body: { source_text?, target_text?, quality? }
 * Edita item da TM
 */
tmRouter.patch("/:id", async (req, res) => {
  const { id } = req.params
  const { source_text, target_text, quality } = req.body || {}
  const cur = await get("SELECT * FROM tm_entries WHERE id=?", [id])
  if (!cur) return res.status(404).json({ error: "TM não encontrado" })

  const source_norm = source_text != null ? norm(source_text) : cur.source_norm
  const tgt = target_text != null ? target_text : cur.target_text
  const ql = quality != null ? Number(quality) : cur.quality

  await run(
    "UPDATE tm_entries SET source_norm=?, target_text=?, quality=?, last_used_at=CURRENT_TIMESTAMP WHERE id=?",
    [source_norm, tgt, ql, id]
  )
  const updated = await get("SELECT * FROM tm_entries WHERE id=?", [id])
  res.json({ ok: true, row: updated })
})

/**
 * DELETE /api/tm/:id
 * Remove item da TM
 */
tmRouter.delete("/:id", async (req, res) => {
  const { id } = req.params
  const info = await run("DELETE FROM tm_entries WHERE id=?", [id])
  if (!info || info.changes === 0)
    return res.status(404).json({ error: "TM não encontrado para excluir" })
  res.json({ ok: true, id: Number(id) })
})
