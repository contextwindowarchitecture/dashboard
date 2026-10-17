// A PostgreSQL server for the contract suites, when TEST_DATABASE_URL names one: every cwa_ table is
// dropped first, whichever migrations made them, so each test starts from an empty database.
// `podman run -e POSTGRESQL_USER=cwa -e POSTGRESQL_PASSWORD=… -e POSTGRESQL_DATABASE=cwa -p 5432:5432
// quay.io/sclorg/postgresql-16-c9s`, the image the cluster runs.

import type pg from "pg"

export const SERVER = process.env["TEST_DATABASE_URL"] || undefined

export async function emptyServerDatabase(): Promise<pg.Pool> {
  const { default: postgres } = await import("pg")
  const pool = new postgres.Pool({ connectionString: SERVER })
  const { rows } = await pool.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = current_schema() and tablename like 'cwa\\_%'",
  )
  for (const { name } of rows) await pool.query(`drop table "${name}" cascade`)
  return pool
}
