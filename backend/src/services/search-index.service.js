import { prisma } from "@/database/prisma.js";
import { buildSearchVector } from "@/utils/search.js";

async function backfillGlossary(batch = 100) {
  while (true) {
    const rows = await prisma.glossaryEntry.findMany({
      where: { searchText: "" },
      select: {
        id: true,
        termSource: true,
        termTarget: true,
        notes: true,
        game: true,
        mod: true,
      },
      take: batch,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const searchText = buildSearchVector(
        row.termSource,
        row.termTarget,
        row.notes ?? "",
        row.game ?? "",
        row.mod ?? ""
      );
      await prisma.glossaryEntry.update({
        where: { id: row.id },
        data: { searchText },
      });
    }
  }
}

async function backfillBlacklist(batch = 100) {
  while (true) {
    const rows = await prisma.blacklistEntry.findMany({
      where: { searchText: "" },
      select: {
        id: true,
        term: true,
        notes: true,
        game: true,
        mod: true,
      },
      take: batch,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const searchText = buildSearchVector(
        row.term,
        row.notes ?? "",
        row.game ?? "",
        row.mod ?? ""
      );
      await prisma.blacklistEntry.update({
        where: { id: row.id },
        data: { searchText },
      });
    }
  }
}

async function backfillLogs(batch = 200) {
  while (true) {
    const rows = await prisma.translationLog.findMany({
      where: { searchText: "" },
      select: {
        id: true,
        sourceText: true,
        targetText: true,
        origin: true,
        game: true,
        mod: true,
      },
      orderBy: { id: "asc" },
      take: batch,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const searchText = buildSearchVector(
        row.sourceText,
        row.targetText,
        row.origin,
        row.game ?? "",
        row.mod ?? ""
      );
      await prisma.translationLog.update({
        where: { id: row.id },
        data: { searchText },
      });
    }
  }
}

export async function ensureSearchVectors() {
  await backfillGlossary();
  await backfillBlacklist();
  await backfillLogs();
}
