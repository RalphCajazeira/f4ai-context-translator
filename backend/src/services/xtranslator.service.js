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

function splitIntoItems(text = "") {
  const normalized = normalizeMarkers(text);
  const items = [];
  const separators = [];
  const regex = /\n{3,}/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(normalized))) {
    const chunk = normalized.slice(lastIndex, match.index);
    items.push(chunk);
    separators.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  const tail = normalized.slice(lastIndex);
  if (tail !== "" || !items.length) {
    items.push(tail);
  }
  return { items, separators };
}

function composeFromItems(items = [], separators = []) {
  const pieces = [];
  const total = Math.max(items.length, separators.length + 1);
  for (let i = 0; i < total; i++) {
    if (i < items.length) pieces.push(items[i]);
    if (i < separators.length) pieces.push(separators[i]);
  }
  return pieces.join("");
}

export {
  extractUserMessage,
  extractPrompt,
  extractText,
  normalizeMarkers,
  restoreMarkers,
  splitIntoItems,
  composeFromItems,
};
