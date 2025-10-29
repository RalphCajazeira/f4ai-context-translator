import fs from "node:fs"
import path from "node:path"
import { getDB } from "./db.js"
const schema = fs.readFileSync(path.resolve("backend/schema.sql"), "utf8")
const db = getDB()
db.serialize(() => {
  db.exec(schema, (err) => {
    if (err) {
      console.error("Erro ao inicializar DB:", err)
      process.exit(1)
    } else {
      console.log("✔ DB inicializado com sqlite3")
      process.exit(0)
    }
  })
})
