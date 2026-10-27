import type Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function migrate(db: Database.Database) {
  const hasMigrationTable = Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get(),
  )
  const migrations = [
    { version: 1, file: '001_init.sql' },
    { version: 2, file: '002_recheck_failed_matches.sql' },
    { version: 3, file: '003_recheck_failed_matches.sql' },
    { version: 4, file: '004_add_match_method.sql' },
    { version: 5, file: '005_add_programme_kind.sql' },
    { version: 6, file: '006_add_match_evidence.sql' },
    { version: 7, file: '007_recheck_failed_matches.sql' },
  ]
  for (const migration of migrations) {
    const sql = readFileSync(resolve(process.cwd(), 'server/migrations', migration.file), 'utf8')
    const apply = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
    })
    const alreadyApplied =
      migration.version === 1 && !hasMigrationTable
        ? false
        : Boolean(
            db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version),
          )
    if (!alreadyApplied) apply()
  }
}
