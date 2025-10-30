import fetch from "node-fetch"
import dotenv from "dotenv"
dotenv.config()

// ==== ENV / Defaults =========================================================
const MT_BACKEND = process.env.MT_BACKEND || "ollama"
const MT_URL = process.env.MT_URL || "http://localhost:8001/llm-translate"
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct"
const MT_ENABLED =
  String(process.env.MT_ENABLED || "true").toLowerCase() === "true"

// ==== Helpers ================================================================
function normalize(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}
function isShortText(s) {
  const t = String(s || "").trim()
  const words = t.split(/\s+/).filter(Boolean)
  return t.length <= 32 || words.length <= 4
}
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// --- Blacklist: compila regex único (ordenado por tamanho) ---
function buildNoTranslateRegex(terms = []) {
  const clean = (terms || []).map((t) => String(t || "").trim()).filter(Boolean)
  if (!clean.length) return null
  const parts = [...new Set(clean)]
    .sort((a, b) => b.length - a.length)
    .map(reEscape)
  return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?![\\w-])`, "gi")
}
const TOKEN_RE = /__NT(\d+)__/g
function protectNoTranslate(text, regex) {
  if (!regex) return { text, originals: null }
  if (!regex.test(text)) {
    regex.lastIndex = 0
    return { text, originals: null }
  }
  regex.lastIndex = 0
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
  if (!originals) return text
  return String(text).replace(TOKEN_RE, (_, n) => originals[Number(n)] ?? _)
}

// ==== Ollama fallback ========================================================
export async function forceTranslateWithOllama(text, src = "en", tgt = "pt") {
  const prompt = `Traduza LITERALMENTE do ${src} para ${tgt}.
Regras:
- Responda SOMENTE a tradução (sem comentários, sem aspas, sem repetir o original).
- Preserve quebras de linha e pontuação.
- Se for uma única palavra, traduza a palavra (não devolva o original), exceto nomes próprios ou acrônimos universalmente mantidos.

Exemplos:
EN: Hello
PT-BR: Olá

EN: Hello world
PT-BR: Olá, mundo

EN: ${text}
PT-BR:`
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      options: { temperature: 0 },
      stream: false,
    }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => "")
    throw new Error(`Ollama fallback error ${r.status}: ${body}`)
  }
  const data = await r.json()
  const out = data && data.response ? String(data.response).trim() : ""
  if (!out) throw new Error("Ollama fallback retornou vazio")
  return out
}

// ==== MT service (FastAPI /llm-translate) ===================================
async function callMtService({ text, src, tgt, shots = [], glossary = [] }) {
  const r = await fetch(MT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, src, tgt, shots, glossary }),
  })
  if (!r.ok) throw new Error(`MT service ${r.status}`)
  const j = await r.json()
  const best = j && typeof j.text === "string" ? j.text : ""
  return best || ""
}

// ==== Principal: agora com blacklist (noTranslate) ===========================
export async function translateWithContext({
  text,
  src = process.env.MT_SRC || "en",
  tgt = process.env.MT_TGT || "pt",
  shots = [],
  glossary = [],
  noTranslate = [], // <<--- NOVO: termos para NÃO traduzir
  backend = MT_BACKEND,
}) {
  if (!MT_ENABLED) return text

  // 0) protege blacklist
  const regex = buildNoTranslateRegex(noTranslate)
  const { text: masked, originals } = protectNoTranslate(String(text), regex)

  // 1) tenta MT service
  try {
    let mtOut = await callMtService({ text: masked, src, tgt, shots, glossary })
    if (isShortText(masked) && normalize(mtOut) === normalize(masked)) {
      try {
        const forced = await forceTranslateWithOllama(masked, src, tgt)
        if (normalize(forced) !== normalize(masked)) mtOut = forced
      } catch (e) {
        console.warn("[mt-client] Fallback Ollama falhou:", e.message)
      }
    }
    // 2) restaura blacklist
    return restoreNoTranslate(mtOut || masked, originals)
  } catch (e) {
    console.warn("[mt-client] MT service falhou:", e.message)
    try {
      const forced = await forceTranslateWithOllama(masked, src, tgt)
      return restoreNoTranslate(forced, originals)
    } catch (e2) {
      console.warn("[mt-client] Ollama direto também falhou:", e2.message)
    }
    return restoreNoTranslate(masked, originals)
  }
}
