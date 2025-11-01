import { app, env } from "@/app.js";
import { ensureXTranslatorSchema } from "@/database/migrations/xtranslator.migration.js";
import { prisma } from "@/database/prisma.js";
import { ensureSearchVectors } from "@/services/search-index.service.js";

async function bootstrap() {
  try {
    await prisma.$connect();
    await ensureXTranslatorSchema();
    await ensureSearchVectors();
    app.listen(env.port, () => {
      console.log(`Server is running on http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error("Não foi possível iniciar o servidor", error);
    process.exit(1);
  }
}

bootstrap();
