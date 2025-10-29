import { Router } from "express"
import {
  getSuggestions,
  topKExamples,
  recordApproval,
  getGlossary,
} from "../services/suggest.service.js"
import { translateWithContext } from "../services/mt-client.service.js"
import { run } from "../db.js"

export const translateRouter = Router()

async function translatePreservingLines({ text, src, tgt, shots, glossary }) {
  const lines = text.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (ln.trim() === "") {
      out.push("")
      continue
    }
    const promptLine = `Traduza apenas esta linha mantendo as quebras:\n${ln}`
    const translated = await translateWithContext({
      text: promptLine,
      src,
      tgt,
      shots,
      glossary,
    })
    const clean = translated.replace(/^.*?\n/, "").trim()
    out.push(clean)
  }
  return out.join("\n")
}

translateRouter.post("/", async (req, res) => {
  const {
    text,
    src = process.env.MT_SRC || "en",
    tgt = process.env.MT_TGT || "pt",
    preserveLines = true,
    log = false, // << se true, registra em translation_logs
    origin = "ui", // 'ui' | 'hotkey' | 'api'
  } = req.body || {}
  if (!text) return res.status(400).json({ error: "text é obrigatório" })

  const [shots, glossary, candidates] = await Promise.all([
    topKExamples(text, 5),
    getGlossary(),
    getSuggestions(text, src, tgt, 8),
  ])

  try {
    const best = preserveLines
      ? await translatePreservingLines({ text, src, tgt, shots, glossary })
      : await translateWithContext({ text, src, tgt, shots, glossary })

    // registra no log, se solicitado
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      )
    }

    return res.json({ best, candidates })
  } catch {
    const best = candidates[0]?.text || ""
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      )
    }
    return res.json({ best, candidates })
  }
})

translateRouter.post("/approve", async (req, res) => {
  const { source_text, target_text } = req.body || {}
  if (!source_text || !target_text)
    return res
      .status(400)
      .json({ error: "source_text e target_text são obrigatórios" })
  await recordApproval(source_text, target_text)
  res.json({ ok: true })
})
