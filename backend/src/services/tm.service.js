import { normalizeForTm } from "@/services/translation-rules.service.js";
import { applyCaseLike } from "@/services/case.service.js";

function tokenCosine(a = "", b = "") {
  const A = normalizeForTm(a).split(/\s+/).filter(Boolean);
  const B = normalizeForTm(b).split(/\s+/).filter(Boolean);
  if (!A.length || !B.length) return 0;
  const set = new Set([...A, ...B]);
  const va = [];
  const vb = [];
  for (const t of set) {
    const ca = A.reduce((n, x) => n + (x === t), 0);
    const cb = B.reduce((n, x) => n + (x === t), 0);
    va.push(ca);
    vb.push(cb);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    na += va[i] ** 2;
    nb += vb[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function adaptToggleOnOff(fromSourceNorm, fromTarget, toOriginal) {
  if (!fromSourceNorm || !fromTarget || !toOriginal) return null;
  let out = String(fromTarget);
  const srcNew = String(toOriginal);
  const PT_ON = "LIGADO";
  const PT_OFF = "DESLIGADO";

  const headerNew = srcNew.match(/:\s*(ON|OFF)\b/i)?.[1]?.toUpperCase();
  if (headerNew) {
    const desired = headerNew === "ON" ? PT_ON : PT_OFF;
    out = out.replace(
      /(:\s*)(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/iu,
      `$1${desired}`
    );
  }

  const whenMatches = [...srcNew.matchAll(/\bWhen\s+(ON|OFF)\b/gi)];
  if (whenMatches.length > 0) {
    let idx = 0;
    out = out.replace(
      /\b(Quando)\s+(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/gi,
      (m, q) => {
        const mSrc = whenMatches[idx++];
        if (!mSrc) return m;
        const desired = mSrc[1].toUpperCase() === "ON" ? PT_ON : PT_OFF;
        return `${q} ${desired}`;
      }
    );
    const needOn = whenMatches.some((m) => m[1].toUpperCase() === "ON");
    const needOff = whenMatches.some((m) => m[1].toUpperCase() === "OFF");
    if (!/\bQuando\s+(ATIVADO|DESATIVADO|LIGADO|DESLIGADO)\b/i.test(out)) {
      if (needOn) out = out.replace(/\bQuando\b/i, `Quando ${PT_ON}`);
      if (needOff) out = out.replace(/\bQuando\b/i, `Quando ${PT_OFF}`);
    }
  }

  out = out.replace(/\bATIVADO\b/gi, PT_ON).replace(/\bDESATIVADO\b/gi, PT_OFF);
  return out;
}

function promoteViaTm({
  text,
  tmPairs = [],
  fuzzyPromoteMin = 0.92,
  maxLenDelta = 0.1,
  requirePatch = true,
} = {}) {
  const srcNorm = normalizeForTm(text);
  if (!srcNorm) return null;

  const tmExact = (tmPairs || []).find(
    (p) => String(p?.sourceNorm || "") === srcNorm
  );
  if (tmExact) {
    return {
      translation: applyCaseLike(text, tmExact.targetText),
      type: "exact",
      source: tmExact,
    };
  }

  let top = null;
  for (const p of tmPairs || []) {
    const sc = tokenCosine(srcNorm, p?.sourceNorm || "");
    if (!top || sc > top.sc) top = { ...p, sc };
  }

  if (!top) return null;

  const lenA = srcNorm.length;
  const lenB = String(top.sourceNorm || "").length;
  const lenOk =
    Math.abs(lenA - lenB) / Math.max(1, Math.max(lenA, lenB)) <= maxLenDelta;
  const patched = adaptToggleOnOff(top.sourceNorm, top.targetText, text);
  const changed = patched && patched !== top.targetText;

  if (
    top.sc >= fuzzyPromoteMin &&
    lenOk &&
    (!requirePatch || changed)
  ) {
    return {
      translation: applyCaseLike(text, patched || top.targetText),
      type: "fuzzy",
      source: top,
      score: top.sc,
      patched,
    };
  }

  return null;
}

export { promoteViaTm };
