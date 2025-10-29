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
  return String(s || "")
    .toLowerCase()
    .replace(/\b\p{L}[\p{L}\p{M}]*/gu, (w) => w[0].toUpperCase() + w.slice(1))
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
