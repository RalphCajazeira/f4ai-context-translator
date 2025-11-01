import fetch from "node-fetch"
import dotenv from "dotenv"
dotenv.config()

// ==== ENV / Defaults =========================================================
export const MT_BACKEND = process.env.MT_BACKEND || "ollama"
export const MT_URL =
  process.env.MT_URL || "http://localhost:8001/llm-translate"
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct"
export const MT_ENABLED =
  String(process.env.MT_ENABLED || "true").toLowerCase() === "true"

const MT_LOG_ENABLED = process.env.MT_LOG !== "0" // 1 ou 2 = ligado

// ==== Helpers ================================================================
function normalize(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function reEscape(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// palavra OU hífen como “borda” (ex.: não casa dentro de otherWords)
function buildWBRegex(terms = []) {
  const parts = [
    ...new Set(terms.map((t) => String(t || "").trim()).filter(Boolean)),
  ]
    .sort((a, b) => b.length - a.length)
    .map(reEscape)
  if (!parts.length) return null
  return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?![\\w-])`, "gi")
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

// ==== Ollama fallback ========================================================
export async function forceTranslateWithOllama(
  text,
  src = "en",
  tgt = process.env.MT_TGT || "pt-BR"
) {
  const prompt = [
    `Traduza o seguinte texto de ${src} para ${tgt}.`,
    `Responda apenas com a tradução, sem explicações, sem aspas:`,
    ``,
    String(text),
  ].join("\n")

  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
  }

  if (MT_LOG_ENABLED) {
    console.log("[mt-client/ollama] → prompt (preview):", prompt.slice(0, 300))
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
    console.log("[mt-client/ollama] ← resposta (preview):", out.slice(0, 300))
  }

  return out
}

// ==== MT Service (FastAPI/HTTP) =============================================
async function callMtService({ text, src, tgt, shots = [], glossary = [] }) {
  const payload = { text, src, tgt, shots, glossary }

  if (MT_LOG_ENABLED) {
    console.log("[mt-client/http] → Enviando para IA", {
      src,
      tgt,
      textPreview: String(text).slice(0, 300),
      shotsCount: Array.isArray(shots) ? shots.length : 0,
      glossaryCount: Array.isArray(glossary) ? glossary.length : 0,
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

  // 0) Protege blacklist
  const regex = buildWBRegex(noTranslate)
  const { text: masked, originals } = protectNoTranslate(String(text), regex)

  if (MT_LOG_ENABLED) {
    console.log("[mt-client] noTranslate termos:", (noTranslate || []).length)
    console.log("[mt-client] regex NT:", regex ? String(regex) : "(sem regex)")
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
      mtOut = await callMtService({ text: masked, src, tgt, shots, glossary })
    } else {
      // “ollama-direct”: traduz sem serviço HTTP intermediário
      mtOut = await forceTranslateWithOllama(masked, src, tgt)
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
      const forced = await forceTranslateWithOllama(masked, src, tgt)
      return restoreNoTranslate(forced || masked, originals)
    }

    return restored
  } catch (e) {
    console.warn("[mt-client] MT service falhou:", e?.message || e)
    try {
      const forced = await forceTranslateWithOllama(masked, src, tgt)
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
