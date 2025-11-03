# F4 AI Context Translator

Pipeline focado em traduções de games, testado diariamente com mods de **Fallout 4** (inglês → português do Brasil). O projeto combina contexto do jogo, glossários opcionais e dois modelos Ollama (um principal e outro rápido) com fallback M2M100.

## Visão geral
- **Backend Express/Prisma** (`backend/`) fornece API REST para segmentos, TM, glossários e blacklist.
- **Serviço FastAPI** (`mt_service/app.py`) cria prompts especializados para Fallout 4 e conversa com o Ollama. Se `transformers`/`torch` estiverem instalados, ativa o fallback local com `facebook/m2m100_418M`.
- **Seleção automática de modelo**: segmentos curtos podem ir para um modelo leve (mais barato), enquanto trechos longos ou críticos usam o modelo principal configurado.

## Requisitos
1. **Node.js 20+** para o backend.
2. **Python 3.10+** para o serviço FastAPI.
3. **Ollama** rodando localmente com os modelos necessários (`ollama pull ...`).
4. Opcional: `transformers` + `torch` com suporte CUDA para ativar o fallback M2M100.

## Configuração
1. Copie o arquivo de exemplo: `cp .env.example .env`.
2. Ajuste o `.env` conforme o seu ambiente.

### Variáveis importantes
| Variável | Descrição |
| --- | --- |
| `OLLAMA_MODEL` | Modelo principal (qualidade máxima). Ex.: `llama3.1:8b-instruct-q4_K_M`.
| `OLLAMA_LIGHT_MODEL` | Modelo leve, usado em segmentos curtos. Ex.: `qwen2.5:3b-instruct`.
| `OLLAMA_LIGHT_MAX_WORDS` | Limite de palavras para enviar ao modelo leve. Use `0` para desativar esse critério.
| `OLLAMA_LIGHT_MAX_CHARS` | Limite de caracteres para o modelo leve. Use `0` para desativar esse critério.

A seleção do modelo leve só acontece se pelo menos um limite for maior que zero **e** o segmento respeitar todos os limites ativos. Caso contrário, o texto vai para o modelo principal. Se o modelo leve falhar (ou não traduzir), o serviço força nova tentativa com o modelo principal.

### Outros parâmetros
- `MT_URL`, `MT_SRC`, `MT_TGT` controlam o endpoint FastAPI e idiomas padrão (inglês → pt-BR por padrão).
- `MT_LOG=1` habilita logs detalhados na seleção de modelo e chamadas ao Ollama.

## Preparando os modelos
```bash
ollama pull llama3.1:8b-instruct-q4_K_M
ollama pull qwen2.5:3b-instruct
```
Use quantizações compatíveis com a sua GPU (ex.: RTX 3050 → `q4_K_M`).

## Execução
### 1. Serviço FastAPI (prompt Fallout 4 + fallback M2M100)
```bash
cd mt_service
uvicorn app:app --host 0.0.0.0 --port 8001
```
Instale previamente os requisitos (`pip install -r requirements.txt`).

### 2. Backend Express
```bash
npm install
npm run prisma:generate
npm run prisma:db-push
npm run dev
```

O backend expõe as rotas sob `/api` e utiliza o serviço FastAPI para `/llm-translate`.

## Recursos de tradução
- **Prompt especializado** mantém placeholders, tags e tom típico de Fallout 4.
- **Glossários e shots** opcionais ajudam a garantir consistência entre mods e facções.
- **Proteção “no translate”** evita que termos ou placeholders críticos sejam alterados.
- **Fallback automático** para o modelo principal quando o modelo leve não entrega tradução satisfatória.

## Fluxo recomendado
1. Configure o `.env` com os limites desejados (ex.: até 4 palavras **e** 40 caracteres vão para o modelo leve).
2. Faça testes com trechos variados (palavras, diálogos, notas) para calibrar os limites.
3. Ajuste glossários/listas negras no backend para manter terminologia consistente entre mods.

## Licença
Projeto interno para tradução de mods. Ajuste conforme suas necessidades.
