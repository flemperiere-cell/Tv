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

  it('rechecks cached ambiguous matches after updating movie matching thresholds', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 7').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, 'movie', ?, 0, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, status] of [
      ['a'.repeat(64), 'ambiguous'],
      ['b'.repeat(64), 'not_found'],
      ['c'.repeat(64), 'matched'],
    ]) {
      insert.run(
        fingerprint,
        status,
        status,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['c'.repeat(64)])
    database.close()
  })

  it('rechecks cached failed matches to add score diagnostics', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 8').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, 'movie', ?, 0, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, status] of [
      ['a'.repeat(64), 'ambiguous'],
      ['b'.repeat(64), 'not_found'],
      ['c'.repeat(64), 'matched'],
    ]) {
      insert.run(
        fingerprint,
        status,
        status,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['c'.repeat(64)])
    database.close()
  })

  it('rechecks cached alternatives after expanding the proposal list', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 9').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, 'movie', ?, ?, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, status, manualOverride] of [
      ['a'.repeat(64), 'ambiguous', 0],
      ['b'.repeat(64), 'not_found', 0],
      ['c'.repeat(64), 'ambiguous', 1],
      ['d'.repeat(64), 'matched', 0],
    ]) {
      insert.run(
        fingerprint,
        status,
        status,
        manualOverride,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['c'.repeat(64), 'd'.repeat(64)])
    database.close()
  })

  it('rechecks automatic matches after changing exact-title scoring', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 10').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, 'movie', ?, ?, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, status, manualOverride] of [
      ['a'.repeat(64), 'matched', 0],
      ['b'.repeat(64), 'ambiguous', 0],
      ['c'.repeat(64), 'matched', 1],
    ]) {
      insert.run(
        fingerprint,
        status,
        status,
        manualOverride,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['c'.repeat(64)])
    database.close()
  })

  it('rechecks failed series matches after adding type confirmation', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 11').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        programme_kind, candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, mediaType, status, manualOverride, programmeKind] of [
      ['a'.repeat(64), 'tv', 'ambiguous', 0, 'tv_series'],
      ['b'.repeat(64), 'tv', 'not_found', 0, 'tv_series'],
      ['c'.repeat(64), 'tv', 'matched', 0, 'tv_series'],
      ['d'.repeat(64), 'tv', 'ambiguous', 1, 'tv_series'],
      ['e'.repeat(64), 'movie', 'ambiguous', 0, 'tv_movie'],
    ]) {
      insert.run(
        fingerprint,
        fingerprint,
        mediaType,
        status,
        manualOverride,
        programmeKind,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual([
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
    ])
    database.close()
  })

  it('rechecks automatic matches to add selection explanations', () => {
    const database = new Database(':memory:')
    migrate(database)
    database.prepare('DELETE FROM schema_migrations WHERE version = 12').run()
    const insert = database.prepare(
      `INSERT INTO media_matches
       (fingerprint, normalized_title, media_type, status, manual_override,
        candidates_json, checked_at, expires_at, updated_at)
       VALUES (?, ?, 'movie', ?, ?, '[]', ?, ?, ?)`,
    )
    for (const [fingerprint, status, manualOverride] of [
      ['a'.repeat(64), 'matched', 0],
      ['b'.repeat(64), 'matched', 1],
      ['c'.repeat(64), 'ambiguous', 0],
    ]) {
      insert.run(
        fingerprint,
        fingerprint,
        status,
        manualOverride,
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
    }

    migrate(database)

    const rows = database
      .prepare('SELECT fingerprint FROM media_matches ORDER BY fingerprint')
      .all() as Array<{ fingerprint: string }>
    expect(rows.map((row) => row.fingerprint)).toEqual(['b'.repeat(64), 'c'.repeat(64)])
    database.close()
  })
})
