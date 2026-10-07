import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPool, testDatabaseUrl } from '@/test/helpers/database';

import { runMigrations } from './migrator';
import { provisionAppRole } from './roles';

const hex = () => randomBytes(4).toString('hex');
const randomPassword = () => randomBytes(18).toString('base64url');

function urlFor(user: string, password: string, database: string): string {
  const url = new URL(testDatabaseUrl());
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** DDL cannot bind names or passwords, so the server quotes them (%I and %L), as the code under test does. */
async function run(pool: Pool, template: string, ...values: string[]): Promise<void> {
  const { rows } = await pool.query<{ statement: string }>(
    'select format($1, variadic $2::text[]) as statement',
    [template, values],
  );
  await pool.query(rows[0]?.statement ?? '');
}

async function connectAs(user: string, password: string, database: string): Promise<Client> {
  const client = new Client({ connectionString: urlFor(user, password, database) });
  await client.connect();
  return client;
}

/** The statements a pool's connections are asked to run, in order. */
function recording(pool: Pool) {
  const statements: string[] = [];
  const wrapped = new WeakSet<object>();
  const recorded = {
    connect: async () => {
      const client = await pool.connect();
      if (!wrapped.has(client)) {
        wrapped.add(client);
        const original = client.query.bind(client) as (...args: unknown[]) => unknown;
        client.query = ((...args: unknown[]) => {
          const first = args[0];
          statements.push(
            typeof first === 'string' ? first : String((first as { text?: string })?.text),
          );
          return original(...args);
        }) as typeof client.query;
      }
      return client;
    },
  };
  return { pool: recorded as unknown as Pool, statements };
}

// RDS' master can create roles and databases but is no superuser, unlike the test user; this builds one.
describe('provisionAppRole as a master that is not a superuser (real Postgres)', () => {
  const admin = createTestPool();
  const master = `docqa_master_${hex()}`;
  const masterPassword = randomPassword();
  const scratch = `docqa_scratch_${hex()}`;
  const appRoles: string[] = [];
  let asMaster: Pool;

  const newAppRole = () => {
    const name = `docqa_app_${hex()}`;
    appRoles.push(name);
    return name;
  };

  beforeAll(async () => {
    await run(
      admin,
      'create role %I login createrole createdb password %L',
      master,
      masterPassword,
    );
    await run(admin, 'create database %I owner %I', scratch, master);
    asMaster = new Pool({ connectionString: urlFor(master, masterPassword, scratch) });
    // end() resolves before its sockets close, so the forced drop in afterAll can end one (57P01).
    asMaster.on('error', (error) => {
      if ((error as { code?: string }).code !== '57P01') throw error;
    });
    await asMaster.query('create table things (id serial primary key, note text)');
  });

  afterAll(async () => {
    await asMaster.end();
    await run(admin, 'drop database if exists %I with (force)', scratch);
    for (const name of appRoles) await run(admin, 'drop role if exists %I', name);
    await run(admin, 'drop role if exists %I', master);
    await admin.end();
  });

  it('creates the login and then rotates its password on the next run', async () => {
    const username = newAppRole();
    const first = randomPassword();
    const second = randomPassword();

    await provisionAppRole(asMaster, { username, password: first });
    await provisionAppRole(asMaster, { username, password: second });

    await expect(connectAs(username, first, scratch)).rejects.toThrow(
      /password authentication failed/i,
    );
    const client = await connectAs(username, second, scratch);
    try {
      await client.query("insert into things (note) values ('written by the app login')");
      expect((await client.query('select count(*)::int as n from things')).rows[0].n).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('never sends the password itself to the server, only its salted hash', async () => {
    const username = newAppRole();
    const password = randomPassword();
    const { pool, statements } = recording(asMaster);

    await provisionAppRole(pool, { username, password });
    await provisionAppRole(pool, { username, password: randomPassword() });

    expect(statements.some((statement) => statement.includes(password))).toBe(false);
    expect(
      statements.filter((statement) => statement.includes('SCRAM-SHA-256$4096:')),
    ).toHaveLength(2);
    const client = await connectAs(username, password, scratch).catch(() => null);
    expect(client, 'the first password was replaced by the second run').toBeNull();
  });

  it('logs in with the plain password that the hash was made from', async () => {
    const username = newAppRole();
    const password = `with spaces, "quotes", 'apostrophes' and \\ ${randomBytes(6).toString('hex')}`;

    await provisionAppRole(asMaster, { username, password });

    const client = await connectAs(username, password, scratch);
    await client.end();
  });

  it('says which privilege is wrong, and changes nothing, when the role already has one it must not', async () => {
    const username = newAppRole();
    const before = randomPassword();
    await run(admin, 'create role %I login replication password %L', username, before);

    await expect(
      provisionAppRole(asMaster, { username, password: randomPassword() }),
    ).rejects.toThrow(/REPLICATION/);

    const client = await connectAs(username, before, scratch);
    await client.end();
  });

  it('takes away what the master is allowed to take away, and checks the result', async () => {
    const username = newAppRole();
    const password = randomPassword();
    await provisionAppRole(asMaster, { username, password: randomPassword() });
    await run(asMaster, 'alter role %I createdb', username);

    await provisionAppRole(asMaster, { username, password });

    const { rows } = await admin.query(
      'select rolcreatedb, rolcreaterole, rolsuper, rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = $1',
      [username],
    );
    expect(rows[0]).toEqual({
      rolcreatedb: false,
      rolcreaterole: false,
      rolsuper: false,
      rolreplication: false,
      rolbypassrls: false,
      rolcanlogin: true,
    });
  });

  it('can be run by three deploys at once, each under the migration lock, with none of them failing', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'docqa-migrations-'));
    await mkdir(join(folder, 'meta'));
    await writeFile(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: [] }),
    );
    const username = newAppRole();
    const password = randomPassword();
    try {
      await Promise.all(
        [1, 2, 3].map(() =>
          runMigrations(asMaster, folder, {
            afterwards: () => provisionAppRole(asMaster, { username, password }),
          }),
        ),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }

    const client = await connectAs(username, password, scratch);
    await client.end();
  });
});
