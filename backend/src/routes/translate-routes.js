import { Router } from "express";

import { TranslateController } from "@/controllers/translate-controller.js";

const translateRoutes = Router();
const translateController = new TranslateController();

translateRoutes.post("/", (request, response, next) =>
  translateController.create(request, response).catch(next)
);

translateRoutes.post("/approve", (request, response, next) =>
  translateController.approve(request, response).catch(next)
);

export { translateRoutes };
