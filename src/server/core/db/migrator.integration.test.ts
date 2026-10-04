import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestPool, testDatabaseUrl } from '@/test/helpers/database';

import { runMigrations } from './migrator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it('holds the lock while the work after the migrations runs, so that work is serialized too', async () => {
    let heldDuring = -1;

    await runMigrations(pool, resolve('drizzle'), {
      afterwards: async () => {
        const { rows } = await pool.query(
          'select count(*)::int as n from pg_locks where locktype = $1 and objid = $2 and granted',
          ['advisory', 727_001],
        );
        heldDuring = rows[0].n;
      },
    });

    expect(heldDuring).toBe(1);
  });

  it('waits for another deploy as long as it takes, however short the pool lock timeout is', async () => {
    const impatient = new Pool({ connectionString: testDatabaseUrl(), lock_timeout: 300 });
    let finishFirst = () => {};
    let firstHoldsLock = () => {};
    const holding = new Promise<void>((done) => (firstHoldsLock = done));
    const gate = new Promise<void>((done) => (finishFirst = done));
    try {
      const first = runMigrations(impatient, resolve('drizzle'), {
        afterwards: async () => {
          firstHoldsLock();
          await gate;
        },
      });
      await holding;

      const second = runMigrations(impatient, resolve('drizzle'));
      await sleep(900);
      finishFirst();

      await expect(second).resolves.toBeUndefined();
      await first;
    } finally {
      finishFirst();
      await impatient.end();
    }
  });

  it('releases the lock when the work after the migrations fails, and passes the failure on', async () => {
    await expect(
      runMigrations(pool, resolve('drizzle'), {
        afterwards: async () => {
          throw new Error('provisioning failed');
        },
      }),
    ).rejects.toThrow('provisioning failed');

    const held = await pool.query(
      'select count(*)::int as n from pg_locks where locktype = $1 and objid = $2',
      ['advisory', 727_001],
    );
    expect(held.rows[0].n).toBe(0);
  });

  it('gives up with a clear message when the lock is not released within the time allowed', async () => {
    let finishFirst = () => {};
    let firstHoldsLock = () => {};
    const holding = new Promise<void>((done) => (firstHoldsLock = done));
    const gate = new Promise<void>((done) => (finishFirst = done));
    try {
      const first = runMigrations(pool, resolve('drizzle'), {
        afterwards: async () => {
          firstHoldsLock();
          await gate;
        },
      });
      await holding;

      await expect(runMigrations(pool, resolve('drizzle'), { lockWaitMs: 300 })).rejects.toThrow(
        /Gave up after waiting 0\.3 s for another migration/,
      );
      finishFirst();
      await first;
    } finally {
      finishFirst();
    }
  });
});
