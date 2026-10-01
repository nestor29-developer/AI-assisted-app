import { defineConfig } from 'drizzle-kit';

// drizzle-kit only generates SQL here; migrations are applied by scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/docqa' },
});
