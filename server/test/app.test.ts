import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaMetadata } from '../../src/models/media'
import { createApp } from '../src/app'
import { migrate } from '../src/db/migrate'
import { MediaRepository } from '../src/db/repository'
import { ProviderError, TmdbProvider } from '../src/providers/tmdb'
import type { SearchCandidate } from '../src/domain/match'

function tvMetadata(providerId: number, title: string, year: number): MediaMetadata {
  return {
    mediaType: 'tv',
    providerId,
    title,
    originalTitle: title,
    releaseDate: null,
    firstAirDate: `${year}-01-01`,
    year,
    overview: 'Une série dramatique.',
    genres: ['Drama'],
    countries: ['US'],
    runtimeMinutes: 45,
    posterUrl: null,
    backdropUrl: null,
    directors: [],
    creators: [],
    cast: [],
    season: null,
    episode: null,
    episodeTitle: null,
    episodeOriginalTitle: null,
    episodeOverview: null,
    episodeAirDate: null,
    guestCast: [],
    tmdbUrl: `https://www.themoviedb.org/tv/${providerId}`,
  }
}

describe('media API', () => {
  let database: Database.Database
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrate(database)
    app = createApp({
      repository: new MediaRepository(database),
      provider: new TmdbProvider(''),
      providerConfigured: false,
    })
  })

  afterEach(async () => {
    await app.close()
    database.close()
  })

  it('reports database health without exposing provider secrets', async () => {
    const result = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      providerConfigured: false,
    })
  })

  it('returns TMDB details for a selected ambiguous alternative', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    vi.spyOn(provider, 'getDetails').mockResolvedValue({
      mediaType: 'tv',
      providerId: 321,
      title: 'La petite maison',
      originalTitle: 'Little House',
      releaseDate: null,
      firstAirDate: '1974-09-11',
      year: 1974,
      overview: 'Une famille s’installe dans le Minnesota.',
      genres: ['Drame'],
      countries: ['US'],
      runtimeMinutes: 45,
      posterUrl: null,
      backdropUrl: null,
      directors: [],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: 'https://www.themoviedb.org/tv/321',
    })
    app = createApp({ repository, provider, providerConfigured: true, cacheEnabled: false })

    const result = await app.inject({
      method: 'GET',
      url: '/api/v1/details/tv/321',
    })

    expect(result.statusCode).toBe(200)
    expect(result.json().metadata).toMatchObject({
      providerId: 321,
      title: 'La petite maison',
      year: 1974,
      overview: 'Une famille s’installe dans le Minnesota.',
    })
  })

  it('returns unsupported without contacting TMDB for news and sports', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: { title: 'Journal', category: 'Actualités' },
      },
    })
    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({
      status: 'unsupported',
      metadata: null,
      alternatives: [],
    })
  })

  it('returns explicit validation and provider configuration errors', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: { locale: 'fr-FR', programme: { title: '' } },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR')

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: { title: 'Inception', category: 'Film', year: '2010' },
      },
    })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json().error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('bypasses persistent match cache when disabled', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    const search = vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [],
      images: null,
      searchItems: [],
    })
    app = createApp({
      repository,
      provider,
      providerConfigured: true,
      cacheEnabled: false,
    })
    const payload = {
      locale: 'fr-FR',
      programme: {
        title: '9-1-1',
        subtitle: 'Pas de fumée sans feu',
        category: 'Série dramatique',
        year: null,
        durationMinutes: 45,
        season: 9,
        episode: 16,
        directors: [],
        actors: [],
      },
    }

    const first = await app.inject({ method: 'POST', url: '/api/v1/enrich', payload })
    const second = await app.inject({ method: 'POST', url: '/api/v1/enrich', payload })

    expect(first.json().cache).toEqual({ source: 'fresh', expiresAt: null })
    expect(second.json().cache).toEqual({ source: 'fresh', expiresAt: null })
    expect(search).toHaveBeenCalledTimes(2)
    expect(database.prepare('SELECT COUNT(*) AS count FROM media_matches').get()).toMatchObject({
      count: 0,
    })
  })

  it('enriches Mélodie en sous-sol from an exact TMDB title, close duration and matching genre', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        {
          providerId: 12345,
          mediaType: 'movie',
          title: 'Mélodie en sous-sol',
          originalTitle: 'Any Number Can Win',
          year: 1963,
          posterPath: '/poster.jpg',
          popularity: 1,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockResolvedValue({
      mediaType: 'movie',
      providerId: 12345,
      title: 'Mélodie en sous-sol',
      originalTitle: 'Any Number Can Win',
      releaseDate: '1963-03-19',
      firstAirDate: null,
      year: 1963,
      overview: 'Un film policier.',
      genres: ['Crime'],
      countries: ['France'],
      runtimeMinutes: 118,
      posterUrl: null,
      backdropUrl: null,
      directors: [],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: 'https://www.themoviedb.org/movie/12345',
    })
    app = createApp({
      repository,
      provider,
      providerConfigured: true,
      cacheEnabled: false,
    })
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: 'Mélodie en sous-sol',
          subtitle: null,
          category: 'Film policier',
          year: null,
          durationMinutes: 120,
          season: null,
          episode: null,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(provider.searchCandidates).toHaveBeenCalled()
    expect(provider.getDetails).toHaveBeenCalled()
    expect(result.json()).toMatchObject({
      status: 'matched',
      match: { mediaType: 'movie', providerId: 12345, confidence: 85 },
      metadata: { title: 'Mélodie en sous-sol', runtimeMinutes: 118, genres: ['Crime'] },
      cache: { source: 'fresh', expiresAt: null },
    })
  })

  it('searches and matches a telefilm as a movie using synopsis and duration evidence', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    const search = vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        {
          providerId: 111,
          mediaType: 'movie',
          title: 'Les farouches',
          originalTitle: 'The Tough Ones',
          year: 2020,
          posterPath: '/good.jpg',
          popularity: 10,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
        {
          providerId: 222,
          mediaType: 'movie',
          title: 'Les farouches',
          originalTitle: 'Les farouches',
          year: 2017,
          posterPath: '/other.jpg',
          popularity: 20,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockImplementation(async (_mediaType, providerId) => ({
      mediaType: 'movie',
      providerId,
      title: 'Les farouches',
      originalTitle: providerId === 111 ? 'The Tough Ones' : 'Les farouches',
      releaseDate: providerId === 111 ? '2020-01-01' : '2017-01-01',
      firstAirDate: null,
      year: providerId === 111 ? 2020 : 2017,
      overview:
        providerId === 111
          ? 'Deux policiers aux caractères opposés se détestent, puis apprennent que leurs enfants sont en couple.'
          : 'Une famille se retrouve après un long voyage.',
      genres: providerId === 111 ? ['Crime'] : ['Drame'],
      countries: ['FR'],
      runtimeMinutes: providerId === 111 ? 95 : 130,
      posterUrl: null,
      backdropUrl: null,
      directors: [],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: `https://www.themoviedb.org/movie/${providerId}`,
    }))
    app = createApp({
      repository,
      provider,
      providerConfigured: true,
      cacheEnabled: true,
    })

    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: 'Les farouches',
          subtitle: null,
          description:
            'Deux policiers aux caractères opposés, qui se détestent, apprennent que leurs enfants sont en couple.',
          category: 'Téléfilm policier',
          year: null,
          durationMinutes: 90,
          season: null,
          episode: null,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Les farouches', year: null }),
      'movie',
      expect.any(AbortSignal),
    )
    expect(provider.getDetails).toHaveBeenCalledTimes(2)
    expect(result.json()).toMatchObject({
      status: 'matched',
      match: {
        mediaType: 'movie',
        providerId: 111,
        confidence: 100,
        method: 'title',
      },
      metadata: { providerId: 111, runtimeMinutes: 95 },
    })
    expect(database.prepare('SELECT media_type, programme_kind FROM media_matches').get()).toEqual({
      media_type: 'movie',
      programme_kind: 'tv_movie',
    })
  })

  it('matches a telefilm stored as a TMDB TV entry without changing its programme kind', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        {
          providerId: 291612,
          mediaType: 'tv',
          title: 'Les Farouches',
          originalTitle: 'Les Farouches',
          year: 2026,
          posterPath: '/farouches.jpg',
          popularity: 10,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockResolvedValue({
      mediaType: 'tv',
      providerId: 291612,
      title: 'Les Farouches',
      originalTitle: 'Les Farouches',
      releaseDate: null,
      firstAirDate: '2026-10-19',
      year: 2026,
      overview:
        'À la SRPJ de Lyon, deux policiers aux caractères opposés apprennent que leurs enfants sont en couple.',
      genres: ['Drame'],
      countries: ['FR'],
      runtimeMinutes: 52,
      posterUrl: null,
      backdropUrl: null,
      directors: [],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: 'https://www.themoviedb.org/tv/291612',
    })
    app = createApp({
      repository,
      provider,
      providerConfigured: true,
      cacheEnabled: true,
    })

    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: 'Les Farouches',
          subtitle: null,
          description:
            'Deux policiers aux caractères opposés, qui se détestent, apprennent que leurs enfants sont en couple. Cette nouvelle va bouleverser leur relation de travail.',
          category: 'Téléfilm policier',
          year: null,
          durationMinutes: 90,
          season: null,
          episode: null,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({
      status: 'matched',
      match: { mediaType: 'tv', providerId: 291612 },
      metadata: { mediaType: 'tv', providerId: 291612 },
    })
    expect(database.prepare('SELECT media_type, programme_kind FROM media_matches').get()).toEqual({
      media_type: 'tv',
      programme_kind: 'tv_movie',
    })
  })

  it('enriches 9-1-1 season 9 episode 16 as a series and fetches that episode', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    const search = vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        {
          providerId: 89393,
          mediaType: 'tv',
          title: '9-1-1',
          originalTitle: '9-1-1',
          year: 2018,
          posterPath: '/poster.jpg',
          popularity: 40,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
        {
          providerId: 75219,
          mediaType: 'tv',
          title: '9-1-1',
          originalTitle: '9-1-1',
          year: 2018,
          posterPath: '/poster.jpg',
          popularity: 30,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockImplementation(async (_mediaType, providerId) => ({
      mediaType: 'tv',
      providerId,
      title: '9-1-1',
      originalTitle: '9-1-1',
      releaseDate: null,
      firstAirDate: '2018-01-03',
      year: 2018,
      overview: 'Drame de secouristes.',
      genres: ['Drame'],
      countries: ['US'],
      runtimeMinutes: null,
      posterUrl: null,
      backdropUrl: null,
      directors: [],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: `https://www.themoviedb.org/tv/${providerId}`,
    }))
    const getEpisode = vi.spyOn(provider, 'getEpisode').mockImplementation(async (seriesId) => {
      if (seriesId !== 75219) throw new ProviderError('Épisode introuvable', 'NOT_FOUND', 404)
      return {
        name: 'Pas de fumée sans feu',
        originalName: "Where There's Smoke",
        overview:
          'The 118 must justify every decision made during a recent intervention as an investigation into possible errors is underway.',
        airDate: '2026-04-16',
        guestCast: [],
      }
    })
    app = createApp({
      repository,
      provider,
      providerConfigured: true,
      cacheEnabled: true,
    })

    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: '9-1-1',
          subtitle: 'Pas de fumée sans feu',
          description:
            "La 118 doit justifier chaque décision prise lors d'une récente intervention, alors qu'une enquête pour déterminer d'éventuelles erreurs est en cours.",
          category: 'Série dramatique',
          year: null,
          durationMinutes: 45,
          season: 9,
          episode: 16,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ title: '9-1-1', season: 9, episode: 16 }),
      'tv',
      expect.any(AbortSignal),
    )
    expect(getEpisode).toHaveBeenCalledWith(
      75219,
      9,
      16,
      expect.any(AbortSignal),
      'Pas de fumée sans feu',
    )
    expect(getEpisode).toHaveBeenCalledWith(
      89393,
      9,
      16,
      expect.any(AbortSignal),
      'Pas de fumée sans feu',
    )
    expect(result.json()).toMatchObject({
      status: 'matched',
      match: {
        mediaType: 'tv',
        providerId: 75219,
        confidence: 95,
        method: 'title_and_episode',
        evidence: {
          seriesTitleExact: true,
          episodeTitleSimilarity: 1,
          episodeNumberMatch: true,
          episodeNumberOffset: 0,
          contradictoryEvidence: [],
        },
      },
      metadata: {
        title: '9-1-1',
        season: 9,
        episode: 16,
        episodeTitle: 'Pas de fumée sans feu',
        episodeOriginalTitle: "Where There's Smoke",
        episodeOverview:
          'The 118 must justify every decision made during a recent intervention as an investigation into possible errors is underway.',
      },
      cache: { source: 'fresh' },
    })
    const savedMatch = database
      .prepare('SELECT method, score, evidence_json FROM media_matches')
      .get() as { method: string; score: number; evidence_json: string }
    expect(savedMatch).toMatchObject({ method: 'title_and_episode', score: 95 })
    expect(JSON.parse(savedMatch.evidence_json)).toMatchObject({
      episodeTitleSimilarity: 1,
      episodeNumberOffset: 0,
    })
    expect(
      database
        .prepare(
          'SELECT series_id, season_number, episode_number FROM episode_items WHERE series_id = 75219',
        )
        .get(),
    ).toMatchObject({ series_id: 75219, season_number: 9, episode_number: 16 })
  })

  it('keeps homonymous series ambiguous without year, cast, or episode evidence', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        ...[101, 202].map((providerId): SearchCandidate => ({
          providerId,
          mediaType: 'tv',
          title: 'Hôpital Central',
          originalTitle: 'Hôpital Central',
          year: providerId === 101 ? 2002 : 2017,
          posterPath: null,
          popularity: providerId,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        })),
        {
          providerId: 303,
          mediaType: 'tv',
          title: 'Clinique du Nord',
          originalTitle: 'Northern Clinic',
          year: 2010,
          posterPath: null,
          popularity: 1,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockImplementation(async (_mediaType, providerId) =>
      tvMetadata(providerId, 'Hôpital Central', providerId === 101 ? 2002 : 2017),
    )
    app = createApp({ repository, provider, providerConfigured: true, cacheEnabled: false })

    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: 'Hôpital Central',
          category: 'Série dramatique',
          year: null,
          durationMinutes: null,
          season: null,
          episode: null,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    const body = result.json()
    expect(body).toMatchObject({
      status: 'ambiguous',
      match: null,
      evidence: {
        seriesTitleExact: true,
        seriesYearMatch: null,
      },
      alternatives: [
        { providerId: 202, year: 2017 },
        { providerId: 101, year: 2002 },
      ],
    })
    expect(body.alternatives).toHaveLength(2)
    expect(body.alternatives).not.toContainEqual(expect.objectContaining({ providerId: 303 }))
  })

  it('accepts a neighboring episode only when its title confirms the XMLTV episode', async () => {
    await app.close()
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    vi.spyOn(provider, 'searchCandidates').mockResolvedValue({
      candidates: [
        {
          providerId: 303,
          mediaType: 'tv',
          title: 'Une série',
          originalTitle: 'A Series',
          year: 2020,
          posterPath: null,
          popularity: 10,
          runtimeMinutes: 45,
          genres: [],
          creditedPeople: [],
        },
      ],
      images: null,
      searchItems: [],
    })
    vi.spyOn(provider, 'getDetails').mockResolvedValue(tvMetadata(303, 'Une série', 2020))
    const getEpisode = vi
      .spyOn(provider, 'getEpisode')
      .mockImplementation(async (_seriesId, _season, episodeNumber) => {
        if (episodeNumber !== 2) throw new ProviderError('Épisode introuvable', 'NOT_FOUND', 404)
        return {
          name: 'Le passage',
          originalName: 'The Crossing',
          overview: null,
          originalOverview: null,
          airDate: '2020-01-08',
          guestCast: [],
        }
      })
    app = createApp({ repository, provider, providerConfigured: true, cacheEnabled: false })

    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: {
        locale: 'fr-FR',
        programme: {
          title: 'Une série',
          subtitle: 'Le passage',
          category: 'Série dramatique',
          year: null,
          durationMinutes: 45,
          season: 1,
          episode: 3,
          directors: [],
          actors: [],
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(getEpisode).toHaveBeenCalledWith(303, 1, 2, expect.any(AbortSignal), 'Le passage')
    expect(result.json()).toMatchObject({
      status: 'matched',
      match: {
        method: 'title_and_episode',
        evidence: {
          episodeTitleSimilarity: 1,
          episodeNumberMatch: false,
          episodeNumberOffset: -1,
        },
      },
      metadata: { episode: 2, episodeTitle: 'Le passage' },
    })
  })

  it('rejects cross-origin enrichment and oversized payloads', async () => {
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      headers: { origin: 'https://other.example' },
      payload: {
        locale: 'fr-FR',
        programme: { title: 'Journal', category: 'Actualités' },
      },
    })
    expect(crossOrigin.statusCode).toBe(403)

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/enrich',
      payload: { locale: 'fr-FR', programme: { title: 'x'.repeat(5000) } },
    })
    expect(oversized.statusCode).toBe(413)
    expect(oversized.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('coalesces concurrent enrichment requests for the same programme', async () => {
    await app.close()
    database.close()
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrate(database)
    const repository = new MediaRepository(database)
    const provider = new TmdbProvider('test-token')
    const candidate: SearchCandidate = {
      providerId: 42,
      mediaType: 'movie',
      title: 'Inception',
      originalTitle: 'Inception',
      year: 2010,
      posterPath: null,
      popularity: 1,
      runtimeMinutes: null,
      genres: [],
      creditedPeople: [],
    }
    const metadata: MediaMetadata = {
      mediaType: 'movie',
      providerId: 42,
      title: 'Inception',
      originalTitle: 'Inception',
      releaseDate: '2010-07-15',
      firstAirDate: null,
      year: 2010,
      overview: 'Résumé',
      genres: [],
      countries: [],
      runtimeMinutes: 148,
      posterUrl: null,
      backdropUrl: null,
      directors: [{ providerId: 7, name: 'Christopher Nolan' }],
      creators: [],
      cast: [],
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: 'https://www.themoviedb.org/movie/42',
    }
    const search = vi.spyOn(provider, 'searchCandidates').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { candidates: [candidate], images: null, searchItems: [] }
    })
    const details = vi.spyOn(provider, 'getDetails').mockResolvedValue(metadata)
    app = createApp({ repository, provider, providerConfigured: true })
    const payload = {
      locale: 'fr-FR',
      programme: {
        title: 'Inception',
        category: 'Film',
        year: '2010',
        durationMinutes: 148,
        directors: ['Christopher Nolan'],
      },
    }

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: 'POST', url: '/api/v1/enrich', payload }),
      ),
    )
    expect(responses.every((response) => response.statusCode === 200)).toBe(true)
    expect(responses.every((response) => response.json().status === 'matched')).toBe(true)
    expect(search).toHaveBeenCalledTimes(1)
    expect(details).toHaveBeenCalledTimes(1)
  })
})
