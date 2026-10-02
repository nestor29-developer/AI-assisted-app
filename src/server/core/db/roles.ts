import type { Pool, PoolClient } from 'pg';

export interface AppRole {
  readonly username: string;
  readonly password: string;
}

const TABLE_PRIVILEGES = 'select, insert, update, delete';
const ROLE_ATTRIBUTES = 'login nosuperuser nocreatedb nocreaterole noreplication nobypassrls';

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

/** Creates the app's login or rotates its password: table reads and writes only, no DDL. Idempotent. */
export async function provisionAppRole(pool: Pool, { username, password }: AppRole): Promise<void> {
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
    const { rows: existing } = await client.query<{ rolsuper: boolean }>(
      'select rolsuper from pg_roles where rolname = $1',
      [username],
    );
    if (existing[0]?.rolsuper) throw new Error(`Refusing to change ${username}: it is a superuser`);

    await ddl(
      client,
      `${existing.length > 0 ? 'alter' : 'create'} role %I with ${ROLE_ATTRIBUTES} password %L`,
      username,
      password,
    );
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
