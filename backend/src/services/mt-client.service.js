import fetch from "node-fetch"
import dotenv from "dotenv"
import { buildWordBoundaryRegex } from "@/utils/text-patterns.js"
dotenv.config()

// ==== ENV / Defaults =========================================================
export const MT_BACKEND = process.env.MT_BACKEND || "ollama"
export const MT_URL =
  process.env.MT_URL || "http://localhost:8001/llm-translate"
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
export const OLLAMA_PRIMARY_MODEL =
  process.env.OLLAMA_MODEL || "llama3.1:8b-instruct-q4_K_M"
export const OLLAMA_LIGHT_MODEL =
  process.env.OLLAMA_LIGHT_MODEL || process.env.OLLAMA_MODEL_LIGHT || ""
export const OLLAMA_MODEL = OLLAMA_PRIMARY_MODEL
export const MT_ENABLED =
  String(process.env.MT_ENABLED || "true").toLowerCase() === "true"

const MT_LOG_ENABLED = process.env.MT_LOG !== "0" // 1 ou 2 = ligado

const LIGHT_WORD_LIMIT = parseLimit(process.env.OLLAMA_LIGHT_MAX_WORDS)
const LIGHT_CHAR_LIMIT = parseLimit(process.env.OLLAMA_LIGHT_MAX_CHARS)
const LIGHT_LIMITS_ACTIVE = LIGHT_WORD_LIMIT > 0 || LIGHT_CHAR_LIMIT > 0

// ==== Helpers ================================================================
function normalize(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

const TOKEN_RE = /__NT(\d+)__/g

function protectNoTranslate(text, regex) {
  if (!regex) return { text: String(text), originals: [] }
  const originals = []
  let id = 0
  const masked = String(text).replace(regex, (m) => {
    const token = `__NT${id}__`
    originals[id++] = m
    return token
  })
  return { text: masked, originals }
}

function restoreNoTranslate(text, originals) {
  if (!originals || !originals.length) return String(text)
  return String(text).replace(TOKEN_RE, (_, n) => originals[Number(n)] ?? _)
}

function parseLimit(raw) {
  if (raw === undefined || raw === null) return 0
  const n = Number.parseInt(String(raw), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function countWords(text) {
  const trimmed = String(text || "").trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/u).filter(Boolean).length
}

function shouldUseLightModel(wordCount, charCount) {
  if (!OLLAMA_LIGHT_MODEL || !LIGHT_LIMITS_ACTIVE) return false
  const wordsOk = !LIGHT_WORD_LIMIT || wordCount <= LIGHT_WORD_LIMIT
  const charsOk = !LIGHT_CHAR_LIMIT || charCount <= LIGHT_CHAR_LIMIT
  return wordsOk && charsOk
}

function chooseModelForSegment(text) {
  const raw = String(text ?? "")
  const wordCount = countWords(raw)
  const charCount = raw.length
  const useLight = shouldUseLightModel(wordCount, charCount)
  const model = useLight ? OLLAMA_LIGHT_MODEL : OLLAMA_PRIMARY_MODEL
  return { model, wordCount, charCount, useLight }
}

// ==== Ollama fallback ========================================================
export async function forceTranslateWithOllama(
  text,
  src = "en",
  tgt = process.env.MT_TGT || "pt-BR",
  modelName = OLLAMA_PRIMARY_MODEL
) {
  const prompt = [
    `Traduza o seguinte texto de ${src} para ${tgt}.`,
    `Responda apenas com a tradução, sem explicações, sem aspas:`,
    ``,
    String(text),
  ].join("\n")

  const body = {
    model: modelName,
    prompt,
    stream: false,
  }

  if (MT_LOG_ENABLED) {
    console.log(
      "[mt-client/ollama] →",
      modelName,
      "prompt (preview):",
      prompt.slice(0, 300)
    )
  }

  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`ollama ${r.status}`)

  const j = await r.json()
  const out = String(j?.response || "").trim()

  if (MT_LOG_ENABLED) {
    console.log(
      "[mt-client/ollama] ←",
      modelName,
      "resposta (preview):",
      out.slice(0, 300)
    )
  }

  return out
}

// ==== MT Service (FastAPI/HTTP) =============================================
function previewGlossaryEntries(glossary = []) {
  if (!Array.isArray(glossary) || !glossary.length) return []
  const items = glossary
    .filter((entry) => entry && (entry.termSource || entry.term || entry.src))
    .map((entry) => {
      if (entry.termSource && entry.termTarget) {
        return `${entry.termSource} → ${entry.termTarget}`
      }
      if (entry.src && entry.tgt) {
        return `${entry.src} → ${entry.tgt}`
      }
      if (entry.term) {
        return String(entry.term)
      }
      return JSON.stringify(entry)
    })

  return items.slice(0, 10)
}

async function callMtService({
  text,
  src,
  tgt,
  shots = [],
  glossary = [],
  model,
}) {
  const payload = { text, src, tgt, shots, glossary }
  if (model) payload.model = model

  if (MT_LOG_ENABLED) {
    const glossaryPreview = previewGlossaryEntries(glossary)
    console.log("[mt-client/http] → Enviando para IA", {
      src,
      tgt,
      textPreview: String(text).slice(0, 300),
      shotsCount: Array.isArray(shots) ? shots.length : 0,
      glossaryCount: Array.isArray(glossary) ? glossary.length : 0,
      glossaryPreview,
      model,
    })
  }

  const r = await fetch(MT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`MT service ${r.status}`)

  const j = await r.json()
  const best = (j && typeof j.text === "string" ? j.text : "").trim()

  if (MT_LOG_ENABLED) {
    console.log("[mt-client/http] ← Resposta IA (preview):", best.slice(0, 300))
  }

  return best
}

// ==== API Principal ==========================================================
/**
 * Tradução com proteção de blacklist e suporte a glossário/tiros (shots).
 * - Usa MT_URL por padrão; se falhar, cai no Ollama local.
 * - Respeita "noTranslate" via masking/restore.
 */
export async function translateWithContext({
  text,
  src = process.env.MT_SRC || "en",
  tgt = process.env.MT_TGT || "pt-BR",
  shots = [],
  glossary = [],
  noTranslate = [],
  backend = MT_BACKEND,
}) {
  if (!MT_ENABLED) return String(text)

  const decision = chooseModelForSegment(text)

  if (MT_LOG_ENABLED) {
    console.log("[mt-client] Seleção de modelo", {
      selectedModel: decision.model,
      usedLightModel: decision.useLight,
      wordCount: decision.wordCount,
      charCount: decision.charCount,
      lightLimits: {
        words: LIGHT_WORD_LIMIT,
        chars: LIGHT_CHAR_LIMIT,
      },
    })
  }

  // 0) Protege blacklist
  const regex = buildWordBoundaryRegex(noTranslate)
  const { text: masked, originals } = protectNoTranslate(String(text), regex)

  if (MT_LOG_ENABLED) {
    console.log("[mt-client] noTranslate termos:", (noTranslate || []).length)
    console.log("[mt-client] regex NT:", regex ? String(regex) : "(sem regex)")
    if (glossary && glossary.length) {
      console.log(
        "[mt-client] Glossário aplicado:",
        previewGlossaryEntries(glossary)
      )
    }
    if (masked !== text) {
      console.log(
        "[mt-client] Texto mascarado (preview):",
        masked.slice(0, 300)
      )
    }
  }

  // 1) Seleciona backend
  const useHttp = String(backend || "").toLowerCase() !== "ollama-direct"

  try {
    let mtOut = ""
    if (useHttp) {
      mtOut = await callMtService({
        text: masked,
        src,
        tgt,
        shots,
        glossary,
        model: decision.model,
      })
    } else {
      // “ollama-direct”: traduz sem serviço HTTP intermediário
      mtOut = await forceTranslateWithOllama(
        masked,
        src,
        tgt,
        decision.model
      )
    }

    // 2) Restaura blacklist
    const restored = restoreNoTranslate(mtOut || masked, originals)

    if (MT_LOG_ENABLED) {
      console.log(
        "[mt-client] Texto após restauração (preview):",
        String(restored).slice(0, 300)
      )
    }

    // 3) Anti-eco básico (se a saída == entrada mascarada, tenta Ollama)
    if (normalize(restored) === normalize(masked)) {
      if (MT_LOG_ENABLED) {
        console.log("[mt-client] Saída ~= entrada. Tentando fallback Ollama…")
      }
      const fallbackModel = decision.useLight
        ? OLLAMA_PRIMARY_MODEL
        : decision.model
      const forced = await forceTranslateWithOllama(
        masked,
        src,
        tgt,
        fallbackModel
      )
      return restoreNoTranslate(forced || masked, originals)
    }

    return restored
  } catch (e) {
    console.warn("[mt-client] MT service falhou:", e?.message || e)
    try {
      const fallbackModel = decision.useLight
        ? OLLAMA_PRIMARY_MODEL
        : decision.model
      const forced = await forceTranslateWithOllama(
        masked,
        src,
        tgt,
        fallbackModel
      )
      return restoreNoTranslate(forced || masked, originals)
    } catch (e2) {
      console.warn(
        "[mt-client] Ollama direto também falhou:",
        e2?.message || e2
      )
    }
    // Último recurso: devolve texto original restaurado
    return restoreNoTranslate(masked, originals)
  }
}
