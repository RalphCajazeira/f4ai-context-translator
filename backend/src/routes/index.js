import { Router } from "express";

import { translateRoutes } from "@/routes/translate-routes.js";
import { glossaryRoutes } from "@/routes/glossary-routes.js";
import { tmRoutes } from "@/routes/tm-routes.js";
import { logsRoutes } from "@/routes/logs-routes.js";
import { blacklistRoutes } from "@/routes/blacklist-routes.js";
import { segmentsRoutes } from "@/routes/segments-routes.js";

const routes = Router();

routes.use("/api/translate", translateRoutes);
routes.use("/api/glossary", glossaryRoutes);
routes.use("/api/tm", tmRoutes);
routes.use("/api/logs", logsRoutes);
routes.use("/api/blacklist", blacklistRoutes);
routes.use("/api/segments", segmentsRoutes);

export { routes };
