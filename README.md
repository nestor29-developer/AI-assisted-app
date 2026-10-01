# AI Document Q&A

Ask questions about your documents and get cited, verifiable answers. Next.js + Postgres/pgvector + Gemini.

> Work in progress: the full README (architecture, AI design choices, trade-offs and known limitations) lands in the final phase.

## Quick start

```bash
nvm use                         # Node 22 (.nvmrc)
npm ci
npm run setup                   # creates .env with a generated JWT secret (LLM_PROVIDER=mock needs no API key)
docker compose up -d db         # Postgres 17 + pgvector on 127.0.0.1:5432
npm run db:migrate              # applies ./drizzle (enables pgvector, creates tables)
npm run dev                     # http://localhost:3000
```

Port 3000 or 5432 already taken? Set `APP_ORIGIN` to the URL you actually open, and `DB_HOST_PORT` for Postgres.

### Everything in containers

```bash
docker compose --profile full up --build   # db + migrations + production image
```

### Checks

```bash
npm run check                   # typecheck, lint, unit tests
npm run test:integration        # needs the db container; covers the SQL fakes cannot prove
BASE_URL=http://localhost:3000 scripts/smoke-auth.sh   # curl walkthrough of the auth API
```
