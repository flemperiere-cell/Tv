export type MediaType = 'movie' | 'tv'

export interface MediaPerson {
  providerId: number | null
  name: string
}

export interface MediaCastMember extends MediaPerson {
  character: string | null
  order: number
  profileUrl: string | null
}

export interface MediaMetadata {
  mediaType: MediaType
  providerId: number
  title: string
  originalTitle: string
  releaseDate: string | null
  firstAirDate: string | null
  year: number | null
  voteAverage?: number | null
  voteCount?: number | null
  overview: string | null
  genres: string[]
  countries: string[]
  runtimeMinutes: number | null
  posterUrl: string | null
  backdropUrl: string | null
  directors: MediaPerson[]
  creators: MediaPerson[]
  cast: MediaCastMember[]
  season: number | null
  episode: number | null
  episodeTitle: string | null
  episodeOriginalTitle: string | null
  episodeOverview: string | null
  episodeAirDate: string | null
  guestCast: MediaCastMember[]
  tmdbUrl: string
  networks?: string[]
  seasonYears?: number[]
}

export interface MatchAlternative {
  providerId: number
  mediaType: MediaType
  title: string
  year: number | null
  posterUrl: string | null
  confidence: number
  overview?: string | null
  genres?: string[]
  date?: string | null
}

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

export interface MatchResponse {
  status: 'matched' | 'ambiguous' | 'not_found' | 'unsupported'
  match: {
    provider: 'tmdb'
    mediaType: MediaType
    providerId: number
    confidence: number
    manual: boolean
    method: 'title' | 'title_and_episode' | 'series_only' | 'manual'
    evidence?: MatchEvidence
  } | null
  metadata: MediaMetadata | null
  alternatives: MatchAlternative[]
  evidence?: MatchEvidence
  cache: {
    source: 'fresh' | 'cached' | 'stale'
    expiresAt: string | null
  }
  attribution: {
    provider: 'TMDB'
    required: true
  }
}

export type MediaEnrichmentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'matched'; response: MatchResponse }
  | { status: 'ambiguous'; response: MatchResponse }
  | { status: 'not-found'; response: MatchResponse }
  | { status: 'unsupported'; response: MatchResponse }
  | { status: 'error'; message: string }
