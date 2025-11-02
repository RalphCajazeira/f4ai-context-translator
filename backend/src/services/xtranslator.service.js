function extractUserMessage(messages = []) {
  if (!Array.isArray(messages)) return "";
  const userMsg = messages.find((message) => message && message.role === "user");
  return userMsg?.content ?? "";
}

function extractPrompt(content = "") {
  const lines = String(content).split(/\r?\n/);
  if (!lines.length) return "";
  return lines[0].trim();
}

function extractText(content = "") {
  const lines = String(content).split(/\r?\n/);
  if (lines.length <= 1) return String(content);
  return lines.slice(1).join("\n");
}

function normalizeMarkers(value = "") {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/<L_F>/g, "\n");
}

function restoreMarkers(value = "") {
  return String(value).replace(/\n/g, "<L_F>");
}

function normalizeNewlines(value = "") {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function isPreflightText(text = "") {
  return String(text).includes("<L_F>");
}

function formatPreflightResponse(text = "") {
  const segments = String(text).split("<L_F>");
  return segments
    .map((segment) => {
      if (segment.trim().length === 0) {
        return segment;
      }
      const leading = segment.match(/^\s*/)?.[0] ?? "";
      const body = segment.slice(leading.length);
      return `${leading}Resposta ${body}`;
    })
    .join("<L_F>");
}

function parseFinalStructure(text = "") {
  const normalized = normalizeNewlines(text);
  const trimmed = normalized.trim();
  if (!trimmed) {
    return { records: [], units: [], hasParagraphBreaks: false };
  }

  const hasParagraphBreaks = /\n\s*\n/.test(normalized);
  const records = [];
  const units = [];

  if (hasParagraphBreaks) {
    const chunks = normalized.split(/\n{2,}/);
    for (const chunk of chunks) {
      const lineEntries = chunk
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (!lineEntries.length) continue;
      const record = { unitIndices: [] };
      for (const line of lineEntries) {
        const index = units.length;
        units.push({ index, text: line });
        record.unitIndices.push(index);
      }
      records.push(record);
    }
  } else {
    const lineEntries = normalized
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lineEntries) {
      const index = units.length;
      units.push({ index, text: line });
      records.push({ unitIndices: [index] });
    }
  }

  return { records, units, hasParagraphBreaks };
}

function buildFormattedResponse({
  records = [],
  units = [],
  translations = [],
  hasParagraphBreaks = false,
} = {}) {
  if (!records.length) return "";
  const recordOutputs = [];
  for (let recordIdx = 0; recordIdx < records.length; recordIdx += 1) {
    const record = records[recordIdx];
    if (!record?.unitIndices?.length) continue;
    const numberingBase = recordIdx + 1;
    const lineOutputs = record.unitIndices.map((unitIndex, innerIdx) => {
      const numbering =
        record.unitIndices.length > 1
          ? `${numberingBase}.${innerIdx + 1}`
          : `${numberingBase}`;
      const content =
        translations[unitIndex]?.trim?.() ?? units[unitIndex]?.text ?? "";
      return `Resposta ${numbering} ${content}`.trim();
    });
    if (lineOutputs.length) {
      recordOutputs.push(lineOutputs.join("\n"));
    }
  }

  const separator = hasParagraphBreaks ? "\n\n" : "\n";
  return recordOutputs.join(separator);
}

export {
  extractUserMessage,
  extractPrompt,
  extractText,
  normalizeMarkers,
  restoreMarkers,
  normalizeNewlines,
  isPreflightText,
  formatPreflightResponse,
  parseFinalStructure,
  buildFormattedResponse,
};
