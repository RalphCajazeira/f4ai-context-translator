import { prisma } from "@/database/prisma.js";
import { AppError } from "@/utils/app-error.js";
import { buildSearchVector, normalizeNullable } from "@/utils/search.js";
import {
  extractUserMessage,
  extractPrompt,
  extractText,
  splitIntoItems,
  composeFromItems,
  translateItem,
  restoreMarkers,
  normalizeMarkers,
} from "@/services/xtranslator.service.js";
import { translateWithContext } from "@/services/mt-client.service.js";
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
  buildContextBlock,
} from "@/services/translation-rules.service.js";

function buildGameModFilters(game, mod) {
  const filters = [];
  const normalizedGame = normalizeNullable(game);
  if (normalizedGame) {
    filters.push({ OR: [{ game: normalizedGame }, { game: null }] });
  }

  const normalizedMod = normalizeNullable(mod);
  if (normalizedMod) {
    const modOptions = [{ mod: normalizedMod }, { mod: null }, { mod: "" }];
    if (normalizedGame) {
      modOptions.push({ game: normalizedGame });
    }
    filters.push({ OR: modOptions });
  }

  return filters;
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

    const { items, separators } = splitIntoItems(textToTranslate);

    const normalizedItems = items.map((chunk, index) => {
      const normalized = normalizeMarkers(chunk);
      const trimmed = normalized.trim();
      const sourceNorm = normalizeForTm(normalized);
      return { index, original: chunk, normalized, trimmed, sourceNorm };
    });

    const aggregatedSource = normalizedItems
      .map((item) => item.normalized)
      .join("\n\n\n");

    const tmFilters = buildTmFilters({
      srcLang: src,
      tgtLang: tgt,
      game,
      mod,
    });
    const blacklistFilters = buildGameModFilters(game, mod);

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
    const matchedNoTranslate = pickBlacklistMatches(aggregatedSource, blacklistRows);

    const contextBlock = buildContextBlock(matchedGlossary, matchedBlacklistRows);

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

    for (const item of normalizedItems) {
      if (!item.trimmed) {
        translations[item.index] = item.normalized;
        continue;
      }
      const tmHit = item.sourceNorm ? tmByNorm.get(item.sourceNorm) : null;
      if (tmHit?.targetText) {
        const projected = applyCaseLike(item.normalized, tmHit.targetText);
        translations[item.index] = await postProcessTranslation(
          item.normalized,
          projected
        );
      }
    }

    const aiItems = normalizedItems.filter(
      (item) => item.trimmed && !translations[item.index]
    );

    if (aiItems.length) {
      const startMarker = (index) => `⟪XT_ITEM_${index}_IN⟫`;
      const endMarker = (index) => `⟪XT_ITEM_${index}_OUT⟫`;

      const segments = aiItems
        .map(
          (item) =>
            `${startMarker(item.index)}\n${item.normalized}\n${endMarker(item.index)}`
        )
        .join("\n\n");

      const markerList = aiItems.flatMap((item) => [
        startMarker(item.index),
        endMarker(item.index),
      ]);
      const aiNoTranslate = Array.from(
        new Set([...matchedNoTranslate, ...markerList])
      );

      let aiOutput = segments;
      if (segments.trim()) {
        const contextualSegments = contextBlock
          ? `${contextBlock}\n\n${segments}`
          : segments;
        aiOutput = await translateWithContext({
          text: contextualSegments,
          src,
          tgt,
          shots,
          glossary: matchedGlossary,
          noTranslate: aiNoTranslate,
        });
      }

      const outText = String(aiOutput || segments);
      let cursor = 0;

      for (const item of aiItems) {
        const start = startMarker(item.index);
        const end = endMarker(item.index);
        const startIdx = outText.indexOf(start, cursor);
        let extracted = "";
        if (startIdx !== -1) {
          const contentStart = startIdx + start.length;
          const endIdx = outText.indexOf(end, contentStart);
          if (endIdx !== -1) {
            extracted = outText.slice(contentStart, endIdx).trim();
            cursor = endIdx + end.length;
          }
        }

        if (!extracted) {
          extracted = await translateItem({
            text: item.original,
            src,
            tgt,
            shots,
            preserveLines: true,
            glossary: matchedGlossary,
            contextBlock,
            noTranslate: matchedNoTranslate,
          });
        }

        translations[item.index] =
          (await postProcessTranslation(item.normalized, extracted)) ||
          item.normalized;
      }
    }

    for (const item of normalizedItems) {
      if (!translations[item.index]) {
        translations[item.index] = item.normalized;
      }
    }

    const normalizedResponse = composeFromItems(translations, separators);
    const finalResponse = restoreMarkers(normalizedResponse);

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
          origin: "xtranslator",
          approved: 0,
          game,
          mod,
          searchText: buildSearchVector(
            entry.source,
            entry.target,
            "xtranslator",
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
