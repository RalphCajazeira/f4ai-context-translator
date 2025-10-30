import fetch from "node-fetch"
import dotenv from "dotenv"
dotenv.config()

// ==== ENV / Defaults =========================================================
const MT_BACKEND = process.env.MT_BACKEND || "ollama"
// URL do seu mt_service (FastAPI). Mantém /llm-translate como padrão oficial:
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

// Fallback direto no Ollama com prompt few-shot para evitar eco em textos curtos
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

// Chama o seu microserviço de MT (FastAPI) — rota oficial /llm-translate
async function callMtService({ text, src, tgt, shots = [], glossary = [] }) {
  const r = await fetch(MT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // shots/glossary vão junto (o serviço pode ignorar ou aproveitar)
    body: JSON.stringify({ text, src, tgt, shots, glossary }),
  })
  if (!r.ok) throw new Error(`MT service ${r.status}`)
  const j = await r.json()
  // o mt_service retorna { text: "..." }
  const best = j && typeof j.text === "string" ? j.text : ""
  return best || ""
}

// ==== Função principal (mantém a mesma assinatura e retorna string) ==========
export async function translateWithContext({
  text,
  src = process.env.MT_SRC || "en",
  tgt = process.env.MT_TGT || "pt",
  shots = [],
  glossary = [],
  // mantém compatibilidade com quem passa "backend" por parâmetro;
  // mas por padrão usamos o env
  backend = MT_BACKEND,
}) {
  // Se MT desabilitado, retorna original
  if (!MT_ENABLED) return text

  // 1) Tenta via microserviço (seja no modo "ollama" ou "transformers")
  try {
    const mtOut = await callMtService({ text, src, tgt, shots, glossary })

    // 2) Se o resultado ecoou o original e o texto é curto, força fallback no Ollama
    if (isShortText(text) && normalize(mtOut) === normalize(text)) {
      try {
        const forced = await forceTranslateWithOllama(text, src, tgt)
        // só troca se realmente mudou
        if (normalize(forced) !== normalize(text)) return forced
      } catch (e) {
        // se o fallback falhar, devolve o que veio do MT (ou o original)
        console.warn("[mt-client] Fallback Ollama falhou:", e.message)
      }
    }

    // 3) Caso normal: retorna a saída do microserviço
    return mtOut || text
  } catch (e) {
    // 4) Se o microserviço falhar por completo, tenta direto no Ollama como último recurso
    console.warn("[mt-client] MT service falhou:", e.message)
    try {
      const forced = await forceTranslateWithOllama(text, src, tgt)
      if (forced) return forced
    } catch (e2) {
      console.warn("[mt-client] Ollama direto também falhou:", e2.message)
    }
    // Último fallback: original (mantém comportamento anterior)
    return text
  }
}
