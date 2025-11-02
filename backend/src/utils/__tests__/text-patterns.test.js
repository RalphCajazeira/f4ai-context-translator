import test from "node:test"
import assert from "node:assert/strict"

import { buildWordBoundaryRegex } from "@/utils/text-patterns.js"

test("buildWordBoundaryRegex matches multi-word terms across newlines", () => {
  const regex = buildWordBoundaryRegex(["Alpha Beta"])
  assert.ok(regex)

  const input = "Alpha\nBeta"
  const matches = input.match(regex)

  assert.ok(matches)
  assert.strictEqual(matches[0], "Alpha\nBeta")
})

test("buildWordBoundaryRegex respects word boundaries", () => {
  const regex = buildWordBoundaryRegex(["Mod"])
  assert.ok(regex)

  assert.ok(regex.test("Mod"))
  regex.lastIndex = 0
  assert.ok(!regex.test("Modded"))
})
