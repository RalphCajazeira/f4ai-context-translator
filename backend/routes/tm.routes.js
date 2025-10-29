import { Router } from "express";
import { all, get, run } from "../db.js";

export const tmRouter = Router();

function norm(s = "") {
  return String(s).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * GET /api/tm?limit=200&q=texto&src=en&tgt=pt
 * Lista a TM (tm_entries) com filtros opcionais (texto e idiomas).
 */
tmRouter.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");

  const lim = Math.min(Number(req.query.limit) || 200, 1000);
  const q = (req.query.q || "").trim();
  const src = (req.query.src || "").trim();
  const tgt = (req.query.tgt || "").trim();

  const where = [];
  const params = [];

  if (q)   { where.push("source_norm LIKE ?"); params.push(`%${norm(q)}%`); }
  if (src) { where.push("COALESCE(src_lang,'') = ?"); params.push(src); }
  if (tgt) { where.push("COALESCE(tgt_lang,'') = ?"); params.push(tgt); }

  const sql =
    "SELECT * FROM tm_entries" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY last_used_at DESC LIMIT ?";

  params.push(lim);

  const rows = await all(sql, params);
  res.json(rows);
});

/**
 * POST /api/tm
 * body: { source_text, target_text, quality?, src_lang?, tgt_lang? }
 * Upsert na TM por (source_norm + par de idiomas).
 */
tmRouter.post("/", async (req, res) => {
  const {
    source_text,
    target_text,
    quality = 0.9,
    src_lang = process.env.MT_SRC || "en",
    tgt_lang = process.env.MT_TGT || "pt",
  } = req.body || {};

  if (!source_text || !target_text) {
    return res.status(400).json({ error: "source_text e target_text são obrigatórios" });
  }

  const source_norm = norm(source_text);

  // Tenta atualizar se já existe exatamente esse par (frase + idiomas)
  const row = await get(
    "SELECT * FROM tm_entries WHERE source_norm = ? AND COALESCE(src_lang,'') = ? AND COALESCE(tgt_lang,'') = ?",
    [source_norm, src_lang, tgt_lang]
  );

  if (row) {
    await run(
      "UPDATE tm_entries SET target_text=?, quality=?, uses=uses+1, last_used_at=CURRENT_TIMESTAMP WHERE id=?",
      [target_text, Number(quality) || 0.9, row.id]
    );
    const updated = await get("SELECT * FROM tm_entries WHERE id=?", [row.id]);
    return res.json({ ok: true, row: updated, upsert: "update" });
  } else {
    const info = await run(
      "INSERT INTO tm_entries (source_norm, target_text, src_lang, tgt_lang, uses, quality) VALUES (?, ?, ?, ?, 1, ?)",
      [source_norm, target_text, src_lang, tgt_lang, Number(quality) || 0.9]
    );
    const created = await get("SELECT * FROM tm_entries WHERE id=?", [info.lastID]);
    return res.json({ ok: true, row: created, upsert: "insert" });
  }
});

/**
 * PATCH /api/tm/:id
 * body: { source_text?, target_text?, quality?, src_lang?, tgt_lang? }
 * Edita item da TM.
 */
tmRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { source_text, target_text, quality, src_lang, tgt_lang } = req.body || {};

  const cur = await get("SELECT * FROM tm_entries WHERE id=?", [id]);
  if (!cur) return res.status(404).json({ error: "TM não encontrado" });

  const source_norm = source_text != null ? norm(source_text) : cur.source_norm;
  const tgt = target_text != null ? target_text : cur.target_text;
  const ql = quality != null ? Number(quality) : cur.quality;
  const sl = src_lang != null ? src_lang : cur.src_lang;
  const tl = tgt_lang != null ? tgt_lang : cur.tgt_lang;

  await run(
    "UPDATE tm_entries SET source_norm=?, target_text=?, src_lang=COALESCE(?,src_lang), tgt_lang=COALESCE(?,tgt_lang), quality=?, last_used_at=CURRENT_TIMESTAMP WHERE id=?",
    [source_norm, tgt, sl, tl, ql, id]
  );
  const updated = await get("SELECT * FROM tm_entries WHERE id=?", [id]);
  res.json({ ok: true, row: updated });
});

/**
 * DELETE /api/tm/:id
 * Remove item da TM
 */
tmRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const info = await run("DELETE FROM tm_entries WHERE id=?", [id]);
  if (!info || info.changes === 0) {
    return res.status(404).json({ error: "TM não encontrado para excluir" });
  }
  res.json({ ok: true, id: Number(id) });
});

export default tmRouter;
