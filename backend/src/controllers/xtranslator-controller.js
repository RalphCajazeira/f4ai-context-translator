import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { buildSearchVector, normalizeNullable } from "@/utils/search.js";
import {
  extractUserMessage,
  extractPrompt,
  extractText,
  splitIntoItems,
  composeFromItems,
  restoreMarkers,
  normalizeMarkers,
} from "@/services/xtranslator.service.js";
import {
  getGlossary,
  buildTmFilters,
  topKExamples,
} from "@/services/suggest.service.js";
import { applyCaseLike, projectGlossaryCaseInSentence } from "@/services/case.service.js";
import {
  normalizeForTm,
  pickGlossaryMatches,
  pickBlacklistMatches,
  applyGlossaryHardReplace,
  enforceAllCapsTerms,
} from "@/services/translation-rules.service.js";
import { translateTextPreservingStructure } from "@/services/xtranslator-line.service.js";

const LOG_ENABLED = process.env.MT_LOG !== "0";

function logDebug(message, payload) {
  if (!LOG_ENABLED) return;
  if (payload === undefined) {
    console.log(`[xtranslator] ${message}`);
  } else {
    console.log(`[xtranslator] ${message}`, payload);
  }
}

function buildGameModFilters(game) {
  const filters = [];
  const normalizedGame = normalizeNullable(game);
  if (normalizedGame) {
    filters.push({ OR: [{ game: normalizedGame }, { game: null }] });
  }

  return filters;
}

function normalizeNewlines(value = "") {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function describeStructure(value = "") {
  const normalized = normalizeNewlines(value);
  const lines = normalized.split("\n");
  return {
    normalized,
    lines,
    blankMask: lines.map((line) => line.trim().length === 0),
  };
}

function structuresMatch(source = "", candidate = "") {
  const src = describeStructure(source);
  const tgt = describeStructure(candidate);
  if (src.lines.length !== tgt.lines.length) return false;
  for (let i = 0; i < src.lines.length; i += 1) {
    if (src.blankMask[i] !== tgt.blankMask[i]) return false;
  }
  return true;
}

function sanitizeSegment(segment = "", original = "") {
  const originalNormalized = normalizeNewlines(original);
  let value = normalizeNewlines(segment);
  if (!originalNormalized.startsWith("\n") && value.startsWith("\n")) {
    value = value.slice(1);
  }
  if (!originalNormalized.endsWith("\n") && value.endsWith("\n")) {
    value = value.slice(0, -1);
  }
  return value;
}

class XTranslatorController {
  async handleChatCompletion(request, response) {
    const {
      model = "gpt-3.5-turbo",
      messages = [],
      src = process.env.MT_SRC || "en",
      tgt = process.env.MT_TGT || "pt-BR",
      metadata = {},
    } = request.body || {};

    const rawContent = extractUserMessage(messages);
    if (!rawContent) {
      throw new AppError("Conteúdo da mensagem não encontrado", 400);
    }

    const prompt = extractPrompt(rawContent);
    const textToTranslate = extractText(rawContent);
    if (!textToTranslate) {
      throw new AppError("Texto para tradução ausente", 400);
    }

    const game = normalizeNullable(metadata.game);
    const mod = normalizeNullable(metadata.mod);

    logDebug("=== Nova solicitação xTranslator ===");
    logDebug("Prompt recebido", prompt);
    logDebug("Texto bruto recebido", textToTranslate);
    logDebug("Metadados", { src, tgt, game, mod });

    const { items, separators } = splitIntoItems(textToTranslate);

    const normalizedItems = items.map((chunk, index) => {
      const normalized = normalizeMarkers(chunk);
      const trimmed = normalized.trim();
      const sourceNorm = normalizeForTm(normalized);
      return { index, original: chunk, normalized, trimmed, sourceNorm };
    });

    if (LOG_ENABLED) {
      for (const item of normalizedItems) {
        logDebug(`Item ${item.index} (original)`, item.original);
        logDebug(`Item ${item.index} (normalizado)`, item.normalized);
      }
    }

    const aggregatedSource = normalizedItems
      .map((item) => item.normalized)
      .join("\n\n\n");

    const tmFilters = buildTmFilters({
      srcLang: src,
      tgtLang: tgt,
      game,
      mod,
    });
    const blacklistFilters = buildGameModFilters(game);

    const sourceNorms = normalizedItems
      .map((item) => item.sourceNorm)
      .filter((value) => value);

    const tmConditions = [...tmFilters];
    if (sourceNorms.length) {
      tmConditions.push({ sourceNorm: { in: sourceNorms } });
    }

    const [glossaryRows, blacklistRows, tmRows] = await Promise.all([
      getGlossary({ game, mod }),
      prisma.blacklistEntry.findMany({
        where: blacklistFilters.length ? { AND: blacklistFilters } : undefined,
      }),
      sourceNorms.length
        ? prisma.translationMemoryEntry.findMany({
            where: tmConditions.length ? { AND: tmConditions } : undefined,
            orderBy: [
              { quality: "desc" },
              { uses: "desc" },
              { updatedAt: "desc" },
            ],
          })
        : [],
    ]);

    const tmByNorm = new Map();
    for (const row of tmRows) {
      const key = row.sourceNorm;
      if (!key) continue;
      const current = tmByNorm.get(key);
      if (
        !current ||
        row.quality > current.quality ||
        (row.quality === current.quality && row.uses > current.uses)
      ) {
        tmByNorm.set(key, row);
      }
    }

    const tmPairs = tmRows.map((row) => ({
      sourceNorm: row.sourceNorm,
      targetText: row.targetText,
    }));

    const matchedGlossary = pickGlossaryMatches(aggregatedSource, glossaryRows);
    const matchedNoTranslate = pickBlacklistMatches(
      aggregatedSource,
      blacklistRows
    );

    logDebug(
      "Glossário encontrado",
      matchedGlossary.map((entry) => ({
        termSource: entry.termSource,
        termTarget: entry.termTarget,
        notes: entry.notes,
      }))
    );
    logDebug("Blacklist encontrada", matchedNoTranslate);

    const blacklistByTerm = new Map(
      (blacklistRows || []).map((row) => [String(row.term).toLowerCase(), row])
    );
    const shotSources = normalizedItems.filter((item) => item.trimmed);
    const shotResults = shotSources.length
      ? await Promise.all(
          shotSources.map((item) =>
            topKExamples(item.normalized, 2, {
              srcLang: src,
              tgtLang: tgt,
              game,
              mod,
            })
          )
        )
      : [];
    const shots = [];
    const shotKeys = new Set();
    for (const result of shotResults) {
      for (const entry of result || []) {
        if (!entry || !entry.src || !entry.tgt) continue;
        const key = `${normalizeForTm(entry.src)}→${normalizeForTm(entry.tgt)}`;
        if (shotKeys.has(key)) continue;
        shotKeys.add(key);
        shots.push({ src: entry.src, tgt: entry.tgt });
        if (shots.length >= 5) break;
      }
      if (shots.length >= 5) break;
    }

    const pairs = [...matchedGlossary, ...tmPairs];

    logDebug(
      "Exemplos (shots) selecionados",
      shots.map((entry) => `${entry.src} → ${entry.tgt}`)
    );

    const postProcessTranslation = async (original, draft) => {
      let best = String(draft || "");
      if (!best) return best;
      best = best
        .replace(/\bATIVADO\b/gi, "LIGADO")
        .replace(/\bDESATIVADO\b/gi, "DESLIGADO")
        .replace(/\b(LIGADO)\s+(ATIVADO|LIGADO)\b/gi, "LIGADO")
        .replace(/\b(DESLIGADO)\s+(DESATIVADO|DESLIGADO)\b/gi, "DESLIGADO");
      best = applyGlossaryHardReplace(
        original,
        best,
        matchedGlossary,
        matchedNoTranslate
      );
      best = projectGlossaryCaseInSentence(original, best, pairs);
      best = await enforceAllCapsTerms({
        original,
        best,
        src,
        tgt,
        shots,
        glossary: matchedGlossary,
      });
      return best;
    };

    const translations = new Array(items.length).fill("");
    const translationEngines = new Array(items.length).fill("ai");

    for (const item of normalizedItems) {
      if (!item.trimmed) {
        translations[item.index] = item.normalized;
        continue;
      }
      const tmHit = item.sourceNorm ? tmByNorm.get(item.sourceNorm) : null;
      if (tmHit?.targetText) {
        const projected = applyCaseLike(item.normalized, tmHit.targetText);
        logDebug(`TM encontrado para item ${item.index}`, {
          source: item.normalized,
          target: tmHit.targetText,
        });
        translations[item.index] = await postProcessTranslation(
          item.normalized,
          projected
        );
        translationEngines[item.index] = "tm";
      }
    }

    const aiItems = normalizedItems.filter(
      (item) => item.trimmed && !translations[item.index]
    );

    if (aiItems.length) {
      const aiNoTranslate = Array.from(new Set(matchedNoTranslate));
      const lineCache = new Map();
      const segmentCache = new Map();

      logDebug("Itens enviados para IA", aiItems.map((item) => item.index));
      logDebug("noTranslate aplicado na IA", aiNoTranslate);

      for (const item of aiItems) {
        let accepted = false;
        try {
          logDebug(`→ IA (item ${item.index}) texto`, item.normalized);
          const translatedBlock = await translateTextPreservingStructure(
            item.normalized,
            {
              src,
              tgt,
              shots,
              glossary: matchedGlossary,
              noTranslate: aiNoTranslate,
              lineCache,
              segmentCache,
            }
          );

          const cleaned = sanitizeSegment(translatedBlock, item.normalized);
          const normalizedCandidate = normalizeNewlines(cleaned);

          if (
            normalizedCandidate &&
            structuresMatch(item.normalized, normalizedCandidate)
          ) {
            const processed = await postProcessTranslation(
              item.normalized,
              normalizedCandidate
            );
            const processedNormalized = normalizeNewlines(processed);
            if (
              processedNormalized &&
              structuresMatch(item.normalized, processedNormalized)
            ) {
              translations[item.index] = processedNormalized;
              translationEngines[item.index] = "ai";
              accepted = true;
              logDebug(
                `← IA (item ${item.index}) texto aceito`,
                processedNormalized
              );
            }
          }
        } catch (error) {
          if (process.env.MT_LOG !== "0") {
            console.warn(
              "[xtranslator] Erro ao traduzir item — mantendo texto original (idx:",
              item.index,
              ")",
              error
            );
          }
        }

        if (!accepted) {
          translations[item.index] = item.normalized;
          translationEngines[item.index] = "source";
          if (process.env.MT_LOG !== "0") {
            console.warn(
              "[xtranslator] IA retornou item inválido — mantendo texto original (idx:",
              item.index,
              ")"
            );
            logDebug(`IA rejeitada — mantendo original (item ${item.index})`);
          }
        }
      }
    }

    for (const item of normalizedItems) {
      if (!translations[item.index]) {
        translations[item.index] = item.normalized;
      }
    }

    const normalizedResponse = composeFromItems(translations, separators);
    const finalResponse = restoreMarkers(normalizedResponse);

    logDebug("Traduções consolidadas", translations);
    logDebug("Resposta final", finalResponse);

    const requestRecord = await prisma.xTranslatorRequest.create({
      data: {
        externalId:
          request.body?.id !== undefined && request.body?.id !== null
            ? String(request.body.id)
            : null,
        model,
        prompt,
        rawSource: textToTranslate,
        status: "processing",
      },
    });

    try {
      const logData = items
        .map((chunk, index) => ({
          source: chunk,
          target: translations[index] ?? "",
          position: index,
        }))
        .filter((entry) => String(entry.source || "").trim().length > 0)
        .map((entry) => ({
          sourceText: restoreMarkers(entry.source),
          targetText: restoreMarkers(entry.target),
          engine: translationEngines[entry.position] ?? "ai",
          origin: "xtranslator",
          approved: 0,
          game,
          mod,
          searchText: buildSearchVector(
            entry.source,
            entry.target,
            "xtranslator",
            translationEngines[entry.position] ?? "ai",
            game ?? "",
            mod ?? ""
          ),
          batchId: requestRecord.id,
          batchPos: entry.position,
        }));

      if (logData.length) {
        await prisma.translationLog.createMany({ data: logData });
      }

      await prisma.xTranslatorRequest.update({
        where: { id: requestRecord.id },
        data: {
          rawResponse: finalResponse,
          status: "completed",
        },
      });
    } catch (error) {
      await prisma.xTranslatorRequest.update({
        where: { id: requestRecord.id },
        data: { status: "failed" },
      });
      throw error;
    }

    return response.json({
      id: `xtranslator-${requestRecord.id}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: finalResponse },
          finish_reason: "stop",
        },
      ],
    });
  }

  async listRequests(request, response) {
    const { limit = "50" } = request.query;
    const take = Math.min(Number(limit) || 50, 100);

    const rows = await prisma.xTranslatorRequest.findMany({
      orderBy: { id: "desc" },
      take,
      include: { _count: { select: { items: true } } },
    });

    return response.json({
      items: rows.map((row) => ({
        id: row.id,
        external_id: row.externalId ?? null,
        model: row.model ?? null,
        prompt: row.prompt ?? null,
        raw_source: row.rawSource ?? null,
        raw_response: row.rawResponse ?? null,
        status: row.status ?? "completed",
        item_count: row._count?.items ?? 0,
        created_at: row.createdAt?.toISOString?.() ?? null,
        updated_at: row.updatedAt?.toISOString?.() ?? null,
      })),
    });
  }
}

export { XTranslatorController };
