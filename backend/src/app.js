import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "@/configs/env.js";
import { routes } from "@/routes/index.js";
import { errorHandling } from "@/middlewares/error-handling.js";

const app = express();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../..", "public");

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(routes);
app.use(express.static(publicDir));
app.use(errorHandling);

export { app, env };
