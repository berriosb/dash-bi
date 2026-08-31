import postgres from 'postgres';

/**
 * Default connection string used by dash-bi's docker-compose stack.
 * Kept in sync with app/docker-compose.yml so e2e tests work out of
 * the box once `pnpm docker:up` is run.
 */
const DEFAULT_DATABASE_URL =
  'postgresql://dashbi:changeme@localhost:5432/dashbi';

function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

/**
 * better-auth's MockEmailProvider swallows the verification email,
 * so the dev/CI equivalent of clicking the link in the inbox is to
 * flip `email_verified = true` directly in the database.
 *
 * Used by every e2e spec that signs a user up via the better-auth
 * API and then needs to sign in via the UI.
 *
 * Throws on connection failure so the spec fails loud instead of
 * silently logging the user in as unverified.
 */
export async function markEmailVerified(email: string): Promise<void> {
  const client = postgres(resolveDatabaseUrl(), { max: 1 });
  try {
    await client`
      UPDATE users SET email_verified = true WHERE email = ${email}
    `;
  } finally {
    await client.end({ timeout: 5 });
  }
}
