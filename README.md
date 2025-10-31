# F4 AI Context Translator (LLM + TM + Glossário)

Veja `.env.example` para configurar Ollama (Qwen2.5/LLama3.1) e o fallback M2M100.

## Backend (Express + Prisma)

1. Instale as dependências: `npm install`.
2. Gere o cliente do Prisma: `npm run prisma:generate`.
3. Crie/atualize o banco local (SQLite): `npm run prisma:db-push`.
4. Inicie o servidor: `npm run dev`.

O backend expõe as rotas sob `/api` seguindo a nova estrutura de controllers/routers. Todas as tabelas (TM, glossário, blacklist, logs e segmentos) agora possuem colunas de `game`, `mod`, `created_at` e `updated_at`.
