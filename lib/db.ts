import "server-only";

import postgres from "postgres";

/**
 * Connection string for Supabase Postgres.
 *
 * Priority:
 *  1. DATABASE_URL — a full connection string (e.g. the "Transaction pooler" URL
 *     from Supabase → Connect).
 *  2. PROJECT_URL + DATABASE_PASSWORD — builds the pooler URL for this project.
 *
 * Direct connections (db.<ref>.supabase.co) are IPv6-only at Supabase, so the
 * pooler is used everywhere, including local development.
 */
function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const projectUrl = process.env.PROJECT_URL;
  const password = process.env.DATABASE_PASSWORD;
  if (!projectUrl || !password) {
    throw new Error(
      "Database is not configured: set PROJECT_URL and DATABASE_PASSWORD (or DATABASE_URL) in .env",
    );
  }

  const ref = new URL(projectUrl).hostname.split(".")[0];
  const host =
    process.env.SUPABASE_DB_HOST ?? "aws-0-ap-northeast-2.pooler.supabase.com";

  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres`;
}

declare global {
  var __meetingQrSql: postgres.Sql | undefined;
}

function createClient() {
  return postgres(connectionString(), {
    ssl: "require",
    // pgBouncer runs in transaction mode on port 6543: no named prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

// Reuse one pool across hot reloads in development.
export const sql = globalThis.__meetingQrSql ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__meetingQrSql = sql;
}
