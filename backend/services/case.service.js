// services/case.service.js
function isUpper(s) {
  return s && s === s.toUpperCase()
}
function isLower(s) {
  return s && s === s.toLowerCase()
}
function isTitleWord(w) {
  return (
    !!w &&
    w[0] === w[0].toUpperCase() &&
    w.slice(1) === w.slice(1).toLowerCase()
  )
}
function isTitleCase(s) {
  const ws = String(s || "")
    .trim()
    .split(/\s+/)
  if (!ws.length) return false
  return ws.every(isTitleWord)
}

// Title Case simples (se quiser ignorar “de/da/do…”, avisa que mando com stopwords)
export function toTitleCaseAll(s) {
  const lower = String(s || "").toLocaleLowerCase()
  const tokens = tokenizeUnicode(lower)
  return tokens
    .map((token) => {
      if (/^\p{L}[\p{L}\p{M}]*$/u.test(token)) {
        const first = token.slice(0, 1).toLocaleUpperCase()
        const rest = token.slice(1)
        return first + rest
      }
      return token
    })
    .join("")
}

export function applyCaseLike(srcSample, target) {
  const src = String(srcSample || "")
  let tgt = String(target || "")
  if (!src || !tgt) return tgt

  if (isUpper(src)) return tgt.toUpperCase()
  if (isLower(src)) return tgt.toLowerCase()
  if (isTitleCase(src)) return toTitleCaseAll(tgt)
  return tgt // caixa mista: mantém como está
}

/**
 * Projeta a caixa dos termos do glossário/TM detectados no texto de origem
 * para a frase traduzida final.
 * pairs: [{ term_source, term_target }] (glossário) ou { source_norm, target_text } (TM)
 */
export function projectGlossaryCaseInSentence(original, target, pairs = []) {
  let out = String(target || "")
  const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  for (const p of pairs) {
    const srcTerm = p.term_source ?? p.source_norm
    const tgtTerm = p.term_target ?? p.target_text
    if (!srcTerm || !tgtTerm) continue

    // Busca o termo no original sem diferenciar maiúsculas/minúsculas
    const reSrc = new RegExp(`\\b${esc(srcTerm)}\\b`, "i")
    const m = String(original).match(reSrc)
    if (!m) continue

    // Projeta a caixa da ocorrência real encontrada (m[0])
    const projected = applyCaseLike(m[0], tgtTerm)

    // Substitui o termo alvo na saída, sem diferenciar caixa
    const reTgt = new RegExp(`\\b${esc(tgtTerm)}\\b`, "gi")
    out = out.replace(reTgt, projected)
  }

  return out
}

// services/case.service.js (trecho adicional)

export function extractAllCapsTerms(original) {
  // Pega tokens com 2+ letras 100% maiúsculas (ignora números/pontuação)
  // Ex.: "He is very LUCKY and HANDSOME." -> ["LUCKY","HANDSOME"]
  const set = new Set()
  const re = /(?<![\p{L}\p{M}])([\p{Lu}][\p{Lu}\p{M}]{1,})(?![\p{L}\p{M}])/gu
  const s = String(original || "")
  let m
  while ((m = re.exec(s))) set.add(m[1])
  return Array.from(set)
}

// === Unicode word helpers ===

// Divide em tokens (palavras Unicode e "não-palavras"), preservando pontuação/espaços.
function tokenizeUnicode(s) {
  const re = /(\p{L}[\p{L}\p{M}]*)/gu // grupos de letras+marcas
  const out = []
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index)) // trecho não-palavra
    out.push(m[0]) // a palavra
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/**
 * Substitui "needle" em "text" por "replacement" comparando palavras por lower-case Unicode,
 * sem depender de \b. Preserva pontuação e espaçamento.
 */
export function replaceWordUnicode(text, needle, replacement) {
  const t = String(text || "")
  const n = String(needle || "")
  if (!t || !n) return t

  const nLower = n.toLocaleLowerCase()
  const tokens = tokenizeUnicode(t)
  for (let i = 0; i < tokens.length; i++) {
    // só compara onde é palavra
    if (/^\p{L}[\p{L}\p{M}]*$/u.test(tokens[i])) {
      if (tokens[i].toLocaleLowerCase() === nLower) {
        tokens[i] = replacement
      }
    }
  }
  return tokens.join("")
}
