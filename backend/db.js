import sqlite3pkg from "sqlite3"
import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
dotenv.config()
const sqlite3 = sqlite3pkg.verbose()
const DB_PATH = process.env.DB_PATH || "./data/f4.db"
let db = null
export function getDB() {
  if (!db) {
    if (!fs.existsSync(path.dirname(DB_PATH)))
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    db = new sqlite3.Database(DB_PATH)
  }
  return db
}
export function all(sql, params = []) {
  const database = getDB()
  return new Promise((res, rej) => {
    database.all(sql, params, (e, rows) => (e ? rej(e) : res(rows)))
  })
}
export function get(sql, params = []) {
  const database = getDB()
  return new Promise((res, rej) => {
    database.get(sql, params, (e, row) => (e ? rej(e) : res(row)))
  })
}
export function run(sql, params = []) {
  const database = getDB()
  return new Promise((res, rej) => {
    database.run(sql, params, function (e) {
      if (e) return rej(e)
      res({ changes: this.changes, lastID: this.lastID })
    })
  })
}
