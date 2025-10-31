import { Router } from "express";

import { SegmentsController } from "@/controllers/segments-controller.js";

const segmentsRoutes = Router();
const segmentsController = new SegmentsController();

segmentsRoutes.post("/", (request, response, next) =>
  segmentsController.create(request, response).catch(next)
);

segmentsRoutes.get("/", (request, response, next) =>
  segmentsController.index(request, response).catch(next)
);

segmentsRoutes.put("/:id", (request, response, next) =>
  segmentsController.update(request, response).catch(next)
);

export { segmentsRoutes };
