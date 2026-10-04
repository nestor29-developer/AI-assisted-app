import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { provisionAppRole } from './roles';

type Flags = {
  rolsuper: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
};

const PLAIN: Flags = {
  rolsuper: false,
  rolreplication: false,
  rolbypassrls: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolcanlogin: true,
};

/** A server that answers the role lookups with the given flags: before the change, then after it. */
function serverWith(before: Flags | null, after: Flags | null) {
  const statements: string[] = [];
  const lookups = [before, after];
  const client = {
    query: async (text: string) => {
      statements.push(text.trim().split(/\s+/).slice(0, 2).join(' '));
      if (text.includes('from pg_roles')) return { rows: [lookups.shift()].filter(Boolean) };
      if (text.includes('current_user'))
        return { rows: [{ migrator: 'master', database: 'docqa' }] };
      if (text.includes('format(')) return { rows: [{ statement: 'select 1' }] };
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { pool: { connect: async () => client } as unknown as Pool, statements };
}

describe('provisionAppRole checks what the role can do', () => {
  it('rolls back, and names the privilege, when the role still has one after the change', async () => {
    const { pool, statements } = serverWith(PLAIN, { ...PLAIN, rolcreatedb: true });

    await expect(
      provisionAppRole(pool, { username: 'app_rw', password: 'a-long-enough-password' }),
    ).rejects.toThrow(/app_rw must only be able to log in, but it has CREATEDB/);

    expect(statements).toContain('rollback');
    expect(statements).not.toContain('commit');
  });

  it('rolls back when the role cannot log in after the change', async () => {
    const { pool, statements } = serverWith(null, { ...PLAIN, rolcanlogin: false });

    await expect(
      provisionAppRole(pool, { username: 'app_rw', password: 'a-long-enough-password' }),
    ).rejects.toThrow(/cannot log in/);

    expect(statements).toContain('rollback');
  });

  it('commits when the role can log in and nothing more', async () => {
    const { pool, statements } = serverWith(null, PLAIN);

    await provisionAppRole(pool, { username: 'app_rw', password: 'a-long-enough-password' });

    expect(statements).toContain('commit');
    expect(statements).not.toContain('rollback');
  });

  it('refuses before changing anything when the role already has a privilege only a superuser can remove', async () => {
    const { pool, statements } = serverWith({ ...PLAIN, rolbypassrls: true }, PLAIN);

    await expect(
      provisionAppRole(pool, { username: 'app_rw', password: 'a-long-enough-password' }),
    ).rejects.toThrow(/Refusing to change app_rw: it has the BYPASSRLS attribute/);

    expect(statements).not.toContain('select format($1,');
  });
});
