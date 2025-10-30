import { Router } from "express"
import {
  getSuggestions,
  topKExamples,
  recordApproval,
  getGlossary,
} from "../services/suggest.service.js"
import { run, all } from "../db.js"
import {
  projectGlossaryCaseInSentence,
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "../services/case.service.js"
import {
  translateWithContext,
  forceTranslateWithOllama,
} from "../services/mt-client.service.js"

export const translateRouter = Router()

/* ----------------------- Helpers ----------------------- */
function norm(s = "") {
  return String(s).trim().replace(/\s+/g, " ").toLowerCase()
}

/** Similaridade cosine simples por tokens (estável e sem dependências) */
function tokenCosine(a, b) {
  const A = norm(a).split(/\s+/).filter(Boolean)
  const B = norm(b).split(/\s+/).filter(Boolean)
  if (!A.length || !B.length) return 0
  const set = new Set([...A, ...B])
  const va = [],
    vb = []
  for (const t of set) {
    const ca = A.reduce((n, x) => n + (x === t), 0)
    const cb = B.reduce((n, x) => n + (x === t), 0)
    va.push(ca)
    vb.push(cb)
  }
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i]
    na += va[i] * va[i]
    nb += vb[i] * vb[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

/** Patch adaptativo contextual para ON↔OFF
 * - Ajusta TÍTULO "Algo: ON/OFF" sem afetar o corpo
 * - Ajusta cada ocorrência de "When ON/OFF" separadamente
 */
function adaptToggleOnOff(fromSourceNorm, fromTarget, toOriginal) {
  if (!fromSourceNorm || !fromTarget || !toOriginal) return null

  let out = String(fromTarget)
  const srcNew = String(toOriginal)

  const PT_ON = "LIGADO"
  const PT_OFF = "DESLIGADO"

  // --- 0) Normalize qualquer variação anterior p/ nosso padrão ---
  out = out.replace(/\bATIVADO\b/gi, PT_ON).replace(/\bDESATIVADO\b/gi, PT_OFF)

  // --- 1) TÍTULO ": ON|OFF" → ": LIGADO|DESLIGADO" ---
  const headerNew = srcNew.match(/:\s*(ON|OFF)\b/i)?.[1]?.toUpperCase()
  if (headerNew) {
    const desired = headerNew === "ON" ? PT_ON : PT_OFF
    // aceita as quatro formas no alvo, mas força nosso padrão
    out = out.replace(
      /(:\s*)(LIGADO|DESLIGADO|ATIVADO|DESATIVADO)\b/iu,
      `$1${desired}`
    )
  }

  // --- 2) "When ON|OFF" → "Quando LIGADO|DESLIGADO" (ocorrência a ocorrência) ---
  const whenMatches = [...srcNew.matchAll(/\bWhen\s+(ON|OFF)\b/gi)]
  if (whenMatches.length > 0) {
    let idx = 0
    out = out.replace(
      /\b(Quando)\s+(LIGADO|DESLIGADO|ATIVADO|DESATIVADO)\b/gi,
      (m, q) => {
        const mSrc = whenMatches[idx++]
        if (!mSrc) return m
        const desired = mSrc[1].toUpperCase() === "ON" ? PT_ON : PT_OFF
        return `${q} ${desired}`
      }
    )

    // fallback: se o source tem "When ..." e o alvo não tinha "Quando ...", injeta 1 vez
    const needOn = whenMatches.some((m) => m[1].toUpperCase() === "ON")
    const needOff = whenMatches.some((m) => m[1].toUpperCase() === "OFF")
    if (!/\bQuando\s+(LIGADO|DESLIGADO)\b/i.test(out)) {
      if (needOn) out = out.replace(/\bQuando\b/i, `Quando ${PT_ON}`)
      if (needOff) out = out.replace(/\bQuando\b/i, `Quando ${PT_OFF}`)
    }
  }

  // --- 3) Deduplicação (caso glossário/LLM tenha encaixado sinônimos) ---
  out = out
    .replace(/\b(LIGADO)\s+(ATIVADO|LIGADO)\b/gi, PT_ON)
    .replace(/\b(DESLIGADO)\s+(DESATIVADO|DESLIGADO)\b/gi, PT_OFF)

  return out
}

/** Tradução linha a linha com limpeza anti-eco do LLM (segura) */
async function translatePreservingLines({ text, src, tgt, shots, glossary }) {
  const raw = String(text ?? "")
  const endsWithNL = /\r?\n$/.test(raw)
  const lines = raw.split(/\r\n|\n/) // preserva CRLF e linhas vazias
  const out = []

  for (const ln of lines) {
    if (ln.trim() === "") {
      out.push("")
      continue
    }

    const promptLine = `Traduza apenas esta linha mantendo as quebras:\n${ln}`
    try {
      const translated = await translateWithContext({
        text: promptLine,
        src,
        tgt,
        shots,
        glossary,
      })

      let clean = String(translated || "")
        // remove instruções ecoadas
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        // remove prefixos comuns de rótulo
        .replace(/^\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i, "")
        .replace(
          /^(?:en|english)\s*:\s*[^\n]*\n\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i,
          ""
        )
        // desembrulha fenced code blocks, se vierem
        .replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/i, "$1")
        // nunca usar .trim() (pra não comer linha vazia); só final
        .trimEnd()

      // anti-eco: se igual ao original, força fallback direto no Ollama
      if (norm(clean) === norm(ln)) {
        try {
          const forced = await forceTranslateWithOllama(ln, src, tgt)
          if (norm(forced) !== norm(ln)) clean = forced
        } catch {
          /* mantém clean como está */
        }
      }

      out.push(clean)
    } catch {
      // erro no microserviço → tenta fallback duro no Ollama antes de devolver original
      try {
        const forced = await forceTranslateWithOllama(ln, src, tgt)
        out.push(forced || ln)
      } catch {
        out.push(ln)
      }
    }
  }

  let joined = out.join("\n")
  if (endsWithNL) joined += "\n"
  return joined
}

/** Reforça termos ALL-CAPS traduzindo isoladamente (com anti-eco seguro) */
async function enforceAllCapsTerms({
  original,
  best,
  src,
  tgt,
  shots,
  glossary,
}) {
  let out = String(best || "")
  const caps = extractAllCapsTerms(original)
  if (!caps.length || !out) return out

  const uniqueCaps = Array.from(new Set(caps))
  for (const term of uniqueCaps) {
    let t = ""
    try {
      const promptWord = `Traduza apenas esta palavra (sem contexto, forma básica):\n${term}`
      t = await translateWithContext({
        text: promptWord,
        src,
        tgt,
        shots,
        glossary,
      })
      t = String(t || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i, "")
        .replace(
          /^(?:en|english)\s*:\s*[^\n]*\n\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i,
          ""
        )
        .replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/i, "$1")
        .trimEnd()
    } catch {
      t = ""
    }
    if (!t) continue
    const projected = applyCaseLike(term, t) // ALL-CAPS → upper
    out = replaceWordUnicode(out, t, projected)
  }
  return out
}

/* ----------------------- Rota Principal ----------------------- */
translateRouter.post("/", async (req, res) => {
  const {
    text,
    src = process.env.MT_SRC || "en",
    tgt = process.env.MT_TGT || "pt",
    preserveLines = true,
    log = false,
    origin = "ui",
  } = req.body || {}

  if (!text) return res.status(400).json({ error: "text é obrigatório" })

  // Busca paralela para reduzir latência total
  const [shots, glossary, suggestions, tmPairs] = await Promise.all([
    topKExamples(text, 5),
    getGlossary(),
    getSuggestions(text, src, tgt, 8),
    all("SELECT source_norm, target_text FROM tm_entries LIMIT 500"),
  ])

  try {
    // 1) PRIORIZE TM com critérios mais rígidos
    const srcNorm = norm(text)
    let best = ""

    const FUZZY_PROMOTE_MIN = Number(process.env.TM_FUZZY_PROMOTE_MIN ?? 0.92)
    const MAX_LEN_DELTA = Number(process.env.TM_FUZZY_MAX_LEN_DELTA ?? 0.1)
    const REQUIRE_PATCH =
      String(process.env.TM_FUZZY_REQUIRE_PATCH ?? "true").toLowerCase() ===
      "true"

    // 1a) Exato
    const tmExact = (tmPairs || []).find((p) => p.source_norm === srcNorm)
    if (tmExact) {
      best = applyCaseLike(text, tmExact.target_text)
    } else {
      // 1b) Fuzzy (hard mode)
      let top = null
      for (const p of tmPairs || []) {
        const sc = tokenCosine(srcNorm, p.source_norm || "")
        if (!top || sc > top.sc) top = { ...p, sc }
      }

      if (top) {
        const lenA = srcNorm.length
        const lenB = (top.source_norm || "").length
        const lenOk =
          Math.abs(lenA - lenB) / Math.max(1, Math.max(lenA, lenB)) <=
          MAX_LEN_DELTA

        const patched = adaptToggleOnOff(top.source_norm, top.target_text, text)
        const changed = patched && patched !== top.target_text

        if (
          top.sc >= FUZZY_PROMOTE_MIN &&
          lenOk &&
          (!REQUIRE_PATCH || changed)
        ) {
          best = applyCaseLike(text, patched || top.target_text)
        }
      }
    }

    // 1c) Se ainda não tem best, chama MT/LLM
    const isSingleLine = !/\r?\n/.test(text)
    const words = String(text).trim().split(/\s+/).filter(Boolean)
    const isVeryShort = text.length <= 32 || words.length <= 4

    if (!best) {
      best =
        isSingleLine && isVeryShort
          ? await translateWithContext({ text, src, tgt, shots, glossary })
          : preserveLines
          ? await translatePreservingLines({ text, src, tgt, shots, glossary })
          : await translateWithContext({ text, src, tgt, shots, glossary })
    }

    /* 2) PROJEÇÃO de caixa por glossário + TM (consistência visual) */
    const pairs = [...glossary, ...tmPairs]
    best = projectGlossaryCaseInSentence(text, best, pairs)

    /* 3) Reforço ALL-CAPS (mesmo sem TM/glossário) */
    best = await enforceAllCapsTerms({
      original: text,
      best,
      src,
      tgt,
      shots,
      glossary,
    })

    /* 🔹 Padroniza e remove duplicatas eventuais */
    best = best
      .replace(/\bATIVADO\b/gi, "LIGADO")
      .replace(/\bDESATIVADO\b/gi, "DESLIGADO")
      .replace(/\b(LIGADO)\s+(ATIVADO|LIGADO)\b/gi, "LIGADO")
      .replace(/\b(DESLIGADO)\s+(DESATIVADO|DESLIGADO)\b/gi, "DESLIGADO")

    /* 4) Candidatos (sugestões) com mesma projeção de caixa */
    const candidates = (suggestions || []).map((c) => ({
      ...c,
      text: projectGlossaryCaseInSentence(text, c.text, pairs),
    }))

    /* 5) Log opcional */
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      )
    }

    return res.json({ best, candidates })
  } catch {
    // Fallback: devolve melhor candidato disponível
    const best = (suggestions && suggestions[0]?.text) || ""
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      )
    }
    return res.json({ best, candidates: suggestions || [] })
  }
})

/* Aprovar → gravar na TM (upsert/contadores) */
translateRouter.post("/approve", async (req, res) => {
  const {
    source_text,
    target_text,
    log_id,
    removeFromLog = true,
  } = req.body || {}
  if (!source_text || !target_text) {
    return res
      .status(400)
      .json({ error: "source_text e target_text são obrigatórios" })
  }

  // 1) grava/atualiza na TM (upsert)
  await recordApproval(source_text, target_text)

  // 2) sincroniza com o log e captura o id removido
  let removedLogId = null
  try {
    if (removeFromLog) {
      if (log_id) {
        await run("DELETE FROM translation_logs WHERE id = ?", [log_id])
        removedLogId = Number(log_id)
      } else {
        const row = await all(
          `SELECT id FROM translation_logs
             WHERE source_text = ? AND approved = 0
             ORDER BY created_at DESC
             LIMIT 1`,
          [source_text]
        )
        if (row?.[0]?.id) {
          await run("DELETE FROM translation_logs WHERE id = ?", [row[0].id])
          removedLogId = Number(row[0].id)
        }
      }
    }
  } catch {
    // não falha a aprovação se não achar log compatível
  }

  return res.json({ ok: true, removedLogId })
})

export default translateRouter
