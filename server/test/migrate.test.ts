import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrate'

describe('database migrations', () => {
  it('rechecks failed automatic matches once without removing confirmed matches', () => {
    const database = new Database(':memory:')
    migrate(database)
    const columns = database.prepare('PRAGMA table_info(media_matches)').all() as Array<{
      name: string
    }>
    expect(columns.some((column) => column.name === 'evidence_json')).toBe(true)
    database.prepare('DELETE FROM schema_migrations WHERE version = 3').run()
    database
      .prepare(
        `INSERT INTO media_matches
         (fingerprint, normalized_title, media_type, status, manual_override,
          candidates_json, checked_at, expires_at, updated_at)
         VALUES (?, ?, 'tv', ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        'a'.repeat(64),
        'not found',
        'not_found',
        0,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    database
      .prepare(
        `INSERT INTO media_matches
         (fingerprint, normalized_title, media_type, status, manual_override,
          candidates_json, checked_at, expires_at, updated_at)
         VALUES (?, ?, 'tv', ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        'b'.repeat(64),
        'matched',
        'matched',
        0,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['b'.repeat(64)])
    database.close()
  })
})
