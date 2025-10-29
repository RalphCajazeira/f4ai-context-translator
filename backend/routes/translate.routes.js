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
import {
  projectGlossaryCaseInSentence,
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "../services/case.service.js";

export const translateRouter = Router();

/** Tradução linha a linha com fallback seguro */
async function translatePreservingLines({ text, src, tgt, shots, glossary }) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    if (ln.trim() === "") { out.push(""); continue; }
    const promptLine = `Traduza apenas esta linha mantendo as quebras:\n${ln}`;
    try {
      const translated = await translateWithContext({
        text: promptLine, src, tgt, shots, glossary,
      });
      const clean = String(translated || "").replace(/^.*?\n/, "").trim();
      out.push(clean);
    } catch {
      // fallback: devolve a própria linha para não travar a página
      out.push(ln);
    }
  }
  return out.join("\n");
}

/** Tradução e projeção de termos ALL-CAPS mesmo sem TM/Glossário */
async function enforceAllCapsTerms({ original, best, src, tgt, shots, glossary }) {
  let out = String(best || "");
  const caps = extractAllCapsTerms(original);
  if (!caps.length || !out) return out;

  // evita traduzir o mesmo termo duas vezes
  const uniqueCaps = Array.from(new Set(caps));

  for (const term of uniqueCaps) {
    // traduz o termo isoladamente (barato) e limpa prefixos de prompt
    let t = "";
    try {
      const promptWord = `Traduza apenas esta palavra (sem contexto, forma básica):\n${term}`;
      t = await translateWithContext({ text: promptWord, src, tgt, shots, glossary });
      t = String(t || "").replace(/^.*?\n/, "").trim();
    } catch {
      t = "";
    }
    if (!t) continue;

    // projeta ALL CAPS e substitui por token unicode-aware
    const projected = applyCaseLike(term, t); // term é ALL CAPS -> upper
    out = replaceWordUnicode(out, t, projected);
  }
  return out;
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

  // Coleta paralela (menos round-trips)
  const [shots, glossary, suggestions, tmPairs] = await Promise.all([
    topKExamples(text, 5),
    getGlossary(),
    getSuggestions(text, src, tgt, 8),
    all("SELECT source_norm, target_text FROM tm_entries LIMIT 500"),
  ]);

  try {
    // 1) melhor tradução (best)
    let best = preserveLines
      ? await translatePreservingLines({ text, src, tgt, shots, glossary })
      : await translateWithContext({ text, src, tgt, shots, glossary });

    // 2) projeção de caixa por glossário + TM (case-aware)
    const pairs = [...glossary, ...tmPairs];
    best = projectGlossaryCaseInSentence(text, best, pairs);

    // 3) reforço de ALL-CAPS (mesmo sem TM/Glossário)
    best = await enforceAllCapsTerms({ original: text, best, src, tgt, shots, glossary });

    // 4) candidatos ajustados com as mesmas "pairs" (sem MT extra)
    const candidates = (suggestions || []).map(c => ({
      ...c,
      text: projectGlossaryCaseInSentence(text, c.text, pairs),
    }));

    // 5) log opcional
    if (log) {
      await run(
        "INSERT INTO translation_logs (source_text, target_text, origin) VALUES (?, ?, ?)",
        [text, best, origin || "api"]
      );
    }

    return res.json({ best, candidates });
  } catch {
    // Fallback robusto
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
    return res.status(400).json({ error: "source_text e target_text são obrigatórios" });
  }
  await recordApproval(source_text, target_text); // UPSERT na TM
  res.json({ ok: true });
});
