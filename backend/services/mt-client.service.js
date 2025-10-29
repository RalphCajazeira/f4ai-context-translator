import fetch from "node-fetch"
import dotenv from "dotenv"
dotenv.config()
export async function translateWithContext({
  text,
  src,
  tgt,
  shots = [],
  glossary = [],
  backend = process.env.MT_BACKEND || "ollama",
}) {
  if (backend === "ollama") {
    const url = "http://localhost:8001/llm-translate"
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, src, tgt, shots, glossary }),
      })
      if (!r.ok) throw new Error(`LLM service ${r.status}`)
      const j = await r.json()
      return j.text
    } catch (e) {
      if (process.env.MT_ENABLED === "true") {
        const r2 = await fetch(process.env.MT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, src, tgt }),
        })
        if (r2.ok) {
          const j2 = await r2.json()
          return j2.text
        }
      }
      throw e
    }
  } else {
    const r = await fetch(process.env.MT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, src, tgt }),
    })
    if (!r.ok) throw new Error("MT service error")
    const j = await r.json()
    return j.text
  }
}
