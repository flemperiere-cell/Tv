import type { EpisodePayload } from '../db/repository.js'
import type { ProgrammeInput } from './classify.js'
import { normalizeTitle } from './normalize.js'

const stopWords = new Set(
  `a ai au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me meme mes moi mon ne nos notre nous on ou par qu que qui sa sans se ses son sur ta te tes toi ton tu un une vos votre vous the an and are as at be by for from he her his in is it its of or that their them they this to was were will with`.split(
    ' ',
  ),
)

export interface MatchEvidence {
  seriesTitleExact: boolean
  seriesYearMatch: boolean | null
  episodeTitleSimilarity: number | null
  episodeSynopsisSimilarity: number | null
  episodeNumberMatch: boolean | null
  episodeNumberOffset: number | null
  contradictoryEvidence: string[]
  matchedSeason?: number | null
  matchedEpisode?: number | null
}

function contentWords(value: string) {
  return normalizeTitle(value)
    .split(' ')
    .filter((word) => word.length >= 3 && !stopWords.has(word))
    .map((word) => (word.length > 5 && word.endsWith('s') ? word.slice(0, -1) : word))
}

function titleSimilarity(expected: string | null, actual: Array<string | null>) {
  if (!expected?.trim()) return null
  const actualTitles = actual.filter((value): value is string => !!value?.trim())
  if (!actualTitles.length) return null
  const wanted = normalizeTitle(expected)
  if (actualTitles.some((value) => normalizeTitle(value) === wanted)) return 1
  const expectedWords = new Set(contentWords(expected))
  if (expectedWords.size < 2) return 0
  return Math.max(
    0,
    ...actualTitles.map((value) => {
      const actualWords = new Set(contentWords(value))
      const common = [...expectedWords].filter((word) => actualWords.has(word)).length
      return common >= 2 && actualWords.size >= 2
        ? common / Math.min(expectedWords.size, actualWords.size)
        : 0
    }),
  )
}

function overviewSimilarity(expected: string | null, actual: string | null) {
  if (!expected?.trim() || !actual?.trim()) return null
  const expectedWords = new Set(contentWords(expected))
  const actualWords = new Set(contentWords(actual))
  if (!expectedWords.size || !actualWords.size) return null
  const common = [...expectedWords].filter((word) => actualWords.has(word)).length
  return common / Math.min(expectedWords.size, actualWords.size)
}

export function scoreEpisodeEvidence(
  programme: ProgrammeInput,
  episode: EpisodePayload | null,
  series: {
    titleExact: boolean
    yearMatch: boolean | null
    season: number | null
    episodeNumber: number | null
  } = {
    titleExact: false,
    yearMatch: null,
    season: programme.season,
    episodeNumber: programme.episode,
  },
) {
  const episodeTitleSimilarity = episode
    ? titleSimilarity(programme.subtitle, [episode.name, episode.originalName ?? null])
    : null
  const synopsisScores = episode
    ? [episode.overview, episode.originalOverview ?? null]
        .map((overview) => overviewSimilarity(programme.description, overview))
        .filter((score): score is number => score !== null)
    : []
  const episodeSynopsisSimilarity = synopsisScores.length ? Math.max(...synopsisScores) : null
  const titleConfirmed = (episodeTitleSimilarity ?? 0) >= 0.7
  const synopsisConfirmed = (episodeSynopsisSimilarity ?? 0) >= 0.2
  const contradictoryEvidence: string[] = []
  if (episode && programme.subtitle?.trim() && episode.name && !titleConfirmed)
    contradictoryEvidence.push('episode_title')
  if (episode && programme.description?.trim() && episode.overview && !synopsisConfirmed)
    contradictoryEvidence.push('episode_synopsis')
  const hasEpisodeInfo = !!(
    episode?.name ||
    episode?.originalName ||
    episode?.overview ||
    episode?.originalOverview ||
    episode?.airDate ||
    episode?.guestCast.length
  )
  const episodeNumberMatch =
    series.episodeNumber !== null && series.season !== null && episode
      ? series.episodeNumber === programme.episode &&
        series.season === programme.season &&
        hasEpisodeInfo
      : null
  const episodeNumberOffset =
    series.episodeNumber !== null && programme.episode !== null && hasEpisodeInfo
      ? series.episodeNumber - programme.episode
      : null
  const titleScore = titleConfirmed ? 15 : 0
  const overviewScore = synopsisConfirmed ? 10 : 0
  const contradictory =
    contradictoryEvidence.includes('episode_synopsis') ||
    (contradictoryEvidence.includes('episode_title') && !synopsisConfirmed)
  return {
    score: titleScore + overviewScore,
    confirmed: (titleConfirmed || synopsisConfirmed) && !contradictory,
    contradictory,
    evidence: {
      seriesTitleExact: series.titleExact,
      seriesYearMatch: series.yearMatch,
      episodeTitleSimilarity,
      episodeSynopsisSimilarity,
      episodeNumberMatch,
      episodeNumberOffset,
      contradictoryEvidence,
      matchedSeason: series.season,
      matchedEpisode: series.episodeNumber,
    } satisfies MatchEvidence,
  }
}
