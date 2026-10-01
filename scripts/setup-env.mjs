import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Creates .env from the template with a fresh JWT secret; never overwrites an existing file.
if (existsSync('.env')) {
  console.log('.env already exists, leaving it untouched.');
} else {
  const secret = randomBytes(48).toString('base64');
  const contents = readFileSync('.env.example', 'utf8').replace(
    /^JWT_SECRET=.*$/m,
    `JWT_SECRET=${secret}`,
  );
  // Owner-only: the file will hold an API key.
  writeFileSync('.env', contents, { mode: 0o600 });
  console.log(
    'Created .env with a generated JWT_SECRET (LLM_PROVIDER=mock works without an API key).',
  );
}
