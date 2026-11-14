import { classifyProgramme, type ProgrammeInput } from './classify.js'
import { normalizeTitle, parseReleaseYear } from './normalize.js'
import type {
  MatchScoreCriterion,
  MatchScoring,
  MatchSelectionCheck,
} from '../../../src/models/media.js'

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
  networks?: string[]
  seasonYears?: number[]
  searchResultCount?: number
}

export interface ScoredCandidate extends SearchCandidate {
  confidence: number
  scoring: MatchScoring
}

const MOVIE_MATCH_MIN_CONFIDENCE = 80
const MOVIE_MATCH_MIN_MARGIN = 10
const EXACT_TITLE_POINTS = 65
const ADVERTISING_AVERAGE_MINUTES_PER_HOUR = 9
const ADVERTISING_MAX_MINUTES_PER_HOUR = 12

function channelKey(value: string) {
  return normalizeTitle(value)
    .replace(/\b(?:fr|hd|uhd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreBroadcastEvidence(programme: ProgrammeInput, candidate: SearchCandidate) {
  const expectedChannel = programme.channel && channelKey(programme.channel)
  const channelMatch =
    !!expectedChannel &&
    (candidate.networks ?? []).some((network) => channelKey(network) === expectedChannel)
  const broadcastYear = programme.broadcastDate?.match(/^(\d{4})/)?.[1]
  const seasonMatch =
    !!broadcastYear && (candidate.seasonYears ?? []).includes(Number(broadcastYear))
  return { score: (channelMatch ? 15 : 0) + (seasonMatch ? 10 : 0), channelMatch, seasonMatch }
}

function hasUnambiguousSearchEvidence(programme: ProgrammeInput, candidate: SearchCandidate) {
  return (
    candidate.searchResultCount === 1 &&
    !!candidate.originalTitle &&
    normalizeTitle(candidate.originalTitle) === normalizeTitle(programme.title)
  )
}

function titleScore(programme: ProgrammeInput, candidate: SearchCandidate) {
  const wanted = new Set(
    normalizeTitle(`${programme.title} ${programme.subtitle ?? ''}`)
      .split(' ')
      .filter(Boolean),
  )
  const variants = [candidate.title, candidate.originalTitle].map(normalizeTitle)
  if (variants.some((value) => value === normalizeTitle(programme.title))) return EXACT_TITLE_POINTS
  const best = Math.max(
    ...variants.map((value) => {
      const tokens = new Set(value.split(' ').filter(Boolean))
      const overlap = [...wanted].filter((token) => tokens.has(token)).length
      return wanted.size ? Math.round((overlap / wanted.size) * 55) : 0
    }),
  )
  return Math.min(59, best)
}

function advertisingAllowance(runtimeMinutes: number) {
  if (runtimeMinutes <= 60) return ADVERTISING_MAX_MINUTES_PER_HOUR
  return Math.min(
    (runtimeMinutes / 60) * ADVERTISING_AVERAGE_MINUTES_PER_HOUR,
    Math.ceil(runtimeMinutes / 60) * ADVERTISING_MAX_MINUTES_PER_HOUR,
  )
}

function scoreDuration(
  epgMinutes: number | null,
  tmdbMinutes: number | null,
  mediaType: SearchCandidate['mediaType'],
) {
  if (!epgMinutes || !tmdbMinutes || epgMinutes <= 0 || tmdbMinutes <= 0) return null
  const surplus = epgMinutes - tmdbMinutes
  const delta =
    mediaType === 'movie' && surplus >= 0 && surplus <= advertisingAllowance(epgMinutes)
      ? 0
      : Math.abs(surplus)
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
    [/\b(reality|jeu|jeux|jeu televise|tele realite)\b/, 'reality'],
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

function criterion(
  id: string,
  label: string,
  xmltvValue: string | null,
  tmdbValue: string | null,
  points: number,
  maximumPoints: number | null,
  available = true,
  statusOverride?: MatchScoreCriterion['status'],
): MatchScoreCriterion {
  const status: MatchScoreCriterion['status'] =
    statusOverride ??
    (!available
      ? 'unavailable'
      : maximumPoints === null
        ? 'not_applicable'
        : points === 0
          ? 'mismatch'
          : points >= maximumPoints
            ? 'match'
            : 'partial')
  return { id, label, xmltvValue, tmdbValue, points, maximumPoints, status }
}

export function scoreCandidate(
  programme: ProgrammeInput,
  candidate: SearchCandidate,
): ScoredCandidate {
  const criteria: MatchScoreCriterion[] = []
  const programmeClassification = classifyProgramme(programme)
  const isTvSeries =
    programmeClassification.status === 'classified' &&
    programmeClassification.programmeKind === 'tv_series'
  const titlePoints = titleScore(programme, candidate)
  criteria.push(
    criterion(
      'title',
      'Titre',
      [programme.title, programme.subtitle].filter(Boolean).join(' · '),
      [candidate.title, candidate.originalTitle].filter(Boolean).join(' · '),
      titlePoints,
      EXACT_TITLE_POINTS,
    ),
  )
  if (isTvSeries)
    criteria.push(
      criterion(
        'media_type',
        'Type de programme',
        programme.category ?? 'Série (saison/épisode)',
        candidate.mediaType === 'tv' ? 'Série TV' : 'Film',
        0,
        null,
        true,
        candidate.mediaType === 'tv' ? 'match' : 'mismatch',
      ),
    )

  let score = titlePoints
  const expectedYear = parseReleaseYear(programme.year)
  if (expectedYear !== null && candidate.year !== null) {
    const difference = Math.abs(expectedYear - candidate.year)
    const points = difference === 0 ? 20 : difference === 1 ? 10 : 0
    score += points
    criteria.push(
      criterion('year', 'Année', String(expectedYear), String(candidate.year), points, 20),
    )
  } else {
    criteria.push(
      criterion(
        'year',
        'Année',
        expectedYear === null ? programme.year : String(expectedYear),
        candidate.year === null ? null : String(candidate.year),
        0,
        20,
        false,
      ),
    )
  }

  const durationPoints = scoreDuration(
    programme.durationMinutes,
    candidate.runtimeMinutes,
    candidate.mediaType,
  )
  score += durationPoints ?? 0
  criteria.push(
    criterion(
      'duration',
      'Durée',
      programme.durationMinutes === null ? null : `${programme.durationMinutes} min`,
      candidate.runtimeMinutes === null ? null : `${candidate.runtimeMinutes} min`,
      durationPoints ?? 0,
      15,
      durationPoints !== null,
    ),
  )

  const genrePoints = scoreGenre(programme.category, candidate.genres)
  score += genrePoints
  const hasGenreData = !!programme.category && candidate.genres.length > 0
  const genreApplicable = genreKey(programme.category ?? '') !== null
  criteria.push(
    criterion(
      'genre',
      'Genre',
      programme.category,
      candidate.genres.length ? candidate.genres.join(', ') : null,
      genrePoints,
      genreApplicable ? 10 : null,
      hasGenreData,
    ),
  )

  const suppliedPeople = [...programme.directors, ...programme.actors].map(normalizeTitle)
  const matchingPeople = [
    ...new Set(
      [...programme.directors, ...programme.actors].filter((person) =>
        candidate.creditedPeople.some(
          (credit) => normalizeTitle(credit) === normalizeTitle(person),
        ),
      ),
    ),
  ]
  const peoplePoints = matchingPeople.length ? 10 : 0
  score += peoplePoints
  criteria.push(
    criterion(
      'people',
      'Réalisation / distribution',
      [...new Set([...programme.directors, ...programme.actors])].join(', ') || null,
      candidate.creditedPeople.join(', ') || null,
      peoplePoints,
      10,
      suppliedPeople.length > 0 && candidate.creditedPeople.length > 0,
    ),
  )

  const broadcast = scoreBroadcastEvidence(programme, candidate)
  score += broadcast.score
  const expectedChannel = programme.channel && channelKey(programme.channel)
  const broadcastYear = programme.broadcastDate?.match(/^(\d{4})/)?.[1]
  const channelValue = expectedChannel ? (candidate.networks ?? []).join(', ') || null : null
  const channelPoints = broadcast.channelMatch ? 15 : 0
  const seasonPoints = broadcast.seasonMatch ? 10 : 0
  criteria.push(
    criterion(
      'channel',
      'Chaîne de diffusion',
      programme.channel ?? null,
      channelValue,
      channelPoints,
      15,
      !!expectedChannel && (candidate.networks ?? []).length > 0,
    ),
    criterion(
      'broadcast_year',
      'Année de diffusion',
      broadcastYear ?? null,
      candidate.seasonYears?.length ? candidate.seasonYears.join(', ') : null,
      seasonPoints,
      10,
      !!broadcastYear && (candidate.seasonYears ?? []).length > 0,
    ),
  )

  const uniqueSearch = hasUnambiguousSearchEvidence(programme, candidate)
  score += uniqueSearch ? 15 : 0
  const searchResultLabel =
    candidate.searchResultCount === undefined
      ? 'Nombre de résultats inconnu'
      : `${candidate.searchResultCount} résultat${candidate.searchResultCount === 1 ? '' : 's'}`
  criteria.push(
    criterion(
      'unique_search',
      'Recherche TMDB unique (titre original exact)',
      programme.title,
      [searchResultLabel, `titre original : ${candidate.originalTitle || candidate.title}`].join(
        ' · ',
      ),
      uniqueSearch ? 15 : 0,
      15,
      candidate.searchResultCount !== undefined,
    ),
  )

  return {
    ...candidate,
    confidence: Math.min(100, score),
    scoring: {
      method: 'standard',
      points: score,
      maximumPoints: 160,
      criteria,
    },
  }
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
  const details: MatchScoreCriterion[] = []
  const wantedTitle = normalizeTitle(programme.title)
  const candidateTitles = [candidate.title, candidate.originalTitle]
    .filter(Boolean)
    .map(normalizeTitle)
  const titleSimilarity = candidateTitles.some((title) => title === wantedTitle)
    ? 1
    : Math.max(0, ...candidateTitles.map((title) => similarity(programme.title, title)))
  criteria.push({ weight: 40, score: 40 * titleSimilarity, available: true })
  details.push(
    criterion(
      'title',
      'Titre',
      programme.title,
      [candidate.title, candidate.originalTitle].filter(Boolean).join(' · '),
      40 * titleSimilarity,
      40,
    ),
  )

  const description = programme.description?.trim()
  const overview = candidate.overview?.trim()
  if (description && overview) {
    const synopsisSimilarity = similarity(description, overview)
    const points = synopsisSimilarity >= 0.18 ? 25 * Math.min(1, synopsisSimilarity / 0.55) : 0
    criteria.push({
      weight: 25,
      score: points,
      available: true,
    })
    details.push(criterion('synopsis', 'Résumé', description, overview, points, 25))
  } else {
    details.push(
      criterion('synopsis', 'Résumé', description ?? null, overview ?? null, 0, 25, false),
    )
  }

  if (
    candidate.mediaType === 'movie' &&
    programme.durationMinutes !== null &&
    candidate.runtimeMinutes !== null
  ) {
    const delta = Math.abs(programme.durationMinutes - candidate.runtimeMinutes)
    const durationScore = delta <= 15 ? 15 : delta <= 25 ? 10 : delta <= 35 ? 5 : 0
    criteria.push({ weight: 15, score: durationScore, available: true })
    details.push(
      criterion(
        'duration',
        'Durée',
        `${programme.durationMinutes} min`,
        `${candidate.runtimeMinutes} min`,
        durationScore,
        15,
      ),
    )
  } else {
    details.push(
      criterion(
        'duration',
        'Durée',
        programme.durationMinutes === null ? null : `${programme.durationMinutes} min`,
        candidate.runtimeMinutes === null ? null : `${candidate.runtimeMinutes} min`,
        0,
        15,
        false,
      ),
    )
  }

  const expectedYear = parseReleaseYear(programme.year)
  if (expectedYear !== null && candidate.year !== null) {
    const difference = Math.abs(expectedYear - candidate.year)
    const points = difference === 0 ? 10 : difference === 1 ? 5 : 0
    criteria.push({
      weight: 10,
      score: points,
      available: true,
    })
    details.push(
      criterion('year', 'Année', String(expectedYear), String(candidate.year), points, 10),
    )
  } else {
    details.push(
      criterion(
        'year',
        'Année',
        expectedYear === null ? programme.year : String(expectedYear),
        candidate.year === null ? null : String(candidate.year),
        0,
        10,
        false,
      ),
    )
  }

  const suppliedPeople = [...programme.directors, ...programme.actors].map(normalizeTitle)
  if (suppliedPeople.length && candidate.creditedPeople.length) {
    const credits = candidate.creditedPeople.map(normalizeTitle)
    const matched = suppliedPeople.filter((person) => credits.includes(person)).length
    const points = 10 * (matched / suppliedPeople.length)
    criteria.push({
      weight: 10,
      score: points,
      available: true,
    })
    details.push(
      criterion(
        'people',
        'Réalisation / distribution',
        [...new Set([...programme.directors, ...programme.actors])].join(', ') || null,
        candidate.creditedPeople.join(', ') || null,
        points,
        10,
      ),
    )
  } else {
    details.push(
      criterion(
        'people',
        'Réalisation / distribution',
        [...new Set([...programme.directors, ...programme.actors])].join(', ') || null,
        candidate.creditedPeople.join(', ') || null,
        0,
        10,
        false,
      ),
    )
  }

  const independentEvidence = criteria
    .slice(1)
    .some((criterion) => criterion.score >= criterion.weight * 0.4)
  const isTvMovieGenre = candidate.genres.some((genre) =>
    /\b(tv movie|telefilm)\b/.test(normalizeTitle(genre)),
  )
  if (isTvMovieGenre) {
    criteria.push({ weight: 5, score: 5, available: true })
    details.push(
      criterion('tv_movie_genre', 'Genre téléfilm', 'Téléfilm', candidate.genres.join(', '), 5, 5),
    )
  } else {
    details.push(
      criterion(
        'tv_movie_genre',
        'Genre téléfilm',
        'Téléfilm',
        candidate.genres.join(', ') || null,
        0,
        null,
      ),
    )
  }

  const available = criteria.filter((criterion) => criterion.available)
  const maximum = available.reduce((sum, criterion) => sum + criterion.weight, 0)
  const rawScore = available.reduce((sum, criterion) => sum + criterion.score, 0)
  return {
    ...candidate,
    confidence: maximum ? Math.round((rawScore / maximum) * 100) : 0,
    exactTitle: candidateTitles.includes(wantedTitle),
    independentEvidence,
    scoring: {
      method: 'tv_movie' as const,
      points: rawScore,
      maximumPoints: maximum,
      criteria: details,
    },
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
  if (!best)
    return {
      status: 'not_found' as const,
      checks: [{ label: 'Proposition disponible', passed: false, detail: 'Aucun résultat TMDB.' }],
    }
  if (best.confidence < 70)
    return {
      status: 'not_found' as const,
      checks: [
        {
          label: 'Seuil minimal',
          passed: false,
          detail: `${Math.round(best.confidence)} % obtenu, 70 % minimum pour proposer une fiche.`,
        },
      ],
    }
  const margin = second ? best.confidence - second.confidence : 100
  const checks: MatchSelectionCheck[] = [
    {
      label: 'Titre exact',
      passed: best.exactTitle,
      detail: best.exactTitle
        ? 'Le titre correspond.'
        : 'Le titre TMDB ne correspond pas exactement.',
    },
    {
      label: 'Indice indépendant du titre',
      passed: best.independentEvidence,
      detail: best.independentEvidence
        ? 'Au moins un autre critère apporte une preuve suffisante.'
        : 'Aucun autre critère ne confirme assez le titre.',
    },
    {
      label: 'Score requis',
      passed: best.confidence >= MOVIE_MATCH_MIN_CONFIDENCE,
      detail: `${Math.round(best.confidence)} % obtenu, ${MOVIE_MATCH_MIN_CONFIDENCE} % requis.`,
    },
    {
      label: 'Écart avec la proposition suivante',
      passed: margin >= MOVIE_MATCH_MIN_MARGIN,
      detail: `${Math.round(margin)} points d’écart, ${MOVIE_MATCH_MIN_MARGIN} requis.`,
    },
  ]
  return checks.every((check) => check.passed)
    ? { status: 'matched' as const, candidate: best, checks }
    : { status: 'ambiguous' as const, checks }
}

export function chooseCandidate(programme: ProgrammeInput, candidates: ScoredCandidate[]) {
  const [best, second] = candidates
  if (!best)
    return {
      status: 'not_found' as const,
      checks: [{ label: 'Proposition disponible', passed: false, detail: 'Aucun résultat TMDB.' }],
    }
  if (best.confidence < 70)
    return {
      status: 'not_found' as const,
      checks: [
        {
          label: 'Seuil minimal',
          passed: false,
          detail: `${Math.round(best.confidence)} % obtenu, 70 % minimum pour proposer une fiche.`,
        },
      ],
    }

  const margin = second ? best.confidence - second.confidence : 100
  const score90 = best.confidence >= 90
  const margin15 = margin >= 15
  if (score90 && margin15)
    return {
      status: 'matched' as const,
      candidate: best,
      checks: [
        {
          label: 'Score de correspondance',
          passed: true,
          detail: `${Math.round(best.confidence)} % obtenu, 90 % requis pour cette règle.`,
        },
        {
          label: 'Écart avec la proposition suivante',
          passed: true,
          detail: `${Math.round(margin)} points d’écart, 15 requis.`,
        },
      ],
    }

  const hasExactTitle = [best.title, best.originalTitle].some(
    (title) => normalizeTitle(title) === normalizeTitle(programme.title),
  )
  const hasCloseRuntime =
    programme.durationMinutes !== null &&
    best.runtimeMinutes !== null &&
    Math.abs(best.runtimeMinutes - programme.durationMinutes) <= 5
  const durationSurplus =
    programme.durationMinutes !== null && best.runtimeMinutes !== null
      ? programme.durationMinutes - best.runtimeMinutes
      : null
  const hasMovieRuntime =
    durationSurplus !== null &&
    programme.durationMinutes !== null &&
    durationSurplus >= 0 &&
    durationSurplus <= advertisingAllowance(programme.durationMinutes)
  const hasMatchingGenre = scoreGenre(programme.category, best.genres) > 0
  const programmeClassification = classifyProgramme(programme)
  const isTvSeries =
    programmeClassification.status === 'classified' &&
    programmeClassification.programmeKind === 'tv_series'
  const hasMatchingType = isTvSeries && best.mediaType === 'tv'
  const broadcastEvidence = scoreBroadcastEvidence(programme, best)
  const hasBroadcastEvidence = broadcastEvidence.channelMatch || broadcastEvidence.seasonMatch
  const hasIndependentSearchEvidence = hasUnambiguousSearchEvidence(programme, best)
  const broadcastYear = programme.broadcastDate?.match(/^(\d{4})/)?.[1]
  const searchResultLabel =
    best.searchResultCount === undefined
      ? 'nombre de résultats inconnu'
      : `${best.searchResultCount} résultat${best.searchResultCount === 1 ? '' : 's'}`
  const independentEvidenceDetails = [
    `type de programme XMLTV « ${programme.category || (programme.season !== null || programme.episode !== null ? 'Série (saison/épisode)' : 'non renseigné')} » / TMDB « ${best.mediaType === 'tv' ? 'Série TV' : 'Film'} »`,
    genreKey(programme.category ?? '') === null
      ? `catégorie « ${programme.category || 'absente'} » non exploitable comme genre`
      : `genre XMLTV « ${programme.category} » / TMDB « ${best.genres.join(', ') || 'non renseigné'} »`,
    `diffuseur XMLTV « ${programme.channel || 'non renseigné'} » / réseaux TMDB « ${(best.networks ?? []).join(', ') || 'non renseignés'} »`,
    `année de diffusion ${broadcastYear ?? 'non renseignée'} / saisons TMDB ${(best.seasonYears ?? []).join(', ') || 'non renseignées'}`,
    `recherche TMDB : ${searchResultLabel}, titre original « ${best.originalTitle || 'non renseigné'} »`,
  ]
  const matchingIndependentEvidence = [
    hasMatchingType && 'type de programme',
    hasMatchingGenre && 'genre',
    broadcastEvidence.channelMatch && 'chaîne de diffusion',
    broadcastEvidence.seasonMatch && 'année de diffusion',
    hasIndependentSearchEvidence && 'résultat TMDB unique',
  ].filter((value): value is string => Boolean(value))
  const independentEvidenceDetail = matchingIndependentEvidence.length
    ? `Indices concordants : ${matchingIndependentEvidence.join(', ')}.`
    : `Aucun indice indépendant ne confirme cette série : ${independentEvidenceDetails.join('; ')}.`
  const checks: MatchSelectionCheck[] =
    best.mediaType === 'movie'
      ? [
          {
            label: 'Titre exact',
            passed: hasExactTitle,
            detail: hasExactTitle
              ? 'Le titre correspond.'
              : 'Le titre TMDB ne correspond pas exactement.',
          },
          {
            label: 'Durée compatible',
            passed: hasMovieRuntime,
            detail: hasMovieRuntime
              ? 'La durée TMDB est compatible avec les coupures publicitaires.'
              : 'La durée XMLTV et la durée TMDB sont trop différentes ou absentes.',
          },
          {
            label: 'Genre concordant',
            passed: hasMatchingGenre,
            detail: hasMatchingGenre ? 'Le genre correspond.' : 'Aucun genre commun reconnu.',
          },
          {
            label: 'Score requis',
            passed: best.confidence >= MOVIE_MATCH_MIN_CONFIDENCE,
            detail: `${Math.round(best.confidence)} % obtenu, ${MOVIE_MATCH_MIN_CONFIDENCE} % requis.`,
          },
          {
            label: 'Écart avec la proposition suivante',
            passed: margin >= MOVIE_MATCH_MIN_MARGIN,
            detail: `${Math.round(margin)} points d’écart, ${MOVIE_MATCH_MIN_MARGIN} requis.`,
          },
        ]
      : [
          {
            label: 'Titre exact',
            passed: hasExactTitle,
            detail: hasExactTitle
              ? 'Le titre correspond.'
              : 'Le titre TMDB ne correspond pas exactement.',
          },
          {
            label: 'Confirmation indépendante',
            passed:
              hasMatchingType ||
              hasMatchingGenre ||
              hasBroadcastEvidence ||
              hasIndependentSearchEvidence,
            detail: independentEvidenceDetail,
          },
          {
            label: 'Durée compatible',
            passed:
              programme.durationMinutes === null ||
              best.runtimeMinutes === null ||
              hasCloseRuntime ||
              hasIndependentSearchEvidence,
            detail:
              'La durée doit être proche (5 min), absente d’un côté ou confirmée par un résultat unique.',
          },
          {
            label: 'Score minimal',
            passed: best.confidence >= 70,
            detail: `${Math.round(best.confidence)} % obtenu, 70 % minimum.`,
          },
          {
            label: 'Écart avec la proposition suivante',
            passed: margin >= 15,
            detail: `${Math.round(margin)} points d’écart, 15 requis.`,
          },
        ]
  return checks.every((check) => check.passed)
    ? { status: 'matched' as const, candidate: best, checks }
    : { status: 'ambiguous' as const, checks }
}
