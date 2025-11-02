import test from "node:test"
import assert from "node:assert/strict"

import { SegmentsController } from "../segments-controller.js"
import { prisma } from "../../database/prisma.js"

function createMockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return payload
    },
  }
}

test("SegmentsController.index defaults to standard limit when provided a negative value", async () => {
  const controller = new SegmentsController()
  const request = {
    query: {
      limit: "-10",
    },
  }
  const response = createMockResponse()

  const originalFindMany = prisma.segment.findMany
  let receivedTake

  prisma.segment.findMany = async (options) => {
    receivedTake = options?.take
    return [
      {
        id: 1,
        sourceText: "Example source",
      },
    ]
  }

  try {
    const result = await controller.index(request, response)

    assert.equal(receivedTake, 200)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(response.body))
    assert.deepEqual(result, response.body)
  } finally {
    prisma.segment.findMany = originalFindMany
  }
})
