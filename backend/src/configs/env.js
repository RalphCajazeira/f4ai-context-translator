import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../");

const defaultDatabaseUrl = `file:${path.join(projectRoot, "data", "f4.db")}`;

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = defaultDatabaseUrl;
}

const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl: process.env.DATABASE_URL,
};

export { env };
