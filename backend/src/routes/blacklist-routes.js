import { Router } from "express";

import { BlacklistController } from "@/controllers/blacklist-controller.js";

const blacklistRoutes = Router();
const blacklistController = new BlacklistController();

blacklistRoutes.get("/", (request, response, next) =>
  blacklistController.index(request, response).catch(next)
);

blacklistRoutes.post("/", (request, response, next) =>
  blacklistController.create(request, response).catch(next)
);

blacklistRoutes.put("/:id", (request, response, next) =>
  blacklistController.update(request, response).catch(next)
);

blacklistRoutes.delete("/:id", (request, response, next) =>
  blacklistController.delete(request, response).catch(next)
);

export { blacklistRoutes };
