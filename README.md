# AI Document Q&A

Ask questions about your documents and get cited, verifiable answers. Next.js + Postgres/pgvector + Gemini.

> Work in progress: the full README (architecture, AI design choices, trade-offs and known limitations) lands in the final phase.

## Quick start

```bash
nvm use                                   # Node 22 (.nvmrc)
cp .env.example .env                      # works as-is with LLM_PROVIDER=mock (no API key)
docker compose up -d db                   # Postgres 17 + pgvector
npm ci
npm run dev                               # http://localhost:3000
```

Checks: `npm run check` (typecheck, lint, unit tests).
