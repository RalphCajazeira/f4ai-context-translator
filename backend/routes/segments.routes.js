import { Router } from "express"
import { all, run, get } from "../db.js"
export const segmentsRouter = Router()
segmentsRouter.post("/", async (req, res) => {
  const { file, context, source_text } = req.body || {}
  if (!source_text)
    return res.status(400).json({ error: "source_text é obrigatório" })
  const info = await run(
    "INSERT INTO segments (file, context, source_text) VALUES (?, ?, ?)",
    [file || null, context || null, source_text]
  )
  res.json({ id: info.lastID })
})
segmentsRouter.get("/", async (req, res) => {
  const rows = await all("SELECT * FROM segments ORDER BY id ASC LIMIT 200")
  res.json(rows)
})
segmentsRouter.put("/:id", async (req, res) => {
  const { id } = req.params
  const { target_text, status } = req.body || {}
  const row = await get("SELECT * FROM segments WHERE id=?", [id])
  if (!row) return res.status(404).json({ error: "Segmento não encontrado" })
  await run(
    "UPDATE segments SET target_text = ?, status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [target_text || null, status || null, id]
  )
  res.json({ ok: true })
})
