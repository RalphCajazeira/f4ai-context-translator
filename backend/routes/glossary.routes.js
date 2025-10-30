import { Router } from "express"
import { all, run } from "../db.js"

export const glossaryRouter = Router()

// GET /api/glossary → lista tudo (ordenado por term_source)
glossaryRouter.get("/", async (req, res) => {
  const rows = await all(`
    SELECT id, term_source, term_target, notes, game, approved, created_at
    FROM glossary
    ORDER BY term_source COLLATE NOCASE ASC
  `)
  res.json(rows || [])
})

// POST /api/glossary → cria um registro
glossaryRouter.post("/", async (req, res) => {
  const {
    term_source,
    term_target,
    notes = null,
    game = null,
    approved = 1,
  } = req.body || {}

  if (!term_source || !term_target) {
    return res
      .status(400)
      .json({ error: "term_source e term_target são obrigatórios" })
  }

  const info = await run(
    `INSERT INTO glossary (term_source, term_target, notes, game, approved)
     VALUES (?, ?, ?, ?, ?)`,
    [term_source, term_target, notes, game, approved ? 1 : 0]
  )

  const row = await all(
    `SELECT id, term_source, term_target, notes, game, approved, created_at
     FROM glossary WHERE id = ?`,
    [info.lastID]
  )
  res.status(201).json(row?.[0] || { id: info.lastID })
})

// PUT /api/glossary/:id → atualiza (qualquer campo)
glossaryRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: "id inválido" })

  const {
    term_source,
    term_target,
    notes = null,
    game = null,
    approved,
  } = req.body || {}

  // monta SET dinâmico
  const sets = []
  const vals = []
  if (typeof term_source === "string") {
    sets.push("term_source = ?")
    vals.push(term_source)
  }
  if (typeof term_target === "string") {
    sets.push("term_target = ?")
    vals.push(term_target)
  }
  if (notes !== undefined) {
    sets.push("notes = ?")
    vals.push(notes)
  }
  if (game !== undefined) {
    sets.push("game = ?")
    vals.push(game)
  }
  if (approved !== undefined) {
    sets.push("approved = ?")
    vals.push(approved ? 1 : 0)
  }

  if (!sets.length)
    return res.status(400).json({ error: "Nada para atualizar" })

  vals.push(id)
  await run(`UPDATE glossary SET ${sets.join(", ")} WHERE id = ?`, vals)

  const row = await all(
    `SELECT id, term_source, term_target, notes, game, approved, created_at
     FROM glossary WHERE id = ?`,
    [id]
  )
  res.json(row?.[0] || { ok: true })
})

// DELETE /api/glossary/:id → apaga
glossaryRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: "id inválido" })

  await run(`DELETE FROM glossary WHERE id = ?`, [id])
  res.json({ ok: true })
})

export default glossaryRouter
