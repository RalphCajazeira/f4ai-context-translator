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
} from "@/services/xtranslator.service.js";

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

    const translations = [];
    for (const chunk of items) {
      const translated = await translateItem({
        text: chunk,
        src,
        tgt,
        preserveLines: true,
      });
      translations.push(translated);
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
