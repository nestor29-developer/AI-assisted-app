import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

export interface AppRole {
  readonly username: string;
  readonly password: string;
}

const TABLE_PRIVILEGES = 'select, insert, update, delete';
const SCRAM_ITERATIONS = 4096;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

const PRIVILEGES = [
  ['rolsuper', 'SUPERUSER'],
  ['rolreplication', 'REPLICATION'],
  ['rolbypassrls', 'BYPASSRLS'],
  ['rolcreaterole', 'CREATEROLE'],
  ['rolcreatedb', 'CREATEDB'],
] as const;
type Privilege = (typeof PRIVILEGES)[number][0];
type RoleFlags = Record<Privilege | 'rolcanlogin', boolean>;

// Only a superuser can take these three away, so a role that has one is refused, not altered.
const BEYOND_REPAIR: readonly Privilege[] = ['rolsuper', 'rolreplication', 'rolbypassrls'];

const has = (flags: RoleFlags, among: readonly Privilege[]) =>
  PRIVILEGES.filter(([flag]) => among.includes(flag) && flags[flag]).map(([, name]) => name);

/** What Postgres stores for a password (RFC 7677), so the password itself is never in a statement or a log. */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  if (!PRINTABLE_ASCII.test(password)) {
    throw new Error(
      'The application role password must be printable ASCII, so every client derives the same key',
    );
  }
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest();
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** DDL cannot bind names or passwords as parameters, so the server quotes them itself (%I and %L). */
async function ddl(client: PoolClient, template: string, ...values: string[]): Promise<void> {
  const { rows } = await client.query<{ statement: string }>(
    'select format($1, variadic $2::text[]) as statement',
    [template, values],
  );
  const statement = rows[0]?.statement;
  if (!statement) throw new Error('The server returned no statement to run');
  await client.query(statement);
}

async function readFlags(client: PoolClient, username: string): Promise<RoleFlags | null> {
  const { rows } = await client.query<RoleFlags>(
    `select rolsuper, rolreplication, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
       from pg_roles where rolname = $1`,
    [username],
  );
  return rows[0] ?? null;
}

/** Creates the app's login or rotates its password: table reads and writes only, no DDL. Run under the migration lock. */
export async function provisionAppRole(pool: Pool, { username, password }: AppRole): Promise<void> {
  const verifier = scramSha256Verifier(password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: me } = await client.query<{ migrator: string; database: string }>(
      'select current_user as migrator, current_database() as database',
    );
    const { migrator, database } = me[0] ?? { migrator: '', database: '' };
    if (username === migrator) {
      throw new Error('The application role must differ from the user that runs migrations');
    }
    const existing = await readFlags(client, username);
    const stuck = existing ? has(existing, BEYOND_REPAIR) : [];
    if (stuck.length > 0) {
      throw new Error(
        `Refusing to change ${username}: it has the ${stuck.join(' and ')} attribute, which only a superuser can remove`,
      );
    }

    // Naming SUPERUSER, REPLICATION or BYPASSRLS is refused to a master without it, even to turn it off.
    await ddl(
      client,
      existing
        ? 'alter role %I with login nocreatedb nocreaterole password %L'
        : 'create role %I with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password %L',
      username,
      verifier,
    );
    const now = await readFlags(client, username);
    const excess = now
      ? has(
          now,
          PRIVILEGES.map(([flag]) => flag),
        )
      : [];
    if (!now?.rolcanlogin || excess.length > 0) {
      throw new Error(
        `The application role ${username} must only be able to log in, but ${excess.length > 0 ? `it has ${excess.join(' and ')}` : 'it cannot log in'}`,
      );
    }

    await ddl(client, 'grant connect on database %I to %I', database, username);
    await ddl(client, 'revoke create on schema public from public');
    await ddl(client, 'grant usage on schema public to %I', username);
    await ddl(client, `grant ${TABLE_PRIVILEGES} on all tables in schema public to %I`, username);
    await ddl(client, 'grant usage, select on all sequences in schema public to %I', username);
    // Tables the next migration creates (as this user) must be reachable without another grant.
    await ddl(
      client,
      `alter default privileges in schema public grant ${TABLE_PRIVILEGES} on tables to %I`,
      username,
    );
    await ddl(
      client,
      'alter default privileges in schema public grant usage, select on sequences to %I',
      username,
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
