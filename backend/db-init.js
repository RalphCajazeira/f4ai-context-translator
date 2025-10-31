import fs from "node:fs"
import path from "node:path"
import { getDB } from "./db.js"

const schema = fs.readFileSync(path.resolve("backend/schema.sql"), "utf8")
const db = getDB()

const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })

async function ensureTmLanguageColumns() {
  const tables = await all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tm_entries'"
  )
  if (!tables.length) return

  const columns = await all("PRAGMA table_info(tm_entries)")
  const names = new Set(columns.map((c) => c.name))

  if (!names.has("src_lang")) {
    await run("ALTER TABLE tm_entries ADD COLUMN src_lang TEXT DEFAULT ''")
  }
  if (!names.has("tgt_lang")) {
    await run("ALTER TABLE tm_entries ADD COLUMN tgt_lang TEXT DEFAULT ''")
  }
}

async function main() {
  try {
    await ensureTmLanguageColumns()
    await exec(schema)
    console.log("✔ DB inicializado com sqlite3")
    process.exit(0)
  } catch (err) {
    console.error("Erro ao inicializar DB:", err)
    process.exit(1)
  }
}

main()
