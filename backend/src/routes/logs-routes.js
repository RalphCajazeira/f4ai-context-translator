import { Router } from "express";

import { LogsController } from "@/controllers/logs-controller.js";

const logsRoutes = Router();
const logsController = new LogsController();

logsRoutes.get("/", (request, response, next) =>
  logsController.index(request, response).catch(next)
);

logsRoutes.patch("/:id", (request, response, next) =>
  logsController.update(request, response).catch(next)
);

logsRoutes.post("/:id/approve", (request, response, next) =>
  logsController.approve(request, response).catch(next)
);

logsRoutes.post("/:id/reject", (request, response, next) =>
  logsController.reject(request, response).catch(next)
);

logsRoutes.delete("/:id", (request, response, next) =>
  logsController.delete(request, response).catch(next)
);

export { logsRoutes };
