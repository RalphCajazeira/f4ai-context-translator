import { Router } from "express"
import {
  getSuggestions,
  topKExamples,
  recordApproval,
  getGlossary,
} from "../services/suggest.service.js"
import {
  translateWithContext,
  forceTranslateWithOllama,
} from "../services/mt-client.service.js"
import { run, all } from "../db.js"
import {
  projectGlossaryCaseInSentence,
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "../services/case.service.js"

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
    na += va[i] ** 2
    nb += vb[i] ** 2
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

/** Ajustes ON/OFF (título e "When ON/OFF") */
function adaptToggleOnOff(fromSourceNorm, fromTarget, toOriginal) {
  if (!fromSourceNorm || !fromTarget || !toOriginal) return null
  let out = String(fromTarget)
  const srcNew = String(toOriginal)
  const PT_ON = "LIGADO",
    PT_OFF = "DESLIGADO"

  // 1) Título ": ON|OFF"
  const headerNew = srcNew.match(/:\s*(ON|OFF)\b/i)?.[1]?.toUpperCase()
  if (headerNew) {
    const desired = headerNew === "ON" ? PT_ON : PT_OFF
    out = out.replace(
      /(:\s*)(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/iu,
      `$1${desired}`
    )
  }

  // 2) "Quando ON|OFF"
  const whenMatches = [...srcNew.matchAll(/\bWhen\s+(ON|OFF)\b/gi)]
  if (whenMatches.length > 0) {
    let idx = 0
    out = out.replace(
      /\b(Quando)\s+(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/gi,
      (m, q) => {
        const mSrc = whenMatches[idx++]
        if (!mSrc) return m
        const desired = mSrc[1].toUpperCase() === "ON" ? PT_ON : PT_OFF
        return `${q} ${desired}`
      }
    )
    const needOn = whenMatches.some((m) => m[1].toUpperCase() === "ON")
    const needOff = whenMatches.some((m) => m[1].toUpperCase() === "OFF")
    if (!/\bQuando\s+(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/i.test(out)) {
      if (needOn) out = out.replace(/\bQuando\b/i, `Quando ${PT_ON}`)
      if (needOff) out = out.replace(/\bQuando\b/i, `Quando ${PT_OFF}`)
    }
  }

  // 3) Padroniza
  out = out.replace(/\bATIVADO\b/gi, PT_ON).replace(/\bDESATIVADO\b/gi, PT_OFF)
  return out
}

/** Normalizador simples */
const normalize = (s = "") =>
  String(s).trim().replace(/\s+/g, " ").toLowerCase()

/** Tradução linha a linha (com contexto opcional) */
async function translatePreservingLines({
  text,
  src,
  tgt,
  shots,
  glossary,
  contextBlock = "",
  noTranslate = [],
}) {
  const lines = String(text || "").split(/\r?\n/)
  const out = []
  for (const ln of lines) {
    if (ln.trim() === "") {
      out.push("")
      continue
    }

    const promptLine =
      (contextBlock ? contextBlock + "\n\n" : "") +
      `Traduza LITERALMENTE para ${tgt}. Responda só a tradução desta linha, sem explicações, sem aspas:\n${ln}`

    try {
      let clean = await translateWithContext({
        text: promptLine,
        src,
        tgt,
        shots,
        glossary,
        noTranslate,
      })
      clean = String(clean || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i, "")
        .replace(
          /^(?:en|english)\s*:\s*[^\n]*\n\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i,
          ""
        )
        .replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/i, "$1")
        .trimEnd()

      if (normalize(clean) === normalize(ln)) {
        const forced = await forceTranslateWithOllama(ln, src, tgt)
        if (normalize(forced) !== normalize(ln)) clean = forced
      }
      out.push(clean)
    } catch {
      try {
        out.push((await forceTranslateWithOllama(ln, src, tgt)) || ln)
      } catch {
        out.push(ln)
      }
    }
  }
  return out.join("\n")
}

/* --------- Glossário (troca determinística pós-tradução) ---------- */
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function buildWBRegex(terms = []) {
  const parts = [
    ...new Set(terms.map((t) => String(t || "").trim()).filter(Boolean)),
  ]
    .sort((a, b) => b.length - a.length)
    .map(reEscape)
  if (!parts.length) return null
  return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?![\\w-])`, "gi")
}

function pickBlacklistMatches(text, rows) {
  const terms = (rows || []).map((r) => r.term).filter(Boolean)
  const re = buildWBRegex(terms)
  if (!re) return []
  const found = new Set()
  String(text).replace(re, (m) => {
    found.add(m.toLowerCase())
    return m
  })
  return terms.filter((t) => found.has(String(t).toLowerCase()))
}

function pickGlossaryMatches(text, rows) {
  const terms = (rows || []).map((r) => r.term_source).filter(Boolean)
  const re = buildWBRegex(terms)
  if (!re) return []
  const seen = new Set()
  const byKey = new Map(
    (rows || []).map((r) => [String(r.term_source).toLowerCase(), r])
  )
  String(text).replace(re, (m) => {
    seen.add(m.toLowerCase())
    return m
  })
  return [...seen].map((k) => byKey.get(k)).filter(Boolean)
}

function buildGlossPatterns(glossary = [], noTranslate = []) {
  const blocked = new Set(
    (noTranslate || []).map((t) => String(t).toLowerCase())
  )
  const rows = (glossary || [])
    .filter((g) => g && g.term_source && g.term_target && (g.approved ?? 1))
    .filter((g) => !blocked.has(String(g.term_source).toLowerCase()))
    .sort((a, b) => b.term_source.length - a.term_source.length)
  return rows.map((g) => {
    const pat = `(?<![\\w-])${reEscape(g.term_source)}(?![\\w-])`
    return { re: new RegExp(pat, "gi"), target: g.term_target }
  })
}

function applyGlossaryHardReplace(
  sourceText,
  translatedText,
  glossary,
  noTranslate
) {
  if (!translatedText) return translatedText
  const patterns = buildGlossPatterns(glossary, noTranslate)
  if (!patterns.length) return translatedText
  let out = String(translatedText)
  for (const { re, target } of patterns) out = out.replace(re, target)
  return out
}

/** Reforça termos ALL-CAPS isoladamente */
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

  const uniqueCaps = Array.from(new Set(cpsCaps(caps)))
  for (const term of uniqueCaps) {
    let t = ""
    try {
      const promptWord = `Traduza apenas esta palavra (forma básica):\n${term}`
      t = await translateWithContext({
        text: promptWord,
        src,
        tgt,
        shots,
        glossary,
      })
      t = String(t || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^.*?\n/, "")
        .trim()
    } catch {
      t = ""
    }
    if (!t) continue
    const projected = applyCaseLike(term, t)
    out = replaceWordUnicode(out, t, projected)
  }
  return out
}
function cpsCaps(arr) {
  const set = new Set()
  for (const w of arr) {
    if (/\b[\p{Lu}]{2,}\b/u.test(w)) set.add(w)
  }
  return Array.from(set)
}

/* ---------- Contexto (Glossário + Blacklist) ---------- */
function buildContextBlock(matchedGlossary = [], matchedBlacklistRows = []) {
  const lines = []
  if (matchedBlacklistRows.length) {
    lines.push("### CONTEXTO — BLACKLIST (não traduzir):")
    for (const b of matchedBlacklistRows) {
      const term = b.term
      const notes = (b.notes || "").trim()
      lines.push(`- ${term}${notes ? ` — ${notes}` : ""}`)
    }
    lines.push("")
  }
  if (matchedGlossary.length) {
    lines.push("### CONTEXTO — GLOSSÁRIO (usar tradução fixa):")
    for (const g of matchedGlossary) {
      const src = g.term_source
      const tgt = g.term_target
      const notes = (g.notes || "").trim()
      lines.push(`- ${src} → ${tgt}${notes ? ` — ${notes}` : ""}`)
    }
    lines.push("")
  }
  return lines.length ? lines.join("\n") : ""
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

  const [shots, glossaryRows, suggestions, tmPairs, blacklistRows] =
    await Promise.all([
      topKExamples(text, 5),
      getGlossary(),
      getSuggestions(text, src, tgt, 8),
      all("SELECT source_norm, target_text FROM tm_entries LIMIT 500"),
      all("SELECT term, notes FROM blacklist"),
    ])

  // Itens encontrados no texto
  const matchedGlossary = pickGlossaryMatches(text, glossaryRows)
  const matchedNoTranslate = pickBlacklistMatches(text, blacklistRows)

  // Mapeia termos de blacklist → {term, notes}
  const byTerm = new Map(
    (blacklistRows || []).map((r) => [String(r.term).toLowerCase(), r])
  )
  const matchedBlacklistRows = matchedNoTranslate
    .map((t) => byTerm.get(String(t).toLowerCase()))
    .filter(Boolean)

  // --- Novo: curto-circuito quando o texto é apenas termos da blacklist ---
  const onlyBlacklist = (() => {
    if (!matchedNoTranslate.length) return false
    const re = buildWBRegex(matchedNoTranslate)
    // remove os termos da blacklist, depois remove sinais/espacos; se nada sobrar → só blacklist
    const residual = String(text)
      .replace(re, "")
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .trim()
    return residual.length === 0
  })()
  if (onlyBlacklist) {
    if (process.env.MT_LOG !== "0") {
      console.log(
        "[translate] Texto contém apenas termos da blacklist — IA não será chamada."
      )
    }
    return res.json({
      best: text,
      candidates: [],
      matched: {
        glossary: matchedGlossary,
        blacklist: matchedBlacklistRows.map(({ term, notes }) => ({
          term,
          notes,
        })),
      },
    })
  }

  // Bloco de contexto (somente quando não é “apenas blacklist”)
  const contextBlock = buildContextBlock(matchedGlossary, matchedBlacklistRows)

  // Logs
  if (process.env.MT_LOG !== "0") {
    console.log("\n=== [translate] Requisição recebida ===")
    console.log("src → tgt:", src, "→", tgt)
    console.log("Texto original:\n" + text)
    console.log(
      "Glossário detectado:",
      matchedGlossary.map((g) => g.term_source)
    )
    console.log(
      "Blacklist detectada:",
      matchedBlacklistRows.map((b) => b.term)
    )
    if (contextBlock)
      console.log("[translate] Contexto enviado (preview):\n" + contextBlock)
  }

  try {
    // 1) TM primeiro
    const srcNorm = norm(text)
    let best = ""

    const FUZZY_PROMOTE_MIN = Number(process.env.TM_FUZZY_PROMOTE_MIN ?? 0.92)
    const MAX_LEN_DELTA = Number(process.env.TM_FUZZY_MAX_LEN_DELTA ?? 0.1)
    const REQUIRE_PATCH =
      String(process.env.TM_FUZZY_REQUIRE_PATCH ?? "true").toLowerCase() ===
      "true"

    const tmExact = (tmPairs || []).find((p) => p.source_norm === srcNorm)
    if (tmExact) {
      best = applyCaseLike(text, tmExact.target_text)
      if (process.env.MT_LOG !== "0")
        console.log("[translate] Hit TM exata. Pulando chamada à IA.")
    } else {
      let top = null
      for (const p of tmPairs || []) {
        const sc = tokenCosine(srcNorm, p.source_norm || "")
        if (!top || sc > top.sc) top = { ...p, sc }
      }
      if (top) {
        const lenA = srcNorm.length,
          lenB = (top.source_norm || "").length
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
          if (process.env.MT_LOG !== "0") {
            console.log(
              "[translate] Promovido via TM fuzzy (score:",
              top.sc.toFixed(3) + ")"
            )
          }
        }
      }
    }

    // 2) Chama MT só se necessário (passando listas filtradas + contexto)
    const isSingleLine = !/\r?\n/.test(text)
    const words = String(text).trim().split(/\s+/).filter(Boolean)
    const isVeryShort = text.length <= 32 || words.length <= 4

    if (!best) {
      if (process.env.MT_LOG !== "0") {
        console.log(
          "[translate] Chamando IA… (preserveLines:",
          !!preserveLines,
          ", veryShort:",
          !!isVeryShort,
          ")"
        )
      }
      const contextualText = contextBlock ? `${contextBlock}\n\n${text}` : text

      best =
        isSingleLine && isVeryShort
          ? await translateWithContext({
              text: contextualText,
              src,
              tgt,
              shots,
              glossary: matchedGlossary,
              noTranslate: matchedNoTranslate,
            })
          : preserveLines
          ? await translatePreservingLines({
              text,
              src,
              tgt,
              shots,
              glossary: matchedGlossary,
              contextBlock,
              noTranslate: matchedNoTranslate,
            })
          : await translateWithContext({
              text: contextualText,
              src,
              tgt,
              shots,
              glossary: matchedGlossary,
              noTranslate: matchedNoTranslate,
            })
    }

    // 3) Padronizações e substituições determinísticas
    best = best
      .replace(/\bATIVADO\b/gi, "LIGADO")
      .replace(/\bDESATIVADO\b/gi, "DESLIGADO")
      .replace(/\b(LIGADO)\s+(ATIVADO|LIGADO)\b/gi, "LIGADO")
      .replace(/\b(DESLIGADO)\s+(DESATIVADO|DESLIGADO)\b/gi, "DESLIGADO")

    best = applyGlossaryHardReplace(
      text,
      best,
      matchedGlossary,
      matchedNoTranslate
    )

    // 4) Projeção de caixa + ALL-CAPS
    const pairs = [...matchedGlossary, ...tmPairs]
    best = projectGlossaryCaseInSentence(text, best, pairs)
    best = await enforceAllCapsTerms({
      original: text,
      best,
      src,
      tgt,
      shots,
      glossary: matchedGlossary,
    })

    // 5) Sugestões (com projeção)
    const candidates = (suggestions || []).map((c) => ({
      ...c,
      text: projectGlossaryCaseInSentence(text, c.text, pairs),
    }))

    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      )
    }

    if (process.env.MT_LOG !== "0") {
      console.log("=== [translate] Resposta final ===")
      console.log("best:\n" + best)
      console.log(
        "candidates:",
        candidates.map((c) => c.text)
      )
      console.log(
        "matched.glossary:",
        matchedGlossary.map((g) => g.term_source)
      )
      console.log(
        "matched.blacklist:",
        matchedBlacklistRows.map((b) => b.term)
      )
      console.log("===================================\n")
    }

    return res.json({
      best,
      candidates,
      matched: {
        glossary: matchedGlossary,
        blacklist: matchedBlacklistRows.map(({ term, notes }) => ({
          term,
          notes,
        })),
      },
    })
  } catch (err) {
    if (process.env.MT_LOG !== "0") {
      console.error("[translate] ERRO durante tradução:", err?.message || err)
    }
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

/* ----------------------- Aprovar (grava na TM) ----------------------- */
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

  await recordApproval(source_text, target_text)

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
  } catch (_) {}
  return res.json({ ok: true, removedLogId })
})

export default translateRouter
