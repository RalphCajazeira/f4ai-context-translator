import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import path from "node:path"
import fs from "node:fs"
import { getDB } from "./db.js"
import { translateRouter } from "./routes/translate.routes.js"
import { glossaryRouter } from "./routes/glossary.routes.js"
import { segmentsRouter } from "./routes/segments.routes.js"
import { logsRouter } from "./routes/logs.routes.js"
dotenv.config()
const app = express()
app.use(cors())
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true }))
if (!fs.existsSync("data")) fs.mkdirSync("data", { recursive: true })
getDB()
app.use("/api/translate", translateRouter)
app.use("/api/glossary", glossaryRouter)
app.use("/api/segments", segmentsRouter)
app.use("/api/logs", logsRouter)
app.use("/", express.static(path.resolve("public")))
const PORT = process.env.PORT || 3333
app.listen(PORT, () =>
  console.log(`✔ F4 AI Context Translator em http://localhost:${PORT}`)
)
