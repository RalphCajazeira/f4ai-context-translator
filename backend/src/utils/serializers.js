function toISO(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  try {
    if (value && typeof value.toISOString === "function") {
      return value.toISOString();
    }
  } catch (error) {
    // ignore
  }
  return String(value);
}

function serializeTranslationMemory(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    source_norm: entry.sourceNorm,
    target_text: entry.targetText,
    src_lang: entry.srcLang ?? "",
    tgt_lang: entry.tgtLang ?? "",
    uses: entry.uses ?? 0,
    quality: entry.quality ?? 0,
    game: entry.game ?? null,
    mod: entry.mod ?? null,
    created_at: toISO(entry.createdAt),
    updated_at: toISO(entry.updatedAt),
    last_used_at: toISO(entry.lastUsedAt),
  };
}

function serializeGlossaryEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    term_source: entry.termSource,
    term_target: entry.termTarget,
    notes: entry.notes ?? null,
    game: entry.game ?? null,
    mod: entry.mod ?? null,
    approved: entry.approved ?? false,
    created_at: toISO(entry.createdAt),
    updated_at: toISO(entry.updatedAt),
  };
}

function serializeBlacklistEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    term: entry.term,
    notes: entry.notes ?? null,
    game: entry.game ?? null,
    mod: entry.mod ?? null,
    created_at: toISO(entry.createdAt),
    updated_at: toISO(entry.updatedAt),
  };
}

function serializeTranslationLog(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    source_text: entry.sourceText,
    target_text: entry.targetText,
    engine: entry.engine ?? "ai",
    origin: entry.origin ?? "ui",
    approved: entry.approved ?? 0,
    game: entry.game ?? null,
    mod: entry.mod ?? null,
    batch_id: entry.batchId ?? null,
    batch_pos: entry.batchPos ?? null,
    created_at: toISO(entry.createdAt),
    updated_at: toISO(entry.updatedAt),
  };
}

function serializeSegment(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    file: entry.file ?? null,
    context: entry.context ?? null,
    source_text: entry.sourceText,
    target_text: entry.targetText ?? null,
    status: entry.status ?? "new",
    game: entry.game ?? null,
    mod: entry.mod ?? null,
    created_at: toISO(entry.createdAt),
    updated_at: toISO(entry.updatedAt),
  };
}

export {
  serializeTranslationMemory,
  serializeGlossaryEntry,
  serializeBlacklistEntry,
  serializeTranslationLog,
  serializeSegment,
};
