import { Router } from "express";

import { GlossaryController } from "@/controllers/glossary-controller.js";

const glossaryRoutes = Router();
const glossaryController = new GlossaryController();

glossaryRoutes.get("/", (request, response, next) =>
  glossaryController.index(request, response).catch(next)
);

glossaryRoutes.post("/", (request, response, next) =>
  glossaryController.create(request, response).catch(next)
);

glossaryRoutes.put("/:id", (request, response, next) =>
  glossaryController.update(request, response).catch(next)
);

glossaryRoutes.delete("/:id", (request, response, next) =>
  glossaryController.delete(request, response).catch(next)
);

export { glossaryRoutes };
