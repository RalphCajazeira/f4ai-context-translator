import { prisma } from "@/database/prisma.js";
import {
  getSuggestions,
  topKExamples,
  recordApproval,
  getGlossary,
} from "@/services/suggest.service.js";
import {
  translateWithContext,
  forceTranslateWithOllama,
} from "@/services/mt-client.service.js";
import {
  projectGlossaryCaseInSentence,
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "@/services/case.service.js";
import { AppError } from "@/utils/app-error.js";
import { buildSearchVector } from "@/utils/search.js";

function norm(value = "") {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function tokenCosine(a, b) {
  const A = norm(a).split(/\s+/).filter(Boolean);
  const B = norm(b).split(/\s+/).filter(Boolean);
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

function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWBRegex(terms = []) {
  const parts = [
    ...new Set(terms.map((t) => String(t || "").trim()).filter(Boolean)),
  ]
    .sort((a, b) => b.length - a.length)
    .map(reEscape);
  if (!parts.length) return null;
  return new RegExp(`(?<![\\w-])(?:${parts.join("|")})(?![\\w-])`, "gi");
}

function pickBlacklistMatches(text, rows) {
  const terms = (rows || []).map((r) => r.term).filter(Boolean);
  const re = buildWBRegex(terms);
  if (!re) return [];
  const found = new Set();
  String(text).replace(re, (m) => {
    found.add(m.toLowerCase());
    return m;
  });
  return terms.filter((t) => found.has(String(t).toLowerCase()));
}

function pickGlossaryMatches(text, rows) {
  const terms = (rows || []).map((r) => r.termSource).filter(Boolean);
  const re = buildWBRegex(terms);
  if (!re) return [];
  const seen = new Set();
  const byKey = new Map((rows || []).map((r) => [String(r.termSource).toLowerCase(), r]));
  String(text).replace(re, (m) => {
    seen.add(m.toLowerCase());
    return m;
  });
  return [...seen].map((k) => byKey.get(k)).filter(Boolean);
}

function buildGlossPatterns(glossary = [], noTranslate = []) {
  const blocked = new Set((noTranslate || []).map((t) => String(t).toLowerCase()));
  const rows = (glossary || [])
    .filter((g) => g && g.termSource && g.termTarget && (g.approved ?? 1))
    .filter((g) => !blocked.has(String(g.termSource).toLowerCase()))
    .sort((a, b) => b.termSource.length - a.termSource.length);
  return rows.map((g) => {
    const pat = `(?<![\\w-])${reEscape(g.termSource)}(?![\\w-])`;
    return { re: new RegExp(pat, "gi"), target: g.termTarget };
  });
}

function applyGlossaryHardReplace(sourceText, translatedText, glossary, noTranslate) {
  if (!translatedText) return translatedText;
  const patterns = buildGlossPatterns(glossary, noTranslate);
  if (!patterns.length) return translatedText;
  let out = String(translatedText);
  for (const { re, target } of patterns) out = out.replace(re, target);
  return out;
}

async function enforceAllCapsTerms({
  original,
  best,
  src,
  tgt,
  shots,
  glossary,
}) {
  let out = String(best || "");
  const caps = extractAllCapsTerms(original);
  if (!caps.length || !out) return out;

  const uniqueCaps = Array.from(new Set(capsOnly(caps)));
  for (const term of uniqueCaps) {
    let t = "";
    try {
      const promptWord = `Traduza apenas esta palavra (forma básica):\n${term}`;
      t = await translateWithContext({
        text: promptWord,
        src,
        tgt,
        shots,
        glossary,
      });
      t = String(t || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^.*?\n/, "")
        .trim();
    } catch {
      t = "";
    }
    if (!t) continue;
    const projected = applyCaseLike(term, t);
    out = replaceWordUnicode(out, t, projected);
  }
  return out;
}

function capsOnly(arr) {
  const set = new Set();
  for (const w of arr) {
    if (/\b[\p{Lu}]{2,}\b/u.test(w)) set.add(w);
  }
  return Array.from(set);
}

function buildContextBlock(matchedGlossary = [], matchedBlacklistRows = []) {
  const lines = [];
  if (matchedBlacklistRows.length) {
    lines.push("### CONTEXTO — BLACKLIST (não traduzir):");
    for (const b of matchedBlacklistRows) {
      const term = b.term;
      const notes = (b.notes || "").trim();
      lines.push(`- ${term}${notes ? ` — ${notes}` : ""}`);
    }
    lines.push("");
  }
  if (matchedGlossary.length) {
    lines.push("### CONTEXTO — GLOSSÁRIO (usar tradução fixa):");
    for (const g of matchedGlossary) {
      const src = g.termSource;
      const tgt = g.termTarget;
      const notes = (g.notes || "").trim();
      lines.push(`- ${src} → ${tgt}${notes ? ` — ${notes}` : ""}`);
    }
    lines.push("");
  }
  return lines.length ? lines.join("\n") : "";
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function buildGameModFilters(game, mod) {
  const filters = [];
  const normalizedGame = normalizeOptional(game);
  if (normalizedGame) {
    filters.push({ OR: [{ game: normalizedGame }, { game: null }] });
  }

  const normalizedMod = normalizeOptional(mod);
  if (normalizedMod) {
    filters.push({ OR: [{ mod: normalizedMod }, { mod: null }] });
  }

  return filters;
}

async function translatePreservingLines({
  text,
  src,
  tgt,
  shots,
  glossary,
  contextBlock = "",
  noTranslate = [],
}) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    if (ln.trim() === "") {
      out.push("");
      continue;
    }

    const promptLine =
      (contextBlock ? contextBlock + "\n\n" : "") +
      `Traduza LITERALMENTE para ${tgt}. Responda só a tradução desta linha, sem explicações, sem aspas:\n${ln}`;

    try {
      let clean = await translateWithContext({
        text: promptLine,
        src,
        tgt,
        shots,
        glossary,
        noTranslate,
      });
      clean = String(clean || "")
        .replace(/^\s*(?:traduza\s+apenas[^\n:]*:\s*)/i, "")
        .replace(/^\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i, "")
        .replace(
          /^(?:en|english)\s*:\s*[^\n]*\n\s*(?:pt-?br|portugu[eê]s)\s*:\s*/i,
          ""
        )
        .replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/i, "$1")
        .trimEnd();

      if (norm(clean) === norm(ln)) {
        const forced = await forceTranslateWithOllama(ln, src, tgt);
        if (norm(forced) !== norm(ln)) clean = forced;
      }
      out.push(clean);
    } catch {
      try {
        out.push((await forceTranslateWithOllama(ln, src, tgt)) || ln);
      } catch {
        out.push(ln);
      }
    }
  }
  return out.join("\n");
}

class TranslateController {
  async create(request, response) {
    const {
      text,
      src = process.env.MT_SRC || "en",
      tgt = process.env.MT_TGT || "pt",
      preserveLines = true,
      log = false,
      origin = "ui",
      game: rawGame = null,
      mod: rawMod = null,
    } = request.body || {};

    if (!text) {
      throw new AppError("text é obrigatório", 400);
    }

    const game = typeof rawGame === "string" ? rawGame.trim() : "";
    const mod = typeof rawMod === "string" ? rawMod.trim() : "";

    if (!game || !mod) {
      throw new AppError("game e mod são obrigatórios", 400);
    }

    const filters = { game, mod, srcLang: src, tgtLang: tgt };
    const tmFilters = buildGameModFilters(game, mod);
    const normalizedSrc = normalizeOptional(src) ?? "";
    const normalizedTgt = normalizeOptional(tgt) ?? "";
    tmFilters.push({ OR: [{ srcLang: normalizedSrc }, { srcLang: "" }] });
    tmFilters.push({ OR: [{ tgtLang: normalizedTgt }, { tgtLang: "" }] });

    const blacklistFilters = buildGameModFilters(game, mod);

    const [shots, glossaryRows, suggestions, tmPairs, blacklistRows] =
      await Promise.all([
        topKExamples(text, 5, filters),
        getGlossary({ game, mod }),
        getSuggestions(text, src, tgt, 8, { game, mod }),
        prisma.translationMemoryEntry.findMany({
          where: tmFilters.length ? { AND: tmFilters } : undefined,
          select: { sourceNorm: true, targetText: true },
          take: 500,
        }),
        prisma.blacklistEntry.findMany({
          where: blacklistFilters.length ? { AND: blacklistFilters } : undefined,
        }),
      ]);

    const matchedGlossary = pickGlossaryMatches(text, glossaryRows);
    const matchedNoTranslate = pickBlacklistMatches(text, blacklistRows);

    const byTerm = new Map(
      (blacklistRows || []).map((r) => [String(r.term).toLowerCase(), r])
    );
    const matchedBlacklistRows = matchedNoTranslate
      .map((t) => byTerm.get(String(t).toLowerCase()))
      .filter(Boolean);

    const onlyBlacklist = (() => {
      if (!matchedNoTranslate.length) return false;
      const re = buildWBRegex(matchedNoTranslate);
      const residual = String(text)
        .replace(re, "")
        .replace(/[^\p{L}\p{N}]+/gu, "")
        .trim();
      return residual.length === 0;
    })();

    if (onlyBlacklist) {
      if (process.env.MT_LOG !== "0") {
        console.log(
          "[translate] Texto contém apenas termos da blacklist — IA não será chamada."
        );
      }
      return response.json({
        best: text,
        candidates: [],
        matched: {
          glossary: matchedGlossary,
          blacklist: matchedBlacklistRows.map(({ term, notes }) => ({
            term,
            notes,
          })),
        },
      });
    }

    const contextBlock = buildContextBlock(matchedGlossary, matchedBlacklistRows);

    if (process.env.MT_LOG !== "0") {
      console.log("\n=== [translate] Requisição recebida ===");
      console.log("src → tgt:", src, "→", tgt);
      console.log("Texto original:\n" + text);
      console.log(
        "Glossário detectado:",
        matchedGlossary.map((g) => g.termSource)
      );
      console.log(
        "Blacklist detectada:",
        matchedBlacklistRows.map((b) => b.term)
      );
      if (contextBlock)
        console.log("[translate] Contexto enviado (preview):\n" + contextBlock);
    }

    try {
      const srcNorm = norm(text);
      let best = "";

      const FUZZY_PROMOTE_MIN = Number(process.env.TM_FUZZY_PROMOTE_MIN ?? 0.92);
      const MAX_LEN_DELTA = Number(process.env.TM_FUZZY_MAX_LEN_DELTA ?? 0.1);
      const REQUIRE_PATCH =
        String(process.env.TM_FUZZY_REQUIRE_PATCH ?? "true").toLowerCase() ===
        "true";

      const tmExact = (tmPairs || []).find((p) => p.sourceNorm === srcNorm);
      if (tmExact) {
        best = applyCaseLike(text, tmExact.targetText);
        if (process.env.MT_LOG !== "0")
          console.log("[translate] Hit TM exata. Pulando chamada à IA.");
      } else {
        let top = null;
        for (const p of tmPairs || []) {
          const sc = tokenCosine(srcNorm, p.sourceNorm || "");
          if (!top || sc > top.sc) top = { ...p, sc };
        }
        if (top) {
          const lenA = srcNorm.length;
          const lenB = (top.sourceNorm || "").length;
          const lenOk =
            Math.abs(lenA - lenB) / Math.max(1, Math.max(lenA, lenB)) <=
            MAX_LEN_DELTA;
          const patched = adaptToggleOnOff(top.sourceNorm, top.targetText, text);
          const changed = patched && patched !== top.targetText;
          if (
            top.sc >= FUZZY_PROMOTE_MIN &&
            lenOk &&
            (!REQUIRE_PATCH || changed)
          ) {
            best = applyCaseLike(text, patched || top.targetText);
            if (process.env.MT_LOG !== "0") {
              console.log(
                "[translate] Promovido via TM fuzzy (score:",
                top.sc.toFixed(3) + ")"
              );
            }
          }
        }
      }

      const isSingleLine = !/\r?\n/.test(text);
      const words = String(text).trim().split(/\s+/).filter(Boolean);
      const isVeryShort = text.length <= 32 || words.length <= 4;

      if (!best) {
        if (process.env.MT_LOG !== "0") {
          console.log(
            "[translate] Chamando IA… (preserveLines:",
            !!preserveLines,
            ", veryShort:",
            !!isVeryShort,
            ")"
          );
        }
        const contextualText = contextBlock ? `${contextBlock}\n\n${text}` : text;

        best =
          isSingleLine && isVeryShort
            ? await translateWithContext({
                text: contextualText,
                src,
                tgt,
                shots,
                glossary: matchedGlossary,
                noTranslate: matchedNoTranslate,
              })
            : preserveLines
            ? await translatePreservingLines({
                text,
                src,
                tgt,
                shots,
                glossary: matchedGlossary,
                contextBlock,
                noTranslate: matchedNoTranslate,
              })
            : await translateWithContext({
                text: contextualText,
                src,
                tgt,
                shots,
                glossary: matchedGlossary,
                noTranslate: matchedNoTranslate,
              });
      }

      best = best
        .replace(/\bATIVADO\b/gi, "LIGADO")
        .replace(/\bDESATIVADO\b/gi, "DESLIGADO")
        .replace(/\b(LIGADO)\s+(ATIVADO|LIGADO)\b/gi, "LIGADO")
        .replace(/\b(DESLIGADO)\s+(DESATIVADO|DESLIGADO)\b/gi, "DESLIGADO");

      best = applyGlossaryHardReplace(
        text,
        best,
        matchedGlossary,
        matchedNoTranslate
      );

      const pairs = [...matchedGlossary, ...tmPairs];
      best = projectGlossaryCaseInSentence(text, best, pairs);
      best = await enforceAllCapsTerms({
        original: text,
        best,
        src,
        tgt,
        shots,
        glossary: matchedGlossary,
      });

      const candidates = (suggestions || []).map((c) => ({
        ...c,
        text: projectGlossaryCaseInSentence(text, c.text, pairs),
      }));

      if (log) {
        const logOrigin = origin || "api";
        await prisma.translationLog.create({
          data: {
            sourceText: text,
            targetText: best,
            origin: logOrigin,
            game,
            mod,
            searchText: buildSearchVector(text, best, logOrigin, game, mod),
          },
        });
      }

      if (process.env.MT_LOG !== "0") {
        console.log("=== [translate] Resposta final ===");
        console.log("best:\n" + best);
        console.log(
          "candidates:",
          candidates.map((c) => c.text)
        );
        console.log(
          "matched.glossary:",
          matchedGlossary.map((g) => g.termSource)
        );
        console.log(
          "matched.blacklist:",
          matchedBlacklistRows.map((b) => b.term)
        );
        console.log("===================================\n");
      }

      return response.json({
        best,
        candidates,
        matched: {
          glossary: matchedGlossary,
          blacklist: matchedBlacklistRows.map(({ term, notes }) => ({
            term,
            notes,
          })),
        },
      });
    } catch (error) {
      if (process.env.MT_LOG !== "0") {
        console.error(
          "[translate] ERRO durante tradução:",
          error?.message || error
        );
      }
      const best = (suggestions && suggestions[0]?.text) || "";
      if (log) {
        const logOrigin = origin || "api";
        await prisma.translationLog.create({
          data: {
            sourceText: text,
            targetText: best,
            origin: logOrigin,
            game,
            mod,
            searchText: buildSearchVector(text, best, logOrigin, game, mod),
          },
        });
      }
      return response.json({ best, candidates: suggestions || [] });
    }
  }

  async approve(request, response) {
    const {
      source_text,
      target_text,
      log_id,
      removeFromLog = true,
      src_lang = process.env.MT_SRC || "en",
      tgt_lang = process.env.MT_TGT || "pt",
      game = null,
      mod = null,
    } = request.body || {};

    if (!source_text || !target_text) {
      throw new AppError("source_text e target_text são obrigatórios", 400);
    }

    await recordApproval(source_text, target_text, src_lang, tgt_lang, {
      game,
      mod,
    });

    let removedLogId = null;
    try {
      if (removeFromLog) {
        if (log_id) {
          await prisma.translationLog.delete({ where: { id: Number(log_id) } });
          removedLogId = Number(log_id);
        } else {
          const row = await prisma.translationLog.findFirst({
            where: {
              sourceText: source_text,
              approved: 0,
            },
            orderBy: { createdAt: "desc" },
          });
          if (row?.id) {
            await prisma.translationLog.delete({ where: { id: row.id } });
            removedLogId = row.id;
          }
        }
      }
    } catch (error) {
      if (process.env.MT_LOG !== "0") {
        console.warn("[translate] Não foi possível remover log após aprovação", error);
      }
    }

    return response.json({ ok: true, removedLogId });
  }
}

export { TranslateController };
