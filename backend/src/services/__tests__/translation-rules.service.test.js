import test from "node:test"
import assert from "node:assert/strict"

import {
  pickBlacklistMatches,
  pickGlossaryMatches,
} from "@/services/translation-rules.service.js"

test("pickBlacklistMatches finds terms separated by newlines", () => {
  const rows = [{ term: "Forbidden Phrase" }]
  const text = "Inicio\nForbidden\nPhrase\nFim"

  const matches = pickBlacklistMatches(text, rows)

  assert.deepStrictEqual(matches, ["Forbidden Phrase"])
})

test("pickGlossaryMatches finds glossary entries split by markers", () => {
  const rows = [
    { termSource: "Magic Sword", termTarget: "Espada Mágica", notes: "" },
  ]
  const text = "Use the Magic\nSword wisely."

  const matches = pickGlossaryMatches(text, rows)

  assert.strictEqual(matches.length, 1)
  assert.strictEqual(matches[0].termSource, "Magic Sword")
})
