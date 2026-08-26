// Minimal migration runner — fine for the handful of numbered .sql files
// this project will realistically accumulate. Reach for a real migration
// tool only if that stops being true.
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required (set it in server/.env)");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const { rows: applied } = await pool.query(`select name from _migrations`);
  const appliedNames = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedNames.has(file)) {
      console.log(`skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`applying: ${file}`);
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query(`insert into _migrations (name) values ($1)`, [file]);
      await pool.query("commit");
    } catch (err) {
      await pool.query("rollback");
      throw err;
    }
  }

  await pool.end();
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
