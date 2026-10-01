import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { users } from '@/server/core/db/schema';
import { connectTestDatabase } from '@/test/helpers/database';

import { DrizzleUserRepository, DuplicateEmailError } from './user.repository';

type TestDatabase = Awaited<ReturnType<typeof connectTestDatabase>>;

describe('DrizzleUserRepository (real Postgres)', () => {
  let database: TestDatabase;
  let repository: DrizzleUserRepository;
  const createdIds: string[] = [];
  const freshEmail = () => `it-${randomUUID()}@example.com`;

  beforeAll(async () => {
    database = await connectTestDatabase();
    repository = new DrizzleUserRepository(database.db);
  });

  afterAll(async () => {
    await database.db.delete(users).where(inArray(users.id, createdIds));
    await database.close();
  });

  it('creates users and finds them by email and id', async () => {
    const email = freshEmail();
    const created = await repository.create({ email, passwordHash: 'hash' });
    createdIds.push(created.id);

    expect(created).toMatchObject({ email, passwordHash: 'hash' });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await repository.findByEmail(email)).toEqual(created);
    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('returns null for unknown users', async () => {
    expect(await repository.findByEmail(freshEmail())).toBeNull();
    expect(await repository.findById(randomUUID())).toBeNull();
  });

  it('maps the unique-violation to DuplicateEmailError (through drizzle error wrapping)', async () => {
    const email = freshEmail();
    createdIds.push((await repository.create({ email, passwordHash: 'one' })).id);

    await expect(repository.create({ email, passwordHash: 'two' })).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });

  it('enforces lower-case emails at the database level', async () => {
    const attempt = repository.create({
      email: `Mixed-${randomUUID()}@Example.com`,
      passwordHash: 'x',
    });

    const error = await attempt.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateEmailError);
  });
});
