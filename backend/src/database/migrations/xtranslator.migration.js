import { prisma } from "@/database/prisma.js";

const KNOWN_TABLES = new Set(["translation_logs"]);

async function ensureColumn(tableName, columnName, alterStatement) {
  if (!KNOWN_TABLES.has(tableName)) {
    throw new Error(`Tentativa de alterar tabela desconhecida: ${tableName}`);
  }

  const columns = await prisma.$queryRawUnsafe(
    `PRAGMA table_info(${tableName});`
  );
  const exists = Array.isArray(columns)
    ? columns.some((column) => column?.name === columnName)
    : false;

  if (!exists) {
    await prisma.$executeRawUnsafe(alterStatement);
  }
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS xtranslator_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT,
      model TEXT,
      prompt TEXT,
      raw_source TEXT,
      raw_response TEXT,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_xtranslator_requests_created
      ON xtranslator_requests(created_at DESC);
  `);
}

async function ensureXTranslatorSchema() {
  await ensureTable();

  await ensureColumn(
    "translation_logs",
    "batch_id",
    "ALTER TABLE translation_logs ADD COLUMN batch_id INTEGER;"
  );

  await ensureColumn(
    "translation_logs",
    "batch_pos",
    "ALTER TABLE translation_logs ADD COLUMN batch_pos INTEGER;"
  );
}

export { ensureXTranslatorSchema };
