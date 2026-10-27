import type { ProgrammeInput } from './classify.js'
import { normalizeTitle, parseReleaseYear } from './normalize.js'

export interface SearchCandidate {
  providerId: number
  mediaType: 'movie' | 'tv'
  title: string
  originalTitle: string
  year: number | null
  posterPath: string | null
  popularity: number
  runtimeMinutes: number | null
  genres: string[]
  creditedPeople: string[]
  overview?: string | null
}

export interface ScoredCandidate extends SearchCandidate {
  confidence: number
}

function titleScore(programme: ProgrammeInput, candidate: SearchCandidate) {
  const wanted = new Set(
    normalizeTitle(`${programme.title} ${programme.subtitle ?? ''}`)
      .split(' ')
      .filter(Boolean),
  )
  const variants = [candidate.title, candidate.originalTitle].map(normalizeTitle)
  if (variants.some((value) => value === normalizeTitle(programme.title))) return 60
  const best = Math.max(
    ...variants.map((value) => {
      const tokens = new Set(value.split(' ').filter(Boolean))
      const overlap = [...wanted].filter((token) => tokens.has(token)).length
      return wanted.size ? Math.round((overlap / wanted.size) * 55) : 0
    }),
  )
  return Math.min(59, best)
}

function scoreDuration(epgMinutes: number | null, tmdbMinutes: number | null) {
  if (!epgMinutes || !tmdbMinutes || epgMinutes <= 0 || tmdbMinutes <= 0) return null
  const delta = Math.abs(epgMinutes - tmdbMinutes)
  if (delta <= 5) return 15
  if (delta <= 10) return 13
  if (delta <= 20) return 9
  if (delta <= 30) return 5
  return 0
}

function genreKey(value: string) {
  const genre = normalizeTitle(value)
  const aliases: Array<[RegExp, string]> = [
    [/\b(crime|policier|criminel)\b/, 'crime'],
    [/\b(drama|drame|dramatique)\b/, 'drama'],
    [/\b(comedy|comedie|humour)\b/, 'comedy'],
    [/\b(thriller|suspense)\b/, 'thriller'],
    [/\b(science fiction|sci fi)\b/, 'science fiction'],
    [/\b(fantasy|fantastique)\b/, 'fantasy'],
    [/\b(action|action adventure|aventure)\b/, 'action'],
    [/\b(animation|anime|dessin anime)\b/, 'animation'],
    [/\b(documentary|documentaire)\b/, 'documentary'],
    [/\b(horror|horreur|epouvante)\b/, 'horror'],
    [/\b(romance|romantique)\b/, 'romance'],
    [/\b(western)\b/, 'western'],
    [/\b(history|historique|histoire)\b/, 'history'],
    [/\b(war|guerre)\b/, 'war'],
    [/\b(mystery|mystere|enigme)\b/, 'mystery'],
  ]
  return aliases.find(([pattern]) => pattern.test(genre))?.[1] ?? null
}

function scoreGenre(category: string | null, genres: string[]) {
  if (!category || !genres.length) return 0
  const expected = genreKey(category)
  return expected && genres.some((genre) => genreKey(genre) === expected) ? 10 : 0
}

export function scoreCandidate(
  programme: ProgrammeInput,
  candidate: SearchCandidate,
): ScoredCandidate {
  let score = titleScore(programme, candidate)
  const expectedYear = parseReleaseYear(programme.year)
  if (expectedYear !== null && candidate.year !== null) {
    const difference = Math.abs(expectedYear - candidate.year)
    score += difference === 0 ? 20 : difference === 1 ? 10 : 0
  }
  score += scoreDuration(programme.durationMinutes, candidate.runtimeMinutes) ?? 0
  score += scoreGenre(programme.category, candidate.genres)
  const suppliedPeople = [...programme.directors, ...programme.actors].map(normalizeTitle)
  if (
    suppliedPeople.some((person) =>
      candidate.creditedPeople.some((credit) => normalizeTitle(credit) === normalizeTitle(person)),
    )
  )
    score += 10
  return { ...candidate, confidence: Math.min(100, score) }
}

export function rankCandidates(
  programme: ProgrammeInput,
  candidates: SearchCandidate[],
): ScoredCandidate[] {
  return candidates
    .filter((candidate) => candidate.mediaType === 'movie' || candidate.mediaType === 'tv')
    .map((candidate) => scoreCandidate(programme, candidate))
    .sort((a, b) => b.confidence - a.confidence || b.popularity - a.popularity)
}

const synopsisStopWords = new Set(
  `a au aux avec ce ces dans de des du elle en et eux il ils la le les leur lui mais par pour que qui sa se ses son sur un une the and are as at be by for from he her his in is it its of or that their them they this to was were will with`.split(
    ' ',
  ),
)

function synopsisWords(value: string) {
  return normalizeTitle(value)
    .split(' ')
    .filter((word) => word.length >= 3 && !synopsisStopWords.has(word))
    .map((word) => (word.length > 5 && word.endsWith('s') ? word.slice(0, -1) : word))
}

function similarity(left: string, right: string) {
  const leftWords = new Set(synopsisWords(left))
  const rightWords = new Set(synopsisWords(right))
  if (!leftWords.size || !rightWords.size) return 0
  const common = [...leftWords].filter((word) => rightWords.has(word)).length
  if (common < 2) return 0
  return common / Math.min(leftWords.size, rightWords.size)
}

function scoreTvMovie(programme: ProgrammeInput, candidate: SearchCandidate) {
  const criteria: Array<{ weight: number; score: number; available: boolean }> = []
  const wantedTitle = normalizeTitle(programme.title)
  const candidateTitles = [candidate.title, candidate.originalTitle]
    .filter(Boolean)
    .map(normalizeTitle)
  const titleSimilarity = candidateTitles.some((title) => title === wantedTitle)
    ? 1
    : Math.max(0, ...candidateTitles.map((title) => similarity(programme.title, title)))
  criteria.push({ weight: 40, score: 40 * titleSimilarity, available: true })

  const description = programme.description?.trim()
  const overview = candidate.overview?.trim()
  if (description && overview) {
    const synopsisSimilarity = similarity(description, overview)
    criteria.push({
      weight: 25,
      score: synopsisSimilarity >= 0.18 ? 25 * Math.min(1, synopsisSimilarity / 0.55) : 0,
      available: true,
    })
  }

  if (
    candidate.mediaType === 'movie' &&
    programme.durationMinutes !== null &&
    candidate.runtimeMinutes !== null
  ) {
    const delta = Math.abs(programme.durationMinutes - candidate.runtimeMinutes)
    const durationScore = delta <= 15 ? 15 : delta <= 25 ? 10 : delta <= 35 ? 5 : 0
    criteria.push({ weight: 15, score: durationScore, available: true })
  }

  const expectedYear = parseReleaseYear(programme.year)
  if (expectedYear !== null && candidate.year !== null) {
    const difference = Math.abs(expectedYear - candidate.year)
    criteria.push({
      weight: 10,
      score: difference === 0 ? 10 : difference === 1 ? 5 : 0,
      available: true,
    })
  }

  const suppliedPeople = [...programme.directors, ...programme.actors].map(normalizeTitle)
  if (suppliedPeople.length && candidate.creditedPeople.length) {
    const credits = candidate.creditedPeople.map(normalizeTitle)
    const matched = suppliedPeople.filter((person) => credits.includes(person)).length
    criteria.push({
      weight: 10,
      score: 10 * (matched / suppliedPeople.length),
      available: true,
    })
  }

  const independentEvidence = criteria
    .slice(1)
    .some((criterion) => criterion.score >= criterion.weight * 0.4)
  const isTvMovieGenre = candidate.genres.some((genre) =>
    /\b(tv movie|telefilm)\b/.test(normalizeTitle(genre)),
  )
  if (isTvMovieGenre) criteria.push({ weight: 5, score: 5, available: true })

  const available = criteria.filter((criterion) => criterion.available)
  const maximum = available.reduce((sum, criterion) => sum + criterion.weight, 0)
  const rawScore = available.reduce((sum, criterion) => sum + criterion.score, 0)
  return {
    ...candidate,
    confidence: maximum ? Math.round((rawScore / maximum) * 100) : 0,
    exactTitle: candidateTitles.includes(wantedTitle),
    independentEvidence,
  }
}

export function rankTvMovieCandidates(programme: ProgrammeInput, candidates: SearchCandidate[]) {
  return candidates
    .filter((candidate) => candidate.mediaType === 'movie' || candidate.mediaType === 'tv')
    .map((candidate) => scoreTvMovie(programme, candidate))
    .sort((left, right) => right.confidence - left.confidence || right.popularity - left.popularity)
}

export function chooseTvMovieCandidate(candidates: ReturnType<typeof rankTvMovieCandidates>) {
  const [best, second] = candidates
  if (!best || best.confidence < 70) return { status: 'not_found' as const }
  const margin = second ? best.confidence - second.confidence : 100
  if (best.exactTitle && best.independentEvidence && best.confidence >= 85 && margin >= 15)
    return { status: 'matched' as const, candidate: best }
  return { status: 'ambiguous' as const }
}

export function chooseCandidate(programme: ProgrammeInput, candidates: ScoredCandidate[]) {
  const [best, second] = candidates
  if (!best || best.confidence < 70) return { status: 'not_found' as const }
  const margin = second ? best.confidence - second.confidence : 100
  if (best.confidence >= 90 && margin >= 15) return { status: 'matched' as const, candidate: best }
  const hasExactTitle = [best.title, best.originalTitle].some(
    (title) => normalizeTitle(title) === normalizeTitle(programme.title),
  )
  const hasCloseRuntime =
    programme.durationMinutes !== null &&
    best.runtimeMinutes !== null &&
    Math.abs(best.runtimeMinutes - programme.durationMinutes) <= 5
  const hasMatchingGenre = scoreGenre(programme.category, best.genres) > 0
  if (
    best.mediaType === 'movie' &&
    hasExactTitle &&
    hasCloseRuntime &&
    hasMatchingGenre &&
    margin >= 15 &&
    best.confidence >= 85
  )
    return { status: 'matched' as const, candidate: best }
  if (
    best.mediaType === 'tv' &&
    hasExactTitle &&
    hasMatchingGenre &&
    (programme.durationMinutes === null || best.runtimeMinutes === null || hasCloseRuntime) &&
    margin >= 15 &&
    best.confidence >= 70
  )
    return { status: 'matched' as const, candidate: best }
  return { status: 'ambiguous' as const }
}
