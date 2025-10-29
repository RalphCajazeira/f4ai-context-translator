// routes/translate.routes.js
import { Router } from "express";
import {
  getSuggestions,
  topKExamples,
  recordApproval,
  getGlossary,
} from "../services/suggest.service.js";
import { translateWithContext } from "../services/mt-client.service.js";
import { run, all } from "../db.js";
import { projectGlossaryCaseInSentence } from "../services/case.service.js";

export const translateRouter = Router();

async function translatePreservingLines({ text, src, tgt, shots, glossary }) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    if (ln.trim() === "") { out.push(""); continue; }
    const promptLine = `Traduza apenas esta linha mantendo as quebras:\n${ln}`;
    const translated = await translateWithContext({
      text: promptLine, src, tgt, shots, glossary,
    });
    const clean = translated.replace(/^.*?\n/, "").trim();
    out.push(clean);
  }
  return out.join("\n");
}

translateRouter.post("/", async (req, res) => {
  const {
    text,
    src = process.env.MT_SRC || "en",
    tgt = process.env.MT_TGT || "pt",
    preserveLines = true,
    log = false,
    origin = "ui",
  } = req.body || {};

  if (!text) return res.status(400).json({ error: "text é obrigatório" });

  // coletamos em paralelo: exemplos (shots), glossário e sugestões
  const [shots, glossary, suggestions] = await Promise.all([
    topKExamples(text, 5),
    getGlossary(),
    getSuggestions(text, src, tgt, 8),
  ]);

  try {
    // gera a melhor tradução (best)
    let best = preserveLines
      ? await translatePreservingLines({ text, src, tgt, shots, glossary })
      : await translateWithContext({ text, src, tgt, shots, glossary });

    // carrega alguns pares da TM para projetar caixa também quando não houver gloss
    const tmPairs = await all(
      "SELECT source_norm, target_text FROM tm_entries LIMIT 500"
    );

    // 🧠 PROJEÇÃO DE CAIXA: aplica ao texto final e às alternativas
    best = projectGlossaryCaseInSentence(text, best, [...glossary, ...tmPairs]);

    const candidates = (suggestions || []).map((c) => ({
      ...c,
      text: projectGlossaryCaseInSentence(text, c.text, [...glossary, ...tmPairs]),
    }));

    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      );
    }

    return res.json({ best, candidates });
  } catch (err) {
    // fallback: usa a melhor sugestão
    const best = (suggestions && suggestions[0]?.text) || "";
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      );
    }
    return res.json({ best, candidates: suggestions || [] });
  }
});

translateRouter.post("/approve", async (req, res) => {
  const { source_text, target_text } = req.body || {};
  if (!source_text || !target_text) {
    return res
      .status(400)
      .json({ error: "source_text e target_text são obrigatórios" });
  }
  await recordApproval(source_text, target_text); // UPSERT na TM
  res.json({ ok: true });
});
