// Apply supabase/schema.sql and supabase/migrations/*.sql. Usage: npm run db:push
// Reads PROJECT_URL + DATABASE_PASSWORD (+ optional SUPABASE_DB_HOST / DATABASE_URL).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const projectUrl = process.env.PROJECT_URL;
  const password = process.env.DATABASE_PASSWORD;
  if (!projectUrl || !password) {
    throw new Error("Set PROJECT_URL and DATABASE_PASSWORD (or DATABASE_URL) in .env");
  }
  const ref = new URL(projectUrl).hostname.split(".")[0];
  const host = process.env.SUPABASE_DB_HOST ?? "aws-0-ap-northeast-2.pooler.supabase.com";
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres`;
}

const root = new URL("..", import.meta.url);
const schemaPath = new URL("supabase/schema.sql", root);
const migrationsDir = fileURLToPath(new URL("supabase/migrations/", root));

const files = [schemaPath];
if (existsSync(migrationsDir)) {
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()) {
    files.push(new URL(name, `file://${migrationsDir.replace(/\\/g, "/")}`));
  }
}

const sql = postgres(connectionString(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });

try {
  for (const file of files) {
    await sql.unsafe(readFileSync(file, "utf8"));
    console.log(`applied ${fileURLToPath(file).split(/[\\/]/).slice(-1)[0]}`);
  }

  const columns = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name in ('meetings', 'attendance')
    order by table_name, ordinal_position
  `;
  for (const table of ["meetings", "attendance"]) {
    const names = columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    console.log(`${table}: ${names.join(", ")}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
