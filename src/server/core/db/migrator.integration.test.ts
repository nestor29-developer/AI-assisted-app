import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createTestPool } from '@/test/helpers/database';

import { runMigrations } from './migrator';

describe('runMigrations (real Postgres)', () => {
  const pool = createTestPool();

  afterAll(() => pool.end());

  it('is idempotent and safe when two deploys migrate at the same moment', async () => {
    const folder = resolve('drizzle');
    const countApplied = async () =>
      Number((await pool.query('select count(*) from drizzle.__drizzle_migrations')).rows[0].count);

    await runMigrations(pool, folder);
    const before = await countApplied();

    await Promise.all([
      runMigrations(pool, folder),
      runMigrations(pool, folder),
      runMigrations(pool, folder),
    ]);

    expect(await countApplied()).toBe(before);
  });

  it('releases the advisory lock afterwards, so the next migration is not blocked', async () => {
    await runMigrations(pool, resolve('drizzle'));

    const held = await pool.query(
      'select count(*)::int as n from pg_locks where locktype = $1 and objid = $2',
      ['advisory', 727_001],
    );

    expect(held.rows[0].n).toBe(0);
  });
});
