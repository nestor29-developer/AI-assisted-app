import { randomBytes } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectTestDatabase, testDatabaseUrl } from '@/test/helpers/database';

import { provisionAppRole } from './roles';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

const randomName = () => `docqa_test_${randomBytes(4).toString('hex')}`;
const randomPassword = () => randomBytes(18).toString('base64url');

/** Opens a session as the given login, on the same server and database as the tests. */
async function connectAs(username: string, password: string): Promise<Client> {
  const url = new URL(testDatabaseUrl());
  url.username = username;
  url.password = password;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/** The message of the error a statement raises, or null when it succeeds. */
async function failureOf(client: Client, statement: string): Promise<string | null> {
  try {
    await client.query(statement);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('provisionAppRole (real Postgres)', () => {
  let database: TestDatabase;
  const created: string[] = [];

  beforeAll(async () => {
    database = await connectTestDatabase();
  });

  afterAll(async () => {
    for (const name of created) {
      await database.pool
        .query("select format('drop owned by %I', $1::text) as statement", [name])
        .then(({ rows }) => database.pool.query(rows[0].statement));
      await database.pool
        .query("select format('drop role if exists %I', $1::text) as statement", [name])
        .then(({ rows }) => database.pool.query(rows[0].statement));
    }
    await database.close();
  });

  async function provision(name = randomName(), password = randomPassword()) {
    created.push(name);
    await provisionAppRole(database.pool, { username: name, password });
    return { name, password };
  }

  it('creates a login that can read and write the application tables', async () => {
    const { name, password } = await provision();
    const client = await connectAs(name, password);
    try {
      const email = `role-${randomBytes(4).toString('hex')}@example.com`;
      const inserted = await client.query(
        "insert into users (email, password_hash) values ($1, 'x') returning id",
        [email],
      );
      const id = inserted.rows[0].id as string;
      expect(
        (await client.query('select email from users where id = $1', [id])).rows[0].email,
      ).toBe(email);
      await client.query("update users set password_hash = 'y' where id = $1", [id]);
      expect((await client.query('delete from users where id = $1', [id])).rowCount).toBe(1);
      await client.query('select count(*) from document_chunks');
    } finally {
      await client.end();
    }
  });

  it('cannot change the schema, wipe a table, touch the migration history or create roles', async () => {
    const { name, password } = await provision();
    const client = await connectAs(name, password);
    try {
      for (const statement of [
        'create table scratch (id int)',
        'drop table users',
        'alter table users add column scratch int',
        'truncate users',
        'select * from drizzle.__drizzle_migrations',
        'create extension if not exists pg_trgm',
        'create role someone_else login',
        'create index scratch_idx on users (email)',
      ]) {
        expect(await failureOf(client, statement), statement).toMatch(
          /permission denied|must be owner|must be superuser|only roles with/i,
        );
      }
    } finally {
      await client.end();
    }
  });

  it('can use tables that a later migration creates', async () => {
    const { name, password } = await provision();
    await database.pool.query('create table later_table (id serial primary key, note text)');
    try {
      const client = await connectAs(name, password);
      try {
        await client.query("insert into later_table (note) values ('hello')");
        expect((await client.query('select note from later_table')).rows[0].note).toBe('hello');
      } finally {
        await client.end();
      }
    } finally {
      await database.pool.query('drop table later_table');
    }
  });

  it('rotates the password on a second run: the old one stops working, the new one works', async () => {
    const { name, password: first } = await provision();
    const second = randomPassword();

    await provisionAppRole(database.pool, { username: name, password: second });

    await expect(connectAs(name, first)).rejects.toThrow(/password authentication failed/i);
    const client = await connectAs(name, second);
    await client.end();
  });

  it('quotes awkward names instead of letting them run as SQL', async () => {
    const name = `odd"; drop table users; --${randomBytes(3).toString('hex')}`;

    await provision(name);

    const { rows } = await database.pool.query('select 1 from pg_roles where rolname = $1', [name]);
    expect(rows).toHaveLength(1);
    expect(
      (await database.pool.query('select to_regclass($1) as users', ['public.users'])).rows[0]
        .users,
    ).toBe('users');
  });

  it('refuses to turn the user running the migrations into the app role', async () => {
    const { rows } = await database.pool.query('select current_user as me');

    await expect(
      provisionAppRole(database.pool, {
        username: rows[0].me as string,
        password: randomPassword(),
      }),
    ).rejects.toThrow(/must differ from the user that runs migrations/);
  });

  it('refuses to alter a superuser', async () => {
    const name = randomName();
    created.push(name);
    await database.pool.query(`create role ${name} superuser nologin`);

    await expect(
      provisionAppRole(database.pool, { username: name, password: randomPassword() }),
    ).rejects.toThrow(/SUPERUSER/);
    const { rows } = await database.pool.query('select rolsuper from pg_roles where rolname = $1', [
      name,
    ]);
    expect(rows[0].rolsuper).toBe(true);
  });
});
