import type Database from 'better-sqlite3'
import type { MediaMetadata, MatchAlternative, MediaType } from '../../../src/models/media.js'
import type { ProgrammeInput } from '../domain/classify.js'
import { normalizeTitle, parseReleaseYear } from '../domain/normalize.js'
import type { MatchEvidence } from '../domain/episodeEvidence.js'

export interface MatchRow {
  fingerprint: string
  normalized_title: string
  media_type: MediaType
  release_year: number | null
  provider_id: number | null
  score: number | null
  status: 'matched' | 'ambiguous' | 'not_found'
  method: 'title' | 'title_and_episode' | 'series_only' | 'manual'
  programme_kind: 'movie' | 'tv_movie' | 'tv_series'
  manual_override: number
  candidates_json: string | null
  evidence_json: string | null
  checked_at: string
  expires_at: string
}

export class MediaRepository {
  constructor(private readonly db: Database.Database) {}

  getMatch(fingerprint: string) {
    return this.db.prepare('SELECT * FROM media_matches WHERE fingerprint = ?').get(fingerprint) as
      MatchRow | undefined
  }

  ping() {
    this.db.prepare('SELECT 1').get()
  }

  getMedia(mediaType: MediaType, providerId: number) {
    const row = this.db
      .prepare(
        `SELECT payload_json, expires_at FROM media_items
         WHERE provider = 'tmdb' AND media_type = ? AND provider_id = ?`,
      )
      .get(mediaType, providerId) as { payload_json: string; expires_at: string } | undefined
    return row
      ? { metadata: JSON.parse(row.payload_json) as MediaMetadata, expiresAt: row.expires_at }
      : undefined
  }

  getEpisode(seriesId: number, season: number, episode: number) {
    const row = this.db
      .prepare(
        `SELECT payload_json, expires_at FROM episode_items
         WHERE provider = 'tmdb' AND series_id = ? AND season_number = ? AND episode_number = ?`,
      )
      .get(seriesId, season, episode) as { payload_json: string; expires_at: string } | undefined
    return row
      ? { payload: JSON.parse(row.payload_json) as EpisodePayload, expiresAt: row.expires_at }
      : undefined
  }

  saveMedia(metadata: MediaMetadata, expiresAt: string, fetchedAt = new Date().toISOString()) {
    this.db
      .prepare(
        `INSERT INTO media_items (provider, media_type, provider_id, payload_json, fetched_at, expires_at)
         VALUES ('tmdb', ?, ?, ?, ?, ?)
         ON CONFLICT(provider, media_type, provider_id) DO UPDATE SET
           payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      )
      .run(metadata.mediaType, metadata.providerId, JSON.stringify(metadata), fetchedAt, expiresAt)
  }

  saveEpisode(
    seriesId: number,
    season: number,
    episode: number,
    payload: EpisodePayload,
    expiresAt: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO episode_items
         (provider, series_id, season_number, episode_number, payload_json, fetched_at, expires_at)
         VALUES ('tmdb', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, series_id, season_number, episode_number) DO UPDATE SET
           payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      )
      .run(seriesId, season, episode, JSON.stringify(payload), new Date().toISOString(), expiresAt)
  }

  saveMatch(
    fingerprint: string,
    programme: ProgrammeInput,
    mediaType: MediaType,
    status: MatchRow['status'],
    providerId: number | null,
    score: number | null,
    candidates: MatchAlternative[],
    ttlDays: number,
    method: MatchRow['method'] = 'title',
    programmeKind: MatchRow['programme_kind'] = mediaType === 'tv' ? 'tv_series' : 'movie',
    evidence: MatchEvidence | null = null,
  ) {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlDays * 86400000).toISOString()
    this.db
      .prepare(
        `INSERT INTO media_matches
         (fingerprint, normalized_title, media_type, release_year, provider_id, score, status, manual_override,
          candidates_json, checked_at, expires_at, updated_at, method, programme_kind, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           normalized_title = excluded.normalized_title, media_type = excluded.media_type,
           release_year = excluded.release_year, provider_id = excluded.provider_id, score = excluded.score,
           status = excluded.status, candidates_json = excluded.candidates_json,
           method = excluded.method,
           programme_kind = excluded.programme_kind,
           evidence_json = excluded.evidence_json,
           checked_at = excluded.checked_at, expires_at = excluded.expires_at, updated_at = excluded.updated_at
         WHERE media_matches.manual_override = 0`,
      )
      .run(
        fingerprint,
        normalizeTitle(programme.title),
        mediaType,
        parseYear(programme.year),
        providerId,
        score,
        status,
        JSON.stringify(candidates),
        now.toISOString(),
        expiresAt,
        now.toISOString(),
        method,
        programmeKind,
        evidence ? JSON.stringify(evidence) : null,
      )
    return expiresAt
  }

  saveManualMatch(
    fingerprint: string,
    metadata: MediaMetadata,
    programmeTitle: string,
    releaseYear: number | null,
  ) {
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString()
    const mediaExpiresAt = new Date(
      Date.now() + (metadata.mediaType === 'movie' ? 30 : 7) * 86400000,
    ).toISOString()
    const save = this.db.transaction(() => {
      this.saveMedia(metadata, mediaExpiresAt, now)
      const existing = this.getMatch(fingerprint)
      if (!existing) return false
      this.db
        .prepare(
          `UPDATE media_matches SET normalized_title = ?, media_type = ?, release_year = ?,
           provider_id = ?, score = 100, status = 'matched', manual_override = 1, method = 'manual',
           programme_kind = CASE WHEN media_type = 'tv' THEN 'tv_series' ELSE 'movie' END,
           candidates_json = '[]', evidence_json = NULL, checked_at = ?, expires_at = ?, updated_at = ?
           WHERE fingerprint = ?`,
        )
        .run(
          programmeTitle,
          metadata.mediaType,
          releaseYear,
          metadata.providerId,
          now,
          expiresAt,
          now,
          fingerprint,
        )
      return true
    })
    return save()
  }

  clearManualMatch(fingerprint: string) {
    return (
      this.db
        .prepare('DELETE FROM media_matches WHERE fingerprint = ? AND manual_override = 1')
        .run(fingerprint).changes > 0
    )
  }

  cleanupExpired() {
    const cleanup = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM media_matches WHERE manual_override = 0 AND expires_at <= ?')
        .run(new Date().toISOString())
      this.db
        .prepare('DELETE FROM episode_items WHERE expires_at <= ?')
        .run(new Date().toISOString())
      this.db
        .prepare(
          `DELETE FROM media_items WHERE expires_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM media_matches
             WHERE media_matches.provider = media_items.provider
               AND media_matches.media_type = media_items.media_type
               AND media_matches.provider_id = media_items.provider_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM episode_items
             WHERE episode_items.provider = media_items.provider
               AND episode_items.series_id = media_items.provider_id
           )`,
        )
        .run(new Date().toISOString())
    })
    cleanup()
  }

  saveEpisodeInMedia(
    media: MediaMetadata,
    payload: EpisodePayload,
    season: number,
    episode: number,
  ) {
    return {
      ...media,
      season,
      episode,
      episodeTitle: payload.name,
      episodeOriginalTitle: payload.originalName ?? null,
      episodeOverview: payload.overview,
      episodeAirDate: payload.airDate,
      guestCast: payload.guestCast,
    }
  }
}

export interface EpisodePayload {
  name: string | null
  originalName?: string | null
  overview: string | null
  originalOverview?: string | null
  airDate: string | null
  guestCast: MediaMetadata['guestCast']
}

function parseYear(year: string | null) {
  return parseReleaseYear(year)
}
