import type { TVProgramme } from '../../models/tv'
import type { MatchAlternative, MatchResponse, MediaMetadata, MediaType } from '../../models/media'

const apiBase = './api/v1'
const pendingRequests = new Map<
  string,
  {
    controller: AbortController
    promise: Promise<MatchResponse>
    consumers: number
    settled: boolean
  }
>()

function endpoint(path: string) {
  const appRoot = new URL('.', window.location.href)
  const url = new URL(`${apiBase.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, appRoot)
  if (url.origin !== window.location.origin) throw new Error('L’API doit être sur la même origine')
  return url
}

function isMediaType(value: unknown): value is MediaType {
  return value === 'movie' || value === 'tv'
}

function nullableString(value: unknown) {
  return value === null || typeof value === 'string'
}

function isMediaPerson(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const person = value as Record<string, unknown>
  return (
    (person.providerId === null || Number.isSafeInteger(person.providerId)) &&
    typeof person.name === 'string'
  )
}

function isCastMember(value: unknown) {
  if (!isMediaPerson(value)) return false
  const person = value as Record<string, unknown>
  return (
    nullableString(person.character) &&
    Number.isInteger(person.order) &&
    nullableString(person.profileUrl)
  )
}

function isMediaMetadata(value: unknown): value is MediaMetadata {
  if (!value || typeof value !== 'object') return false
  const metadata = value as Record<string, unknown>
  return (
    isMediaType(metadata.mediaType) &&
    Number.isSafeInteger(metadata.providerId) &&
    typeof metadata.title === 'string' &&
    typeof metadata.originalTitle === 'string' &&
    (metadata.year === null || typeof metadata.year === 'number') &&
    nullableString(metadata.releaseDate) &&
    nullableString(metadata.firstAirDate) &&
    nullableString(metadata.overview) &&
    Array.isArray(metadata.genres) &&
    metadata.genres.every((entry) => typeof entry === 'string') &&
    Array.isArray(metadata.countries) &&
    metadata.countries.every((entry) => typeof entry === 'string') &&
    Array.isArray(metadata.directors) &&
    metadata.directors.every(isMediaPerson) &&
    Array.isArray(metadata.creators) &&
    metadata.creators.every(isMediaPerson) &&
    Array.isArray(metadata.cast) &&
    metadata.cast.every(isCastMember) &&
    Array.isArray(metadata.guestCast) &&
    metadata.guestCast.every(isCastMember) &&
    (metadata.runtimeMinutes === null || typeof metadata.runtimeMinutes === 'number') &&
    nullableString(metadata.posterUrl) &&
    nullableString(metadata.backdropUrl) &&
    (metadata.season === null || Number.isInteger(metadata.season)) &&
    (metadata.episode === null || Number.isInteger(metadata.episode)) &&
    nullableString(metadata.episodeTitle) &&
    (metadata.episodeOriginalTitle === undefined ||
      nullableString(metadata.episodeOriginalTitle)) &&
    nullableString(metadata.episodeOverview) &&
    nullableString(metadata.episodeAirDate) &&
    typeof metadata.tmdbUrl === 'string'
  )
}

function isAlternative(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const alternative = value as Record<string, unknown>
  return (
    Number.isSafeInteger(alternative.providerId) &&
    isMediaType(alternative.mediaType) &&
    typeof alternative.title === 'string' &&
    (alternative.year === null || typeof alternative.year === 'number') &&
    (alternative.posterUrl === null || typeof alternative.posterUrl === 'string') &&
    Number.isInteger(alternative.confidence) &&
    Number(alternative.confidence) >= 0 &&
    Number(alternative.confidence) <= 100 &&
    (alternative.overview === undefined || nullableString(alternative.overview)) &&
    (alternative.genres === undefined ||
      (Array.isArray(alternative.genres) &&
        alternative.genres.every((entry) => typeof entry === 'string'))) &&
    (alternative.date === undefined || nullableString(alternative.date))
  )
}

function isMatchEvidence(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Record<string, unknown>
  const nullableBoolean = (entry: unknown) => entry === null || typeof entry === 'boolean'
  const nullableNumber = (entry: unknown) => entry === null || typeof entry === 'number'
  return (
    typeof evidence.seriesTitleExact === 'boolean' &&
    nullableBoolean(evidence.seriesYearMatch) &&
    nullableNumber(evidence.episodeTitleSimilarity) &&
    nullableNumber(evidence.episodeSynopsisSimilarity) &&
    nullableBoolean(evidence.episodeNumberMatch) &&
    nullableNumber(evidence.episodeNumberOffset) &&
    Array.isArray(evidence.contradictoryEvidence) &&
    evidence.contradictoryEvidence.every((entry) => typeof entry === 'string')
  )
}

function isMatchResponse(value: unknown): value is MatchResponse {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  const match = result.match
  const cache = result.cache
  const attribution = result.attribution
  const status = result.status
  return (
    ['matched', 'ambiguous', 'not_found', 'unsupported'].includes(String(status)) &&
    (result.metadata === null || isMediaMetadata(result.metadata)) &&
    Array.isArray(result.alternatives) &&
    result.alternatives.length <= 5 &&
    result.alternatives.every(isAlternative) &&
    (match === null ||
      (typeof match === 'object' &&
        match !== null &&
        (match as Record<string, unknown>).provider === 'tmdb' &&
        isMediaType((match as Record<string, unknown>).mediaType) &&
        Number.isSafeInteger((match as Record<string, unknown>).providerId) &&
        Number.isInteger((match as Record<string, unknown>).confidence) &&
        Number((match as Record<string, unknown>).confidence) >= 0 &&
        Number((match as Record<string, unknown>).confidence) <= 100 &&
        typeof (match as Record<string, unknown>).manual === 'boolean' &&
        ((match as Record<string, unknown>).evidence === undefined ||
          isMatchEvidence((match as Record<string, unknown>).evidence)) &&
        ['title', 'title_and_episode', 'series_only', 'manual'].includes(
          String((match as Record<string, unknown>).method),
        ))) &&
    typeof cache === 'object' &&
    cache !== null &&
    ['fresh', 'cached', 'stale'].includes(String((cache as Record<string, unknown>).source)) &&
    ((cache as Record<string, unknown>).expiresAt === null ||
      typeof (cache as Record<string, unknown>).expiresAt === 'string') &&
    typeof attribution === 'object' &&
    attribution !== null &&
    (attribution as Record<string, unknown>).provider === 'TMDB' &&
    (attribution as Record<string, unknown>).required === true &&
    (status === 'matched'
      ? match !== null && isMediaMetadata(result.metadata)
      : match === null && result.metadata === null) &&
    (result.evidence === undefined || isMatchEvidence(result.evidence))
  )
}

export async function fetchMediaDetails(
  alternative: Pick<MatchAlternative, 'mediaType' | 'providerId'>,
  signal: AbortSignal,
) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
  let response: Response
  try {
    response = await fetch(endpoint(`details/${alternative.mediaType}/${alternative.providerId}`), {
      signal: requestSignal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Délai de chargement TMDB dépassé'
        : 'Fiche TMDB momentanément indisponible',
    )
  }
  if (!response.ok) throw new Error('Fiche TMDB momentanément indisponible')
  const value: unknown = await response.json()
  if (
    !value ||
    typeof value !== 'object' ||
    !('metadata' in value) ||
    !isMediaMetadata(value.metadata)
  )
    throw new Error('Réponse TMDB invalide')
  return value.metadata
}

function programmePayload(programme: TVProgramme) {
  const rawYear = programme.year?.trim() ?? ''
  const validYear = /^\d{4}(?:\d{4}(?:\d{6})?)?(?:\s*[+-]\d{4})?$/.test(rawYear)
  const yearNumber = Number(rawYear.slice(0, 4))
  const year =
    validYear &&
    yearNumber >= 1888 &&
    yearNumber <= new Date().getFullYear() + 3 &&
    rawYear.length <= 32
      ? rawYear
      : null
  return {
    title: programme.title.trim(),
    subtitle: programme.subtitle && programme.subtitle.length <= 200 ? programme.subtitle : null,
    description:
      programme.description && programme.description.length <= 2000 ? programme.description : null,
    category: programme.categories?.join(' / ') || programme.category || null,
    year,
    durationMinutes:
      programme.durationMinutes &&
      programme.durationMinutes >= 1 &&
      programme.durationMinutes <= 600
        ? programme.durationMinutes
        : null,
    season:
      programme.season !== undefined && programme.season >= 0 && programme.season <= 500
        ? programme.season
        : null,
    episode:
      programme.episode !== undefined && programme.episode >= 1 && programme.episode <= 5000
        ? programme.episode
        : null,
    directors:
      programme.credits?.directors?.filter((name) => name.length <= 120).slice(0, 10) ?? [],
    actors:
      programme.credits?.actors
        ?.map((actor) => actor.name)
        .filter((name) => name.length <= 120)
        .slice(0, 10) ?? [],
  }
}

async function requestEnrichment(programme: TVProgramme, signal: AbortSignal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8_000)])
  let response: Response
  try {
    response = await fetch(endpoint('enrich'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestSignal,
      body: JSON.stringify({
        programme: programmePayload(programme),
        locale: 'fr-FR',
      }),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Délai d’enrichissement dépassé'
        : 'Complément momentanément indisponible',
    )
  }

  if (!response.ok) {
    let message = 'Complément momentanément indisponible'
    try {
      const body: unknown = await response.json()
      if (
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object' &&
        'message' in body.error &&
        typeof body.error.message === 'string'
      )
        message = body.error.message
    } catch {
      // The response may not contain JSON.
    }
    throw new Error(message)
  }

  const result: unknown = await response.json()
  if (!isMatchResponse(result)) throw new Error('Réponse de complément invalide')
  return result
}

export function enrichProgramme(
  programme: TVProgramme,
  signal: AbortSignal,
): Promise<MatchResponse> {
  if (signal.aborted) return Promise.reject(signal.reason)
  const payload = programmePayload(programme)
  const key = JSON.stringify(payload)
  let pending = pendingRequests.get(key)
  if (pending?.controller.signal.aborted) {
    pendingRequests.delete(key)
    pending = undefined
  }
  if (!pending) {
    const controller = new AbortController()
    const request = {
      controller,
      promise: requestEnrichment(programme, controller.signal),
      consumers: 0,
      settled: false,
    }
    pending = request
    pendingRequests.set(key, request)
    void request.promise.then(
      () => {
        request.settled = true
        if (pendingRequests.get(key) === request) pendingRequests.delete(key)
      },
      () => {
        request.settled = true
        if (pendingRequests.get(key) === request) pendingRequests.delete(key)
      },
    )
  }

  const request = pending
  request.consumers += 1
  return new Promise((resolve, reject) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      signal.removeEventListener('abort', abort)
      request.consumers -= 1
      if (request.consumers === 0 && !request.settled) {
        queueMicrotask(() => {
          if (request.consumers === 0 && !request.settled)
            request.controller.abort(new DOMException('La fiche a été fermée', 'AbortError'))
        })
      }
    }
    const abort = () => {
      release()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    request.promise.then(
      (result) => {
        if (released) return
        release()
        resolve(result)
      },
      (error: unknown) => {
        if (released) return
        release()
        reject(error)
      },
    )
  })
}
