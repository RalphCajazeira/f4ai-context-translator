import { Router } from "express"
import { all, run } from "../db.js"

export const blacklistRouter = Router()

// GET /api/blacklist → lista todos os termos
blacklistRouter.get("/", async (req, res) => {
  const rows = await all(
    "SELECT id, term, notes, created_at FROM blacklist ORDER BY term COLLATE NOCASE ASC"
  )
  return res.json(rows || [])
})

// POST /api/blacklist → adiciona um termo
blacklistRouter.post("/", async (req, res) => {
  const { term, notes = "" } = req.body || {}
  const t = String(term || "").trim()
  if (!t) return res.status(400).json({ error: "term é obrigatório" })
  try {
    await run("INSERT OR IGNORE INTO blacklist (term, notes) VALUES (?, ?)", [
      t,
      String(notes || ""),
    ])
    const rows = await all(
      "SELECT id, term, notes, created_at FROM blacklist WHERE term = ?",
      [t]
    )
    return res.status(201).json(rows?.[0] || { ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message || "insert failed" })
  }
})

// DELETE /api/blacklist/:id → remove um termo
blacklistRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: "id inválido" })
  try {
    await run("DELETE FROM blacklist WHERE id = ?", [id])
    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: e.message || "delete failed" })
  }
})

export default blacklistRouter
