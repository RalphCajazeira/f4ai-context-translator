import { Router } from "express";

import { translateRoutes } from "@/routes/translate-routes.js";
import { glossaryRoutes } from "@/routes/glossary-routes.js";
import { tmRoutes } from "@/routes/tm-routes.js";
import { logsRoutes } from "@/routes/logs-routes.js";
import { blacklistRoutes } from "@/routes/blacklist-routes.js";
import { segmentsRoutes } from "@/routes/segments-routes.js";
import { XTranslatorController } from "@/controllers/xtranslator-controller.js";

const routes = Router();
const xTranslatorController = new XTranslatorController();

routes.use("/api/translate", translateRoutes);
routes.use("/api/glossary", glossaryRoutes);
routes.use("/api/tm", tmRoutes);
routes.use("/api/logs", logsRoutes);
routes.use("/api/blacklist", blacklistRoutes);
routes.use("/api/segments", segmentsRoutes);

routes.post("/v1/chat/completions", (request, response, next) =>
  xTranslatorController.handleChatCompletion(request, response).catch(next)
);

routes.get("/api/xtranslator/requests", (request, response, next) =>
  xTranslatorController.listRequests(request, response).catch(next)
);

export { routes };
