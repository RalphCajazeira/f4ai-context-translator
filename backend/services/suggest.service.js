import { all, run } from "../db.js";
import { normalize } from "./normalize.service.js";
import { scoreFuzzy } from "./scoring.service.js";
import { applyCaseLike } from "./case.service.js";

/* Escapa caracteres especiais para RegExp */
function esc(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Retorna os k exemplos mais semelhantes */
export async function topKExamples(srcText, k = 5) {
  const srcNorm = normalize(srcText);
  const rows = await all(
    "SELECT source_norm, target_text, uses, quality FROM tm_entries"
  );
  const scored = rows.map((r) => ({
    ...r,
    score: scoreFuzzy(srcNorm, r.source_norm),
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => ({ src: r.source_norm, tgt: r.target_text }));
}

/* UPSERT na TM — substitui se já existir o mesmo source_norm */
export async function recordApproval(sourceText, targetText, quality = 1.0) {
  const srcNorm = normalize(sourceText);
  const q = Number(quality) || 1.0;

  await run(
    `INSERT INTO tm_entries (source_norm, target_text, uses, quality)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(source_norm) DO UPDATE
       SET target_text = excluded.target_text,
           quality     = excluded.quality,
           uses        = tm_entries.uses + 1,
           last_used_at= CURRENT_TIMESTAMP`,
    [srcNorm, targetText, q]
  );
}

/* Glossário aprovado */
export async function getGlossary() {
  return await all(
    "SELECT term_source, term_target FROM glossary WHERE approved = 1"
  );
}

/* Sugestões de tradução com TM (exata/fuzzy) + Glossário (case-aware) */
export async function getSuggestions(text, src = "en", tgt = "pt", topN = 8) {
  const original = String(text || "");        // texto exatamente como o usuário digitou
  const srcNorm = normalize(original);        // chave canônica para TM

  // 1) TM exata
  const tmExact = await all(
    "SELECT target_text, uses, quality FROM tm_entries WHERE source_norm = ? ORDER BY quality DESC, uses DESC LIMIT 3",
    [srcNorm]
  );
  const exactHits = tmExact.map((r) => ({
    text: applyCaseLike(original, r.target_text), // projeta a caixa do texto digitado
    score: 0.95 * r.quality,
    origin: "TM",
  }));

  // 2) TM fuzzy
  const tmAll = await all(
    "SELECT source_norm, target_text, uses, quality FROM tm_entries"
  );
  const fuzzy = [];
  for (const t of tmAll) {
    const s = scoreFuzzy(srcNorm, t.source_norm);
    if (s >= 0.55) {
      // usa a caixa do texto atual também (heurística simples para segmentos curtos)
      fuzzy.push({
        text: applyCaseLike(original, t.target_text),
        score: s * 0.9,
        origin: "Fuzzy",
      });
    }
  }

  // 3) Glossário (case-aware com base no match encontrado)
  const glossRows = await getGlossary();
  const glossHits = [];
  for (const g of glossRows) {
    const re = new RegExp(`\\b${esc(g.term_source)}\\b`, "i");
    const m = original.match(re);
    if (m) {
      const projected = applyCaseLike(m[0], g.term_target);
      glossHits.push({ text: projected, score: 0.78, origin: "Glossary" });
    }
  }

  // 4) Ordena e remove duplicados
  const merged = [...exactHits, ...glossHits, ...fuzzy].sort(
    (a, b) => b.score - a.score
  );

  const seen = new Set();
  const uniq = [];
  for (const s of merged) {
    const k = (s.text || "").trim().toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(s);
    }
    if (uniq.length >= topN) break;
  }

  return uniq;
}
