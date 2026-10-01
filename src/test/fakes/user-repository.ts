import {
  DuplicateEmailError,
  type NewUser,
  type UserRecord,
  type UserRepository,
} from '@/server/modules/auth/user.repository';

export class InMemoryUserRepository implements UserRepository {
  private readonly rows: UserRecord[] = [];

  async create(input: NewUser): Promise<UserRecord> {
    if (this.rows.some((row) => row.email === input.email)) throw new DuplicateEmailError();
    const record: UserRecord = { id: crypto.randomUUID(), createdAt: new Date(), ...input };
    this.rows.push(record);
    return record;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.rows.find((row) => row.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  get all(): readonly UserRecord[] {
    return this.rows;
  }
}
