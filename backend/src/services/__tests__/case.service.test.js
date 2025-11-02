import test from "node:test"
import assert from "node:assert/strict"

import {
  applyCaseLike,
  extractAllCapsTerms,
  replaceWordUnicode,
} from "../case.service.js"

test("replaceWordUnicode handles accented words and preserves surrounding punctuation", () => {
  const text = "Olá, AÇÃO incrível! ação rápida e Ação final."
  const result = replaceWordUnicode(text, "AÇÃO", "resposta")
  assert.equal(result, "Olá, resposta incrível! resposta rápida e resposta final.")
})

test("extractAllCapsTerms collects unique uppercase terms including accented characters", () => {
  const text = "O relatório cita ÓLEO, ÓLEO e ÍNDICE; mas não CaSo nem X."
  const terms = extractAllCapsTerms(text)
  assert.deepEqual(terms.sort(), ["ÍNDICE", "ÓLEO"])
})

test("applyCaseLike mirrors uppercase, lowercase and title case with accents", () => {
  assert.equal(applyCaseLike("AÇÃO", "café"), "CAFÉ")
  assert.equal(applyCaseLike("ação", "CAFÉ"), "café")
  assert.equal(applyCaseLike("Olá Mundo", "árvore encantada"), "Árvore Encantada")
})

test("replaceWordUnicode ignores partial occurrences embedded in larger words", () => {
  const text =
    "Termos como superAÇÃO ou AÇÃOzinho devem permanecer, mas AÇÃO isolada muda."
  const result = replaceWordUnicode(text, "AÇÃO", "resposta")
  assert.equal(
    result,
    "Termos como superAÇÃO ou AÇÃOzinho devem permanecer, mas resposta isolada muda.",
  )
})
