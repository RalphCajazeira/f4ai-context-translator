import { Router } from "express"
import { all, run } from "../db.js"
import { recordApproval } from "../services/suggest.service.js"

export const logsRouter = Router()

// lista últimos N pendentes (ou todos se incluir ?all=1)
logsRouter.get("/", async (req, res) => {
  const allFlag = req.query.all === "1"
  const rows = allFlag
    ? await all(
        "SELECT * FROM translation_logs ORDER BY created_at DESC LIMIT 500"
      )
    : await all(
        "SELECT * FROM translation_logs WHERE approved = 0 ORDER BY created_at DESC LIMIT 200"
      )
  res.json(rows)
})

// aprova um item do log (grava na TM)
logsRouter.post("/:id/approve", async (req, res) => {
  const { id } = req.params
  const rowArr = await all("SELECT * FROM translation_logs WHERE id = ?", [id])
  const row = rowArr[0]
  if (!row) return res.status(404).json({ error: "Log não encontrado" })

  await recordApproval(row.source_text, row.target_text)
  await run("UPDATE translation_logs SET approved = 1 WHERE id = ?", [id])
  res.json({ ok: true })
})

// reprova (marca como -1)
logsRouter.post("/:id/reject", async (req, res) => {
  const { id } = req.params
  await run("UPDATE translation_logs SET approved = -1 WHERE id = ?", [id])
  res.json({ ok: true })
})
