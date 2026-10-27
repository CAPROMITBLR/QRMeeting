// Load the faculty directory from the roster spreadsheet into Supabase.
//
//   npm run db:seed-faculty            # reads FacultyList.xlsx from the repo root
//   node --env-file=.env scripts/seed-faculty.mjs path/to/roster.xlsx
//
// Rows are matched on (mahe_id, name), so re-running updates departments instead
// of piling up duplicates. The spreadsheet itself is gitignored: once the rows
// are in Postgres they are the source of truth.
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const ID_HEADER = "MAHE ID";
const NAME_HEADERS = ["Name of the Faculty", "Name", "Faculty Name"];
const DEPARTMENT_HEADERS = ["Department", "Dept"];

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

function clean(value) {
  return (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMaheId(value) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

function findColumn(cells, candidates) {
  const upper = cells.map((cell) => cell.toUpperCase());
  for (const candidate of candidates) {
    const index = upper.indexOf(candidate.toUpperCase());
    if (index !== -1) return index;
  }
  return -1;
}

async function readRoster(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      for (let column = 1; column <= Math.max(sheet.columnCount, 5); column += 1) {
        cells.push(clean(row.getCell(column).text));
      }
      rows.push(cells);
    });
    if (rows.length === 0) continue;

    const headerIndex = rows.findIndex((cells) => findColumn(cells, [ID_HEADER]) !== -1);
    if (headerIndex === -1) continue;

    const header = rows[headerIndex];
    const idColumn = findColumn(header, [ID_HEADER]);
    const nameColumn = findColumn(header, NAME_HEADERS);
    const departmentColumn = findColumn(header, DEPARTMENT_HEADERS);

    const records = [];
    const skipped = [];
    const idless = [];
    for (const cells of rows.slice(headerIndex + 1)) {
      const maheId = normalizeMaheId(cells[idColumn]);
      const name = clean(cells[nameColumn]);
      const department = clean(cells[departmentColumn]);
      if (!maheId && !name) continue;
      if (!name || !department) {
        skipped.push({ maheId, name, department, missing: [
          !name ? "name" : null,
          !department ? "department" : null,
        ].filter(Boolean).join(", ") });
        continue;
      }
      // Someone can be on the roster before their MAHE ID is issued: store the
      // row with a null ID so they are still findable by name.
      if (!maheId) idless.push(name);
      records.push({ mahe_id: maheId || null, name, department });
    }

    return { sheet: sheet.name, records, skipped, idless };
  }

  throw new Error(`No sheet in ${path} has a "${ID_HEADER}" column.`);
}

const path = resolve(process.argv[2] ?? "FacultyList.xlsx");
if (!existsSync(path)) {
  console.error(`Roster not found: ${path}`);
  process.exit(1);
}

const { sheet, records, skipped, idless } = await readRoster(path);

const byId = new Map();
for (const record of records) {
  if (!record.mahe_id) continue;
  byId.set(record.mahe_id, [...(byId.get(record.mahe_id) ?? []), record.name]);
}
const sharedIds = [...byId.entries()].filter(([, names]) => names.length > 1);

const sql = postgres(connectionString(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });

try {
  console.log(`Sheet "${sheet}": ${records.length} faculty rows, ${skipped.length} skipped.`);

  if (records.length > 0) {
    await sql`
      insert into public.faculty ${sql(records, "mahe_id", "name", "department")}
      on conflict (name, mahe_id)
      do update set department = excluded.department, updated_at = now()
    `;
  }

  const [{ count }] = await sql`select count(*)::int as count from public.faculty`;
  const [{ count: departments }] = await sql`select count(distinct department)::int as count from public.faculty`;
  console.log(`public.faculty now holds ${count} rows across ${departments} departments.`);

  for (const [maheId, names] of sharedIds) {
    console.log(`note: ${maheId} is shared by ${names.join(" and ")} — both rows are kept.`);
  }
  for (const name of idless) {
    console.log(`note: ${name} has no MAHE ID in the sheet — stored with an empty ID.`);
  }
  for (const row of skipped) {
    console.log(`skipped (missing ${row.missing}): ${row.name || "(no name)"} ${row.maheId}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
