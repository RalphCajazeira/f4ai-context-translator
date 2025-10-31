import { Router } from "express";

import { TranslationMemoryController } from "@/controllers/translation-memory-controller.js";

const tmRoutes = Router();
const translationMemoryController = new TranslationMemoryController();

tmRoutes.get("/", (request, response, next) =>
  translationMemoryController.index(request, response).catch(next)
);

tmRoutes.post("/", (request, response, next) =>
  translationMemoryController.create(request, response).catch(next)
);

tmRoutes.patch("/:id", (request, response, next) =>
  translationMemoryController.update(request, response).catch(next)
);

tmRoutes.delete("/:id", (request, response, next) =>
  translationMemoryController.delete(request, response).catch(next)
);

export { tmRoutes };
