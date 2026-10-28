import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { timingSafeEqual } from 'node:crypto'
import type { MatchAlternative, MediaMetadata, MediaType } from '../../src/models/media.js'
import type { ProgrammeInput } from './domain/classify.js'
import { classifyProgramme } from './domain/classify.js'
import { scoreEpisodeEvidence } from './domain/episodeEvidence.js'
import type { MatchEvidence } from './domain/episodeEvidence.js'
import {
  chooseCandidate,
  chooseTvMovieCandidate,
  rankCandidates,
  rankTvMovieCandidates,
  type SearchCandidate,
} from './domain/match.js'
import {
  episodeFingerprint,
  fingerprint,
  normalizeTitle,
  parseReleaseYear,
} from './domain/normalize.js'
import { MediaRepository } from './db/repository.js'
import type { EpisodePayload } from './db/repository.js'
import { ProviderError, TmdbProvider } from './providers/tmdb.js'

interface Dependencies {
  repository: MediaRepository
  provider: TmdbProvider
  providerConfigured: boolean
  cacheEnabled?: boolean
  traceTmdb?: boolean
  adminToken?: string
}

interface EnrichBody {
  programme: ProgrammeInput
  locale: 'fr-FR'
}

type MatchMethod = 'title' | 'title_and_episode' | 'series_only' | 'manual'

interface ApiError extends Error {
  statusCode?: number
  code?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value: unknown, maximum: number, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > maximum)
    throw Object.assign(new Error(`Champ ${field} invalide`), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  return value
}

function integerOrNull(value: unknown, min: number, max: number, field: string): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw Object.assign(new Error(`Champ ${field} invalide`), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  return Number(value)
}

function names(value: unknown, field: string) {
  if (value === undefined || value === null) return []
  if (
    !Array.isArray(value) ||
    value.length > 10 ||
    value.some((entry) => typeof entry !== 'string' || entry.length > 120)
  )
    throw Object.assign(new Error(`Champ ${field} invalide`), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  return value as string[]
}

function validateProgramme(value: unknown): ProgrammeInput {
  if (!isRecord(value))
    throw Object.assign(new Error('Programme invalide'), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  const title = value.title
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200)
    throw Object.assign(new Error('Titre invalide'), { statusCode: 400, code: 'VALIDATION_ERROR' })
  const year = stringOrNull(value.year, 32, 'year')
  if (
    year &&
    (!/^\d{4}(?:\d{4}(?:\d{6})?)?(?:\s*[+-]\d{4})?$/.test(year.trim()) ||
      parseReleaseYear(year) === null)
  )
    throw Object.assign(new Error('Année invalide'), { statusCode: 400, code: 'VALIDATION_ERROR' })
  return {
    title: title.trim(),
    subtitle: stringOrNull(value.subtitle, 200, 'subtitle'),
    description: stringOrNull(value.description, 2000, 'description'),
    category: stringOrNull(value.category, 100, 'category'),
    year,
    durationMinutes: integerOrNull(value.durationMinutes, 1, 600, 'durationMinutes'),
    season: integerOrNull(value.season, 0, 500, 'season'),
    episode: integerOrNull(value.episode, 1, 5000, 'episode'),
    directors: names(value.directors, 'directors'),
    actors: names(value.actors, 'actors'),
    channel: stringOrNull(value.channel, 120, 'channel'),
    broadcastDate: stringOrNull(value.broadcastDate, 40, 'broadcastDate'),
  }
}

function response(
  status: 'matched' | 'ambiguous' | 'not_found' | 'unsupported',
  metadata: MediaMetadata | null,
  alternatives: MatchAlternative[],
  cache: { source: 'fresh' | 'cached' | 'stale'; expiresAt: string | null },
  manual = false,
  method?: MatchMethod,
  matchConfidence?: number,
  evidence?: MatchEvidence,
) {
  return {
    status,
    match:
      status === 'matched' && metadata
        ? {
            provider: 'tmdb' as const,
            mediaType: metadata.mediaType,
            providerId: metadata.providerId,
            confidence: manual ? 100 : (matchConfidence ?? alternatives[0]?.confidence ?? 90),
            manual,
            method: manual
              ? 'manual'
              : (method ?? (metadata.mediaType === 'tv' ? 'series_only' : 'title')),
            ...(evidence ? { evidence } : {}),
          }
        : null,
    metadata,
    alternatives: status === 'ambiguous' || status === 'not_found' ? alternatives.slice(0, 5) : [],
    ...(evidence ? { evidence } : {}),
    cache,
    attribution: { provider: 'TMDB' as const, required: true as const },
  }
}

function alternativesFromRow(json: string | null): MatchAlternative[] {
  if (!json) return []
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? (value as MatchAlternative[]).slice(0, 5) : []
  } catch {
    return []
  }
}

function evidenceFromRow(json: string | null): MatchEvidence | undefined {
  if (!json) return undefined
  try {
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object') return undefined
    return value as MatchEvidence
  } catch {
    return undefined
  }
}

function applyEpisode(
  metadata: MediaMetadata,
  episode: EpisodePayload | undefined,
  season: number | null,
  episodeNumber: number | null,
) {
  if (metadata.mediaType !== 'tv' || season === null || episodeNumber === null) return metadata
  return {
    ...metadata,
    season,
    episode: episodeNumber,
    episodeTitle: episode?.name ?? null,
    episodeOriginalTitle: episode?.originalName ?? null,
    episodeOverview: episode?.overview ?? null,
    episodeAirDate: episode?.airDate ?? null,
    guestCast: episode?.guestCast ?? [],
  }
}

function sameOrigin(request: { headers: Record<string, string | string[] | undefined> }) {
  const origin = request.headers.origin
  if (!origin) return true
  const host = request.headers.host
  try {
    return typeof origin === 'string' && typeof host === 'string' && new URL(origin).host === host
  } catch {
    return false
  }
}

function authorized(
  request: { headers: Record<string, string | string[] | undefined> },
  token?: string,
) {
  const supplied = request.headers['x-admin-token']
  if (!token || typeof supplied !== 'string') return false
  const expectedBuffer = Buffer.from(token)
  const suppliedBuffer = Buffer.from(supplied)
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  )
}

function requireAdmin(
  request: { headers: Record<string, string | string[] | undefined> },
  token?: string,
) {
  if (!token)
    throw Object.assign(new Error('Administration non configurée'), {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
  if (!sameOrigin(request))
    throw Object.assign(new Error('Origine non autorisée'), { statusCode: 403, code: 'FORBIDDEN' })
  if (!authorized(request, token))
    throw Object.assign(new Error('Authentification requise'), {
      statusCode: 401,
      code: 'UNAUTHORIZED',
    })
}

export function createApp(dependencies: Dependencies): FastifyInstance {
  const logLevel = process.env.LOG_LEVEL || 'info'
  const app = Fastify({
    logger: { level: logLevel },
    ajv: { customOptions: { coerceTypes: false } },
    bodyLimit: 4096,
    requestTimeout: 8_000,
    trustProxy: '127.0.0.1',
  })
  const { repository, provider } = dependencies
  const cacheEnabled = dependencies.cacheEnabled ?? true
  app.log.info(
    {
      logLevel,
      tmdbTrace: dependencies.traceTmdb ?? false,
      mediaCacheEnabled: dependencies.cacheEnabled ?? true,
      providerConfigured: dependencies.providerConfigured,
    },
    'Backend runtime configuration',
  )
  if (logLevel === 'debug') app.log.debug('Backend debug logging enabled')
  if (dependencies.traceTmdb) {
    provider.setTraceLogger((trace) => app.log.info({ tmdb: trace }, 'TMDB HTTP trace'))
    app.log.info({ method: 'GET', body: null }, 'TMDB HTTP tracing enabled')
  }
  const flights = new Map<string, Promise<ReturnType<typeof response>>>()

  void app.register(rateLimit, {
    global: true,
    max: 30,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'Trop de requêtes. Réessayez plus tard.',
        retryAfter: Math.ceil(context.ttl / 1000),
        requestId: request.id,
      },
    }),
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (request.url === '/api/v1/enrich' && request.headers.origin && !sameOrigin(request))
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Origine non autorisée',
          requestId: request.id,
        },
      })
  })

  app.setErrorHandler((error: ApiError, request, reply) => {
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500
    const code =
      statusCode === 413
        ? 'PAYLOAD_TOO_LARGE'
        : statusCode === 429
          ? 'RATE_LIMITED'
          : statusCode === 400
            ? 'VALIDATION_ERROR'
            : error.code || 'INTERNAL_ERROR'
    if (statusCode >= 500) request.log.error({ err: error }, 'API request failed')
    reply.code(statusCode).send({
      error: {
        code,
        message:
          statusCode >= 500 && code === 'INTERNAL_ERROR'
            ? 'Erreur interne du service'
            : error.message,
        requestId: request.id,
      },
    })
  })

  app.get('/api/v1/health', async (request, reply) => {
    try {
      repository.ping()
      return reply.header('Cache-Control', 'no-store').send({
        status: 'ok',
        service: 'media-enrichment',
        version: '1.0.0',
        database: 'ok',
        providerConfigured: dependencies.providerConfigured,
      })
    } catch (error) {
      request.log.error({ err: error }, 'Database health check failed')
      throw Object.assign(new Error('Base de données indisponible'), {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      })
    }
  })

  app.get<{
    Params: { mediaType: MediaType; providerId: string }
  }>(
    '/api/v1/details/:mediaType/:providerId',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          required: ['mediaType', 'providerId'],
          properties: {
            mediaType: { type: 'string', enum: ['movie', 'tv'] },
            providerId: { type: 'string', pattern: '^[1-9]\\d{0,8}$' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!dependencies.providerConfigured)
        throw Object.assign(new Error('Fournisseur non configuré'), {
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
        })
      const providerId = Number(request.params.providerId)
      const cached = cacheEnabled ? repository.getMedia(request.params.mediaType, providerId) : null
      if (cached && Date.parse(cached.expiresAt) > Date.now())
        return reply.header('Cache-Control', 'no-store').send({ metadata: cached.metadata })
      const metadata = await provider.getDetails(
        request.params.mediaType,
        providerId,
        new AbortController().signal,
      )
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
      if (cacheEnabled) repository.saveMedia(metadata, expiresAt)
      return reply.header('Cache-Control', 'no-store').send({ metadata })
    },
  )

  app.post<{ Body: EnrichBody }>(
    '/api/v1/enrich',
    {
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['programme', 'locale'],
          additionalProperties: false,
          properties: {
            locale: { type: 'string', const: 'fr-FR' },
            programme: {
              type: 'object',
              required: ['title'],
              additionalProperties: false,
              properties: {
                title: { type: 'string', minLength: 1, maxLength: 200 },
                subtitle: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
                description: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
                category: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
                year: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
                durationMinutes: {
                  anyOf: [{ type: 'integer', minimum: 1, maximum: 600 }, { type: 'null' }],
                },
                season: {
                  anyOf: [{ type: 'integer', minimum: 0, maximum: 500 }, { type: 'null' }],
                },
                episode: {
                  anyOf: [{ type: 'integer', minimum: 1, maximum: 5000 }, { type: 'null' }],
                },
                directors: {
                  type: 'array',
                  maxItems: 10,
                  items: { type: 'string', maxLength: 120 },
                },
                actors: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 120 } },
                channel: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
                broadcastDate: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const programme = validateProgramme(request.body.programme)
      const classification = classifyProgramme(programme)
      if (dependencies.traceTmdb)
        request.log.info(
          {
            programme: {
              title: programme.title,
              subtitle: programme.subtitle,
              category: programme.category,
              year: programme.year,
              durationMinutes: programme.durationMinutes,
              season: programme.season,
              episode: programme.episode,
            },
            classification,
          },
          'Enrichment input classified',
        )
      if (classification.status === 'unsupported')
        return response('unsupported', null, [], { source: 'fresh', expiresAt: null })
      if (classification.status === 'ambiguous')
        return response('ambiguous', null, [], { source: 'fresh', expiresAt: null })

      const mediaType = classification.mediaType
      const key = fingerprint(mediaType, programme, classification.programmeKind)
      const flightKey = `${key}|${programme.season ?? ''}|${programme.episode ?? ''}`
      const running = flights.get(flightKey)
      if (running) return running

      const task = enrich(programme, mediaType, classification.programmeKind, key, dependencies)
      flights.set(flightKey, task)
      try {
        return await task
      } finally {
        if (flights.get(flightKey) === task) flights.delete(flightKey)
      }
    },
  )

  app.get<{
    Querystring: { query: string; type: MediaType; year?: string }
  }>(
    '/api/v1/search',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        querystring: {
          type: 'object',
          required: ['query', 'type'],
          additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 200 },
            type: { type: 'string', enum: ['movie', 'tv'] },
            year: { type: 'string', pattern: '^\\d{4}$' },
          },
        },
      },
    },
    async (request, reply) => {
      requireAdmin(request, dependencies.adminToken)
      if (!dependencies.providerConfigured)
        throw Object.assign(new Error('Fournisseur non configuré'), {
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
        })
      const controller = new AbortController()
      const year = request.query.year ? Number(request.query.year) : null
      const input: ProgrammeInput = {
        title: request.query.query,
        subtitle: null,
        category: request.query.type === 'movie' ? 'Film' : 'Série',
        year: request.query.year ?? null,
        durationMinutes: null,
        season: null,
        episode: null,
        description: null,
        directors: [],
        actors: [],
        channel: null,
        broadcastDate: null,
      }
      const { candidates, images } = await provider.searchCandidates(
        input,
        request.query.type,
        controller.signal,
      )
      return reply.send({
        results: candidates.map((candidate) => ({
          providerId: candidate.providerId,
          mediaType: candidate.mediaType,
          title: candidate.title,
          year: candidate.year ?? (year && Number.isInteger(year) ? year : null),
          posterUrl: provider.alternative(candidate, images, 0).posterUrl,
        })),
        query: request.query.query,
      })
    },
  )

  app.put<{
    Params: { fingerprint: string }
    Body: { mediaType: MediaType; providerId: number; reason: string }
  }>(
    '/api/v1/matches/:fingerprint',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          required: ['fingerprint'],
          properties: { fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
        },
        body: {
          type: 'object',
          required: ['mediaType', 'providerId', 'reason'],
          additionalProperties: false,
          properties: {
            mediaType: { type: 'string', enum: ['movie', 'tv'] },
            providerId: { type: 'integer', minimum: 1 },
            reason: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      requireAdmin(request, dependencies.adminToken)
      if (!dependencies.providerConfigured)
        throw Object.assign(new Error('Fournisseur non configuré'), {
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
        })
      const existing = repository.getMatch(request.params.fingerprint)
      if (!existing || existing.media_type !== request.body.mediaType)
        throw Object.assign(new Error('Correspondance inconnue ou incohérente'), {
          statusCode: 409,
          code: 'CONFLICT',
        })
      const metadata = await provider.getDetails(
        request.body.mediaType,
        request.body.providerId,
        new AbortController().signal,
      )
      if (
        !repository.saveManualMatch(
          request.params.fingerprint,
          metadata,
          existing.normalized_title,
          existing.release_year,
        )
      )
        throw Object.assign(new Error('Correspondance inconnue'), {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      return reply.send({
        fingerprint: request.params.fingerprint,
        match: { mediaType: metadata.mediaType, providerId: metadata.providerId, manual: true },
      })
    },
  )

  app.delete<{ Params: { fingerprint: string } }>(
    '/api/v1/matches/:fingerprint',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: {
          type: 'object',
          required: ['fingerprint'],
          properties: { fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
        },
      },
    },
    async (request, reply) => {
      requireAdmin(request, dependencies.adminToken)
      if (!repository.clearManualMatch(request.params.fingerprint))
        throw Object.assign(new Error('Correspondance manuelle introuvable'), {
          statusCode: 404,
          code: 'NOT_FOUND',
        })
      return reply.code(204).send()
    },
  )

  return app
}

async function enrich(
  programme: ProgrammeInput,
  mediaType: MediaType,
  programmeKind: 'movie' | 'tv_movie' | 'tv_series',
  key: string,
  dependencies: Dependencies,
) {
  const { repository, provider, providerConfigured } = dependencies
  const cacheEnabled = dependencies.cacheEnabled ?? true
  const episodeKey = mediaType === 'tv' ? episodeFingerprint(key, programme) : key
  const seriesMatch = cacheEnabled ? repository.getMatch(key) : undefined
  const existing =
    seriesMatch?.status === 'matched' || episodeKey === key
      ? seriesMatch
      : cacheEnabled
        ? repository.getMatch(episodeKey)
        : undefined
  const now = Date.now()
  const alternatives = alternativesFromRow(existing?.candidates_json ?? null)
  const cachedEvidence = evidenceFromRow(existing?.evidence_json ?? null)
  const existingMetadata =
    existing?.provider_id !== null && existing?.provider_id !== undefined
      ? repository.getMedia(existing.media_type, existing.provider_id)
      : undefined
  const existingIsFresh =
    !!existing &&
    (existing.manual_override === 1
      ? !!existingMetadata && Date.parse(existingMetadata.expiresAt) > now
      : Date.parse(existing.expires_at) > now &&
        (existing.status !== 'matched' ||
          (!!existingMetadata && Date.parse(existingMetadata.expiresAt) > now)))

  if (existingIsFresh && existing) {
    if (existing.status === 'matched' && existingMetadata) {
      const episodeProgramme =
        cachedEvidence?.matchedSeason !== undefined &&
        cachedEvidence.matchedSeason !== null &&
        cachedEvidence.matchedEpisode !== undefined &&
        cachedEvidence.matchedEpisode !== null
          ? {
              ...programme,
              season: cachedEvidence.matchedSeason,
              episode: cachedEvidence.matchedEpisode,
            }
          : programme
      const metadata = await withEpisode(
        existingMetadata.metadata,
        episodeProgramme,
        repository,
        provider,
        false,
        undefined,
        undefined,
        cacheEnabled,
      )
      return response(
        'matched',
        metadata,
        alternatives,
        { source: 'cached', expiresAt: existingMetadata.expiresAt },
        existing.manual_override === 1,
        existing.method,
        existing.score ?? undefined,
        cachedEvidence,
      )
    }
    return response(
      existing.status,
      null,
      alternatives,
      {
        source: 'cached',
        expiresAt: existing.expires_at,
      },
      false,
      undefined,
      undefined,
      cachedEvidence,
    )
  }

  const staleMetadata = existingMetadata?.metadata
  if (!providerConfigured) {
    if (staleMetadata)
      return response(
        'matched',
        applyEpisode(staleMetadata, undefined, programme.season, programme.episode),
        alternatives,
        { source: 'stale', expiresAt: existingMetadata?.expiresAt ?? null },
        existing?.manual_override === 1,
        existing?.method,
        existing?.score ?? undefined,
        cachedEvidence,
      )
    throw Object.assign(new Error('Fournisseur de métadonnées non configuré'), {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Délai de recherche dépassé')), 6_000)
  try {
    if (existing?.manual_override === 1 && existing.provider_id) {
      const metadata = await provider.getDetails(
        existing.media_type,
        existing.provider_id,
        controller.signal,
      )
      const expiresAt = new Date(
        Date.now() + (metadata.mediaType === 'movie' ? 30 : 7) * 86400000,
      ).toISOString()
      if (cacheEnabled) repository.saveMedia(metadata, expiresAt)
      const updated = await withEpisode(
        metadata,
        programme,
        repository,
        provider,
        true,
        expiresAt,
        undefined,
        cacheEnabled,
      )
      return response('matched', updated, [], { source: 'fresh', expiresAt }, true)
    }

    const { candidates, images } = await provider.searchCandidates(
      programme,
      mediaType,
      controller.signal,
    )
    const episodeLookup =
      mediaType === 'tv' && programme.season !== null && programme.episode !== null
    const shortlist = rankCandidates(programme, candidates).slice(0, episodeLookup ? 3 : 5)
    const detailed = await Promise.all(
      shortlist.map(
        async (
          candidate,
        ): Promise<{
          candidate: SearchCandidate
          metadata?: MediaMetadata
          episode?: EpisodePayload | null
          episodeSeason?: number | null
          episodeNumber?: number | null
          evidence?: MatchEvidence
        }> => {
          let metadata: MediaMetadata
          try {
            metadata = await provider.getDetails(
              candidate.mediaType,
              candidate.providerId,
              controller.signal,
            )
          } catch (error) {
            if (controller.signal.aborted) throw error
            return { candidate }
          }
          if (cacheEnabled && candidate.mediaType === 'tv')
            repository.saveMedia(metadata, new Date(Date.now() + 7 * 86400000).toISOString())
          const episodeMatch =
            candidate.mediaType === 'tv' &&
            programmeKind !== 'tv_movie' &&
            programme.season !== null &&
            programme.episode !== null
              ? await findEpisodeEvidence(
                  candidate.providerId,
                  programme,
                  repository,
                  provider,
                  controller.signal,
                  cacheEnabled,
                  [candidate.title, candidate.originalTitle].some(
                    (title) => normalizeTitle(title) === normalizeTitle(programme.title),
                  ),
                  parseReleaseYear(programme.year) !== null && candidate.year !== null
                    ? Math.abs(parseReleaseYear(programme.year)! - candidate.year) <= 1
                    : null,
                )
              : undefined
          return {
            candidate: {
              ...candidate,
              runtimeMinutes: metadata.runtimeMinutes,
              genres: metadata.genres,
              overview: metadata.overview,
              creditedPeople: [
                ...metadata.directors.map((person) => person.name),
                ...metadata.creators.map((person) => person.name),
                ...metadata.cast.map((person) => person.name),
              ],
              networks: metadata.networks ?? [],
              seasonYears: metadata.seasonYears ?? [],
            },
            metadata,
            episode: episodeMatch?.payload,
            episodeSeason: episodeMatch?.season,
            episodeNumber: episodeMatch?.episode,
            evidence: episodeMatch?.evidence,
          }
        },
      ),
    )
    const detailedCandidates = detailed.map(({ candidate }) => candidate)
    const scored = rankCandidates(programme, detailedCandidates)
    const tvMovieRanked =
      programmeKind === 'tv_movie' ? rankTvMovieCandidates(programme, detailedCandidates) : []
    let chosen =
      programmeKind === 'tv_movie'
        ? chooseTvMovieCandidate(tvMovieRanked)
        : chooseCandidate(programme, scored)
    let matchMethod: MatchMethod = mediaType === 'tv' ? 'series_only' : 'title'
    let matchConfidence = chosen.status === 'matched' ? chosen.candidate.confidence : undefined
    let matchEvidence: MatchEvidence | undefined
    if (mediaType === 'tv') {
      const evidenceRanked = scored
        .map((candidate) => {
          const details = detailed.find(
            ({ candidate: item }) => item.providerId === candidate.providerId,
          )
          const scoredEvidence = scoreEpisodeEvidence(programme, details?.episode ?? null, {
            titleExact: [candidate.title, candidate.originalTitle].some(
              (title) => normalizeTitle(title) === normalizeTitle(programme.title),
            ),
            yearMatch:
              parseReleaseYear(programme.year) !== null && candidate.year !== null
                ? Math.abs(parseReleaseYear(programme.year)! - candidate.year) <= 1
                : null,
            season: details?.episodeSeason ?? null,
            episodeNumber: details?.episodeNumber ?? null,
          })
          return {
            candidate,
            episode: details?.episode ?? null,
            evidence: scoredEvidence.evidence,
            score: scoredEvidence.score,
            confirmed: scoredEvidence.confirmed,
            contradictory: scoredEvidence.contradictory,
          }
        })
        .filter(({ confirmed, contradictory }) => confirmed && !contradictory)
        .sort(
          (left, right) =>
            right.candidate.confidence + right.score - (left.candidate.confidence + left.score),
        )
      const [bestEvidence, secondEvidence] = evidenceRanked
      const evidenceMargin = bestEvidence
        ? secondEvidence
          ? bestEvidence.candidate.confidence +
            bestEvidence.score -
            secondEvidence.candidate.confidence -
            secondEvidence.score
          : 100
        : 0
      if (bestEvidence && (!secondEvidence || evidenceMargin >= 10)) {
        chosen = { status: 'matched', candidate: bestEvidence.candidate }
        matchMethod = 'title_and_episode'
        matchEvidence = bestEvidence.evidence
        matchConfidence = Math.min(100, bestEvidence.candidate.confidence + bestEvidence.score)
      }

      const wantedTitle = normalizeTitle(programme.title)
      const homonyms = scored.filter(
        (candidate) =>
          candidate.confidence >= 70 &&
          [candidate.title, candidate.originalTitle].some(
            (title) => normalizeTitle(title) === wantedTitle,
          ),
      )
      if (homonyms.length > 1) {
        const independent = homonyms.filter((candidate) => {
          const details = detailed.find(
            ({ candidate: item }) => item.providerId === candidate.providerId,
          )
          const evidence = details?.evidence
          const actors = programme.actors.map(normalizeTitle)
          const castMatches = actors.filter((actor) =>
            candidate.creditedPeople.some((credit) => normalizeTitle(credit) === actor),
          ).length
          return evidence?.seriesYearMatch === true || castMatches >= 2
        })
        if (bestEvidence && (!secondEvidence || evidenceMargin >= 10)) {
          matchEvidence = bestEvidence.evidence
        } else if (independent.length === 1) {
          chosen = { status: 'matched', candidate: independent[0] }
          matchMethod = 'series_only'
          matchConfidence = independent[0].confidence
          matchEvidence = detailed.find(
            ({ candidate }) => candidate.providerId === independent[0].providerId,
          )?.evidence
        } else {
          chosen = { status: 'ambiguous' }
          matchEvidence =
            evidenceRanked[0]?.evidence ??
            scoreEpisodeEvidence(programme, null, {
              titleExact: true,
              yearMatch: null,
              season: null,
              episodeNumber: null,
            }).evidence
        }
      } else if (chosen.status === 'matched' && !matchEvidence) {
        const selectedCandidate = chosen.candidate
        const selectedDetails = detailed.find(
          ({ candidate }) => candidate.providerId === selectedCandidate.providerId,
        )
        matchEvidence =
          selectedDetails?.evidence ??
          scoreEpisodeEvidence(programme, null, {
            titleExact: [selectedCandidate.title, selectedCandidate.originalTitle].some(
              (title) => normalizeTitle(title) === wantedTitle,
            ),
            yearMatch:
              parseReleaseYear(programme.year) !== null && selectedCandidate.year !== null
                ? Math.abs(parseReleaseYear(programme.year)! - selectedCandidate.year) <= 1
                : null,
            season: null,
            episodeNumber: null,
          }).evidence
      }
    }
    const suggestionList = (
      programmeKind === 'tv_movie'
        ? tvMovieRanked.map((candidate) =>
            provider.alternative(candidate, images, candidate.confidence),
          )
        : scored.map((candidate) => {
            const details = detailed.find(
              ({ candidate: item }) => item.providerId === candidate.providerId,
            )?.metadata
            return {
              ...provider.alternative(candidate, images, candidate.confidence),
              overview: details?.overview ?? candidate.overview ?? null,
              genres: details?.genres ?? candidate.genres,
              date: details?.releaseDate ?? details?.firstAirDate ?? null,
            }
          })
    ).filter((candidate) => candidate.confidence >= 60)
    if (chosen.status !== 'matched') {
      const ttl = chosen.status === 'ambiguous' ? 7 : 7
      const resultMediaType = detailedCandidates[0]?.mediaType ?? mediaType
      const expiresAt = cacheEnabled
        ? repository.saveMatch(
            episodeKey,
            programme,
            resultMediaType,
            chosen.status,
            null,
            suggestionList[0]?.confidence ?? null,
            suggestionList,
            ttl,
            matchMethod,
            programmeKind,
            matchEvidence ?? null,
          )
        : null
      return response(
        chosen.status,
        null,
        suggestionList,
        { source: 'fresh', expiresAt },
        false,
        undefined,
        undefined,
        matchEvidence,
      )
    }
    const selected = chosen.candidate
    const selectedDetails = detailed.find(
      ({ candidate }) => candidate.providerId === selected.providerId,
    )?.metadata
    if (!selectedDetails)
      throw new ProviderError('Détails TMDB momentanément indisponibles', 'PROVIDER_ERROR', 502)
    const year = parseReleaseYear(programme.year)
    if (
      programmeKind !== 'tv_movie' &&
      year !== null &&
      selected.year !== null &&
      Math.abs(year - selected.year) > 1
    ) {
      const expiresAt = cacheEnabled
        ? repository.saveMatch(
            episodeKey,
            programme,
            selected.mediaType,
            'ambiguous',
            null,
            selected.confidence,
            suggestionList,
            7,
            'title',
            programmeKind,
            matchEvidence ?? null,
          )
        : null
      return response('ambiguous', null, suggestionList, { source: 'fresh', expiresAt })
    }
    const expiresAt = new Date(
      Date.now() + (selected.mediaType === 'movie' ? 30 : 7) * 86400000,
    ).toISOString()
    if (cacheEnabled) repository.saveMedia(selectedDetails, expiresAt)
    const savedExpiresAt = cacheEnabled
      ? repository.saveMatch(
          key,
          programme,
          selected.mediaType,
          'matched',
          selected.providerId,
          matchConfidence ?? selected.confidence,
          suggestionList,
          selected.mediaType === 'movie' ? 30 : 7,
          matchMethod,
          programmeKind,
          matchEvidence ?? null,
        )
      : null
    const selectedEpisode = detailed.find(
      ({ candidate }) => candidate.providerId === selected.providerId,
    )
    const episodeProgramme =
      selectedEpisode?.episodeSeason !== undefined &&
      selectedEpisode.episodeSeason !== null &&
      selectedEpisode.episodeNumber !== undefined &&
      selectedEpisode.episodeNumber !== null
        ? {
            ...programme,
            season: selectedEpisode.episodeSeason,
            episode: selectedEpisode.episodeNumber,
          }
        : programme
    const metadata = await withEpisode(
      selectedDetails,
      episodeProgramme,
      repository,
      provider,
      selectedEpisode === undefined,
      expiresAt,
      controller.signal,
      cacheEnabled,
      selectedEpisode?.episode,
    )
    return response(
      'matched',
      metadata,
      suggestionList,
      {
        source: 'fresh',
        expiresAt: savedExpiresAt,
      },
      false,
      matchMethod,
      matchConfidence,
      matchEvidence,
    )
  } catch (error) {
    if (staleMetadata)
      return response(
        'matched',
        applyEpisode(staleMetadata, undefined, programme.season, programme.episode),
        alternatives,
        { source: 'stale', expiresAt: existingMetadata?.expiresAt ?? null },
        existing?.manual_override === 1,
      )
    if (error instanceof ProviderError)
      throw Object.assign(error, { statusCode: error.statusCode, code: error.code })
    if (controller.signal.aborted)
      throw Object.assign(new Error('Délai de recherche dépassé'), {
        statusCode: 504,
        code: 'PROVIDER_TIMEOUT',
      })
    throw Object.assign(error instanceof Error ? error : new Error('Erreur fournisseur'), {
      statusCode: 502,
      code: 'PROVIDER_ERROR',
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function withEpisode(
  metadata: MediaMetadata,
  programme: ProgrammeInput,
  repository: MediaRepository,
  provider: TmdbProvider,
  allowFetch: boolean,
  mediaExpiresAt?: string,
  signal = new AbortController().signal,
  cacheEnabled = true,
  preloadedEpisode?: EpisodePayload | null,
) {
  if (metadata.mediaType !== 'tv' || programme.season === null || programme.episode === null)
    return metadata
  if (preloadedEpisode !== undefined)
    return applyEpisode(
      metadata,
      preloadedEpisode ?? undefined,
      programme.season,
      programme.episode,
    )
  const cached = cacheEnabled
    ? repository.getEpisode(metadata.providerId, programme.season, programme.episode)
    : undefined
  if (cached && Date.parse(cached.expiresAt) > Date.now())
    return repository.saveEpisodeInMedia(
      metadata,
      cached.payload,
      programme.season,
      programme.episode,
    )
  if (!allowFetch) return applyEpisode(metadata, undefined, programme.season, programme.episode)
  try {
    const episode = await provider.getEpisode(
      metadata.providerId,
      programme.season,
      programme.episode,
      signal,
    )
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString()
    if (cacheEnabled)
      repository.saveEpisode(
        metadata.providerId,
        programme.season,
        programme.episode,
        episode,
        expiresAt,
      )
    return repository.saveEpisodeInMedia(metadata, episode, programme.season, programme.episode)
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      const emptyEpisode: EpisodePayload = {
        name: null,
        originalName: null,
        overview: null,
        originalOverview: null,
        airDate: null,
        guestCast: [],
      }
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString()
      if (cacheEnabled)
        repository.saveEpisode(
          metadata.providerId,
          programme.season,
          programme.episode,
          emptyEpisode,
          expiresAt,
        )
      return repository.saveEpisodeInMedia(
        metadata,
        emptyEpisode,
        programme.season,
        programme.episode,
      )
    }
    return applyEpisode(metadata, undefined, programme.season, programme.episode)
  }
}

async function getEpisodePayload(
  seriesId: number,
  programme: ProgrammeInput,
  repository: MediaRepository,
  provider: TmdbProvider,
  signal: AbortSignal,
  cacheEnabled: boolean,
): Promise<EpisodePayload | null> {
  const season = programme.season
  const episodeNumber = programme.episode
  if (season === null || episodeNumber === null) return null
  const cached = cacheEnabled ? repository.getEpisode(seriesId, season, episodeNumber) : undefined
  if (cached && Date.parse(cached.expiresAt) > Date.now()) {
    const payload = cached.payload
    return payload.name ||
      payload.originalName ||
      payload.overview ||
      payload.originalOverview ||
      payload.airDate
      ? payload
      : null
  }
  try {
    const payload = await provider.getEpisode(
      seriesId,
      season,
      episodeNumber,
      signal,
      programme.subtitle,
    )
    if (cacheEnabled)
      repository.saveEpisode(
        seriesId,
        season,
        episodeNumber,
        payload,
        new Date(Date.now() + 14 * 86400000).toISOString(),
      )
    return payload.name ||
      payload.originalName ||
      payload.overview ||
      payload.originalOverview ||
      payload.airDate
      ? payload
      : null
  } catch (error) {
    if (!(error instanceof ProviderError) || error.code !== 'NOT_FOUND') throw error
    const emptyEpisode: EpisodePayload = {
      name: null,
      originalName: null,
      overview: null,
      originalOverview: null,
      airDate: null,
      guestCast: [],
    }
    if (cacheEnabled)
      repository.saveEpisode(
        seriesId,
        season,
        episodeNumber,
        emptyEpisode,
        new Date(Date.now() + 14 * 86400000).toISOString(),
      )
    return null
  }
}

async function findEpisodeEvidence(
  seriesId: number,
  programme: ProgrammeInput,
  repository: MediaRepository,
  provider: TmdbProvider,
  signal: AbortSignal,
  cacheEnabled: boolean,
  titleExact: boolean,
  yearMatch: boolean | null,
) {
  const season = programme.season
  const requestedEpisode = programme.episode
  if (season === null || requestedEpisode === null) return null
  let exact: {
    payload: EpisodePayload | null
    season: number
    episode: number
    evidence: MatchEvidence
  } | null = null

  for (const offset of [0, -1, 1]) {
    const episodeNumber = requestedEpisode + offset
    if (episodeNumber < 1) continue
    const payload = await getEpisodePayload(
      seriesId,
      { ...programme, episode: episodeNumber },
      repository,
      provider,
      signal,
      cacheEnabled,
    )
    const scored = scoreEpisodeEvidence(programme, payload, {
      titleExact,
      yearMatch,
      season: payload ? season : null,
      episodeNumber: payload ? episodeNumber : null,
    })
    const result = {
      payload,
      season,
      episode: episodeNumber,
      evidence: scored.evidence,
    }
    if (offset === 0) exact = result
    if (scored.confirmed && !scored.contradictory) return result
  }
  return exact
}

export function publicAlternative(candidate: MatchAlternative) {
  return {
    providerId: candidate.providerId,
    mediaType: candidate.mediaType,
    title: candidate.title,
    year: candidate.year,
    posterUrl: candidate.posterUrl,
    confidence: candidate.confidence,
  }
}
