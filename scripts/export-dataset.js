import fs from "node:fs";
import path from "node:path";

import "../backend/src/configs/env.js";
import { prisma } from "../backend/src/database/prisma.js";

const rows = await prisma.translationMemoryEntry.findMany({
  select: {
    sourceNorm: true,
    targetText: true,
  },
  orderBy: { lastUsedAt: "desc" },
});

const outputPath = path.resolve("data/dataset.jsonl");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const data = rows
  .map((row) =>
    JSON.stringify({ source_text: row.sourceNorm, target_text: row.targetText })
  )
  .join("\n");

fs.writeFileSync(outputPath, data);
console.log("✔ Exportado", outputPath, "com", rows.length, "pares.");

await prisma.$disconnect();
