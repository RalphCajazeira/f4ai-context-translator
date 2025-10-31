function normalizeNullable(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeSearchTerm(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildSearchVector(...parts) {
  return parts
    .flat()
    .filter((value) => value !== undefined && value !== null)
    .map((value) => normalizeSearchTerm(value))
    .filter(Boolean)
    .join(" ");
}

export { normalizeNullable, normalizeSearchTerm, buildSearchVector };
