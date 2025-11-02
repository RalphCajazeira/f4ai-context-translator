function reEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function escapeTermWithFlexibleWhitespace(term = "") {
  const trimmed = String(term ?? "").trim()
  if (!trimmed) return ""
  return trimmed
    .split(/\s+/)
    .map((piece) => reEscape(piece))
    .join("\\s+")
}

function buildWordBoundaryRegex(terms = []) {
  const patterns = [
    ...new Set(terms.map((term) => String(term || "").trim()).filter(Boolean)),
  ]
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeTermWithFlexibleWhitespace(term))
    .filter((pattern) => pattern.length > 0)

  if (!patterns.length) return null

  return new RegExp(`(?<![\\w-])(?:${patterns.join("|")})(?![\\w-])`, "gi")
}

export { buildWordBoundaryRegex }
