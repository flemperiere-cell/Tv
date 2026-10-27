import type {
  MediaCastMember,
  MediaMetadata,
  MediaPerson,
  MediaType,
  MatchAlternative,
} from '../../../src/models/media.js'
import { classifyProgramme, type ProgrammeInput } from '../domain/classify.js'
import type { SearchCandidate } from '../domain/match.js'
import { normalizeTitle } from '../domain/normalize.js'

interface TmdbRecord {
  [key: string]: unknown
}

interface TmdbImageConfiguration {
  baseUrl: string
  posterSize: string
  backdropSize: string
  profileSize: string
}

export interface TmdbRequestTrace {
  phase: 'request' | 'response' | 'error'
  method: 'GET'
  url: string
  body: null
  attempt: number
  status?: number
  error?: string
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'NOT_FOUND',
    readonly statusCode: number,
  ) {
    super(message)
  }
}

class RequestLimiter {
  private active = 0
  private waiting: Array<() => void> = []

  async run<T>(operation: () => Promise<T>, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason
    const queued = this.active >= 3
    if (queued) {
      if (this.waiting.length >= 30)
        throw new ProviderError('File fournisseur saturée', 'SERVICE_UNAVAILABLE', 503)
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          this.waiting = this.waiting.filter((callback) => callback !== resume)
          reject(signal.reason)
        }
        this.waiting.push(resume)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    if (!queued) this.active += 1
    try {
      return await operation()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}

const limiter = new RequestLimiter()

const record = (value: unknown): TmdbRecord =>
  value && typeof value === 'object' ? (value as TmdbRecord) : {}
const string = (value: unknown) => (typeof value === 'string' && value ? value : null)
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const records = (value: unknown) => (Array.isArray(value) ? value.map(record) : [])

function chooseSize(available: unknown, preferred: string, fallback: string) {
  if (!Array.isArray(available)) return fallback
  return available.includes(preferred) ? preferred : available.at(-1) || fallback
}

export class TmdbProvider {
  private imageConfiguration?: Promise<TmdbImageConfiguration | null>
  private readonly language: string
  private traceLogger?: (trace: TmdbRequestTrace) => void

  constructor(
    private readonly token: string,
    language = 'fr-FR',
  ) {
    this.language = /^[a-z]{2}-[A-Z]{2}$/.test(language) ? language : 'fr-FR'
  }

  setTraceLogger(logger?: (trace: TmdbRequestTrace) => void) {
    this.traceLogger = logger
  }

  async search(query: string, mediaType: MediaType, year: number | null, signal: AbortSignal) {
    const url = new URL(`https://api.themoviedb.org/3/search/${mediaType}`)
    url.searchParams.set('query', query)
    url.searchParams.set('language', this.language)
    url.searchParams.set('include_adult', 'false')
    if (year !== null)
      url.searchParams.set(mediaType === 'movie' ? 'year' : 'first_air_date_year', String(year))
    const response = await this.request(url, signal)
    return records(record(response).results).slice(0, 10)
  }

  async getDetails(mediaType: MediaType, providerId: number, signal: AbortSignal) {
    const append = mediaType === 'movie' ? 'credits' : 'aggregate_credits,credits'
    const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${providerId}`)
    url.searchParams.set('append_to_response', append)
    url.searchParams.set('language', this.language)
    const [raw, images] = await Promise.all([
      this.request(url, signal).then(record),
      this.loadImageConfiguration(signal),
    ])
    if (!string(raw.overview) || !(string(raw.title) || string(raw.name))) {
      const fallbackUrl = new URL(url)
      fallbackUrl.searchParams.set('language', 'en-US')
      const fallback = record(await this.request(fallbackUrl, signal))
      raw.overview ||= fallback.overview
      raw.title ||= fallback.title
      raw.name ||= fallback.name
    }
    return this.mapMetadata(mediaType, raw, images)
  }

  async getEpisode(
    seriesId: number,
    season: number,
    episode: number,
    signal: AbortSignal,
    expectedTitle?: string | null,
  ) {
    const url = new URL(
      `https://api.themoviedb.org/3/tv/${seriesId}/season/${season}/episode/${episode}`,
    )
    url.searchParams.set('append_to_response', 'credits')
    url.searchParams.set('language', this.language)
    const [raw, images] = await Promise.all([
      this.request(url, signal).then(record),
      this.loadImageConfiguration(signal),
    ])
    let originalName: string | null = null
    let originalOverview: string | null = null
    if (
      expectedTitle ||
      !string(raw.overview) ||
      !string(raw.name) ||
      (expectedTitle && normalizeTitle(string(raw.name) ?? '') !== normalizeTitle(expectedTitle))
    ) {
      const fallbackUrl = new URL(url)
      fallbackUrl.searchParams.set('language', 'en-US')
      let fallback: TmdbRecord = {}
      try {
        fallback = record(await this.request(fallbackUrl, signal))
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== 'NOT_FOUND') throw error
      }
      originalName = string(fallback.name)
      originalOverview = string(fallback.overview)
      raw.overview ||= fallback.overview
      raw.name ||= fallback.name
    }
    return {
      name: string(raw.name),
      originalName,
      overview: string(raw.overview),
      originalOverview,
      airDate: string(raw.air_date),
      guestCast: records(record(raw.credits).guest_stars)
        .map((person, order) => this.mapCast(person, order, images))
        .filter((person) => person.name),
    }
  }

  async searchCandidates(programme: ProgrammeInput, mediaType: MediaType, signal: AbortSignal) {
    const yearText = programme.year?.trim().slice(0, 4)
    const classification = classifyProgramme(programme)
    const isTvMovie =
      classification.status === 'classified' && classification.programmeKind === 'tv_movie'
    const year = isTvMovie ? null : yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null
    const [, first] = await Promise.all([
      this.loadImageConfiguration(signal),
      this.search(programme.title, mediaType, year, signal),
    ])
    let resultMediaType = mediaType
    let found = first
    if (isTvMovie && mediaType === 'movie' && first.length === 0) {
      found = await this.search(programme.title, 'tv', null, signal)
      resultMediaType = 'tv'
    }
    const wanted = normalizeTitle(programme.title)
    const hasGoodProposal = found.some((item) =>
      [item.title, item.name, item.original_title, item.original_name]
        .filter((title): title is string => typeof title === 'string')
        .some((title) => normalizeTitle(title) === wanted),
    )
    if (
      !hasGoodProposal &&
      programme.subtitle &&
      programme.subtitle.trim().length >= 2 &&
      programme.subtitle.trim().toLocaleLowerCase('fr-FR') !==
        programme.title.toLocaleLowerCase('fr-FR')
    ) {
      const subtitleResults = await this.search(programme.subtitle, resultMediaType, year, signal)
      const byId = new Map<number, TmdbRecord>()
      for (const item of [...found, ...subtitleResults]) {
        const id = number(item.id)
        if (id !== null) byId.set(id, item)
      }
      found = [...byId.values()]
    }

    const images = found.length ? await this.loadImageConfiguration(signal) : null
    const candidates: SearchCandidate[] = found
      .map((item) => {
        const release = string(item.release_date) || string(item.first_air_date)
        return {
          providerId: number(item.id) ?? 0,
          mediaType: resultMediaType,
          title: string(item.title) || string(item.name) || programme.title,
          originalTitle: string(item.original_title) || string(item.original_name) || '',
          year: release && /^\d{4}/.test(release) ? Number(release.slice(0, 4)) : null,
          posterPath: string(item.poster_path),
          popularity: number(item.popularity) ?? 0,
          runtimeMinutes: null,
          genres: [],
          creditedPeople: [],
        }
      })
      .filter((candidate) => candidate.providerId > 0)
    return { candidates, images, searchItems: found }
  }

  alternative(
    candidate: SearchCandidate,
    images: TmdbImageConfiguration | null,
    confidence: number,
  ): MatchAlternative {
    return {
      providerId: candidate.providerId,
      mediaType: candidate.mediaType,
      title: candidate.title,
      year: candidate.year,
      posterUrl: imageUrl(images, candidate.posterPath, 'poster'),
      confidence,
    }
  }

  private async getImageConfiguration(signal: AbortSignal) {
    if (!this.imageConfiguration) {
      this.imageConfiguration = this.request(
        new URL('https://api.themoviedb.org/3/configuration'),
        signal,
      )
        .then((response) => {
          const images = record(record(response).images)
          const baseUrl = string(images.secure_base_url)
          if (!baseUrl) return null
          try {
            if (new URL(baseUrl).hostname !== 'image.tmdb.org') return null
          } catch {
            return null
          }
          return {
            baseUrl,
            posterSize: chooseSize(images.poster_sizes, 'w500', 'original'),
            backdropSize: chooseSize(images.backdrop_sizes, 'w780', 'original'),
            profileSize: chooseSize(images.profile_sizes, 'w185', 'original'),
          }
        })
        .catch((error: unknown) => {
          this.imageConfiguration = undefined
          throw error
        })
    }
    return this.imageConfiguration
  }

  private async loadImageConfiguration(signal: AbortSignal) {
    try {
      return await this.getImageConfiguration(signal)
    } catch (error) {
      if (signal.aborted) throw error
      return null
    }
  }

  private mapMetadata(
    mediaType: MediaType,
    raw: TmdbRecord,
    images: TmdbImageConfiguration | null,
  ): MediaMetadata {
    const providerId = number(raw.id)
    if (!providerId) throw new ProviderError('Réponse TMDB invalide', 'PROVIDER_ERROR', 502)
    const credits = record(raw.credits)
    const aggregateCredits = record(raw.aggregate_credits)
    const crew = records(credits.crew).length
      ? records(credits.crew)
      : records(aggregateCredits.crew)
    const aggregateCast = records(aggregateCredits.cast)
    const cast =
      mediaType === 'tv' && aggregateCast.length
        ? aggregateCast
        : records(credits.cast).length
          ? records(credits.cast)
          : aggregateCast
    const dates = string(raw.release_date) || string(raw.first_air_date)
    const directorJobs = mediaType === 'movie' ? new Set(['Director']) : new Set(['Creator'])
    const directors: MediaPerson[] = crew
      .filter((person) => directorJobs.has(String(person.job || person.known_for_department || '')))
      .slice(0, 10)
      .map((person) => ({ providerId: number(person.id), name: string(person.name) || '' }))
      .filter((person) => person.name)
    const creators: MediaPerson[] = records(raw.created_by)
      .slice(0, 10)
      .map((person) => ({ providerId: number(person.id), name: string(person.name) || '' }))
      .filter((person) => person.name)
    const countries =
      mediaType === 'movie'
        ? records(raw.production_countries)
            .map((country) => string(country.name))
            .filter((name): name is string => !!name)
        : records(raw.origin_country)
            .map((country) => string(country.iso_3166_1))
            .filter((name): name is string => !!name)
    return {
      mediaType,
      providerId,
      title: string(raw.title) || string(raw.name) || '',
      originalTitle: string(raw.original_title) || string(raw.original_name) || '',
      releaseDate: mediaType === 'movie' ? string(raw.release_date) : null,
      firstAirDate: mediaType === 'tv' ? string(raw.first_air_date) : null,
      year: dates && /^\d{4}/.test(dates) ? Number(dates.slice(0, 4)) : null,
      voteAverage: number(raw.vote_average),
      voteCount: number(raw.vote_count),
      overview: string(raw.overview),
      genres: records(raw.genres)
        .map((genre) => string(genre.name))
        .filter((name): name is string => !!name),
      countries,
      runtimeMinutes:
        number(raw.runtime) ??
        (Array.isArray(raw.episode_run_time) ? number(raw.episode_run_time[0]) : null),
      posterUrl: imageUrl(images, string(raw.poster_path), 'poster'),
      backdropUrl: imageUrl(images, string(raw.backdrop_path), 'backdrop'),
      directors,
      creators,
      cast: cast
        .slice(0, 20)
        .map((person, order) => this.mapCast(person, number(person.order) ?? order, images))
        .filter((person) => person.name),
      season: null,
      episode: null,
      episodeTitle: null,
      episodeOriginalTitle: null,
      episodeOverview: null,
      episodeAirDate: null,
      guestCast: [],
      tmdbUrl: `https://www.themoviedb.org/${mediaType}/${providerId}`,
    }
  }

  private mapCast(
    person: TmdbRecord,
    order: number,
    images: TmdbImageConfiguration | null,
  ): MediaCastMember {
    const character =
      string(person.character) ||
      records(person.roles)
        .map((role) => string(role.character))
        .filter((role): role is string => !!role)
        .join(', ') ||
      null
    return {
      providerId: number(person.id),
      name: string(person.name) || '',
      character,
      order,
      profileUrl: imageUrl(images, string(person.profile_path), 'profile'),
    }
  }

  private async request(url: URL, signal: AbortSignal) {
    const deadline = Date.now() + 6_000
    return limiter.run(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new ProviderError('Délai TMDB dépassé', 'PROVIDER_TIMEOUT', 504)
        let response: Response
        this.traceLogger?.({
          phase: 'request',
          method: 'GET',
          url: url.toString(),
          body: null,
          attempt: attempt + 1,
        })
        try {
          response = await fetch(url, {
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
            signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(4_000, remaining))]),
          })
        } catch (error) {
          this.traceLogger?.({
            phase: 'error',
            method: 'GET',
            url: url.toString(),
            body: null,
            attempt: attempt + 1,
            error: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
          })
          if (signal.aborted) throw signal.reason
          throw new ProviderError(
            error instanceof Error && error.name === 'TimeoutError'
              ? 'Délai TMDB dépassé'
              : 'Fournisseur TMDB indisponible',
            error instanceof Error && error.name === 'TimeoutError'
              ? 'PROVIDER_TIMEOUT'
              : 'PROVIDER_ERROR',
            error instanceof Error && error.name === 'TimeoutError' ? 504 : 502,
          )
        }
        this.traceLogger?.({
          phase: 'response',
          method: 'GET',
          url: url.toString(),
          body: null,
          attempt: attempt + 1,
          status: response.status,
        })
        if (response.ok) return response.json() as Promise<unknown>
        if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
          const retryHeader = response.headers.get('retry-after')
          const retrySeconds = retryHeader ? Number(retryHeader) : NaN
          const retryDate = retryHeader ? Date.parse(retryHeader) : NaN
          const delay = Number.isFinite(retrySeconds)
            ? Math.max(0, retrySeconds * 1000)
            : Number.isFinite(retryDate)
              ? Math.max(0, retryDate - Date.now())
              : 250
          if (delay >= deadline - Date.now())
            throw new ProviderError('Délai TMDB dépassé', 'PROVIDER_TIMEOUT', 504)
          if (delay < deadline - Date.now()) {
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer)
                reject(signal.reason)
              }
              const timer = setTimeout(() => {
                signal.removeEventListener('abort', abort)
                resolve()
              }, delay)
              if (signal.aborted) abort()
              else signal.addEventListener('abort', abort, { once: true })
            })
            continue
          }
        }
        throw new ProviderError(
          response.status === 404
            ? 'Ressource TMDB introuvable'
            : response.status === 401
              ? 'Authentification TMDB refusée'
              : 'Erreur de réponse TMDB',
          response.status === 404 ? 'NOT_FOUND' : 'PROVIDER_ERROR',
          response.status === 404 ? 404 : 502,
        )
      }
      throw new ProviderError('Fournisseur TMDB indisponible', 'PROVIDER_ERROR', 502)
    }, signal)
  }
}

function imageUrl(
  configuration: TmdbImageConfiguration | null,
  path: string | null,
  type: 'poster' | 'backdrop' | 'profile',
) {
  if (!configuration || !path || !path.startsWith('/') || path.startsWith('//')) return null
  const size =
    type === 'poster'
      ? configuration.posterSize
      : type === 'backdrop'
        ? configuration.backdropSize
        : configuration.profileSize
  return `${configuration.baseUrl}${size}${path}`
}
