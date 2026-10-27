export interface ProgrammeInput {
  title: string
  subtitle: string | null
  description: string | null
  category: string | null
  year: string | null
  durationMinutes: number | null
  season: number | null
  episode: number | null
  directors: string[]
  actors: string[]
}

export type Classification =
  | {
      status: 'classified'
      mediaType: 'movie' | 'tv'
      programmeKind: 'movie' | 'tv_movie' | 'tv_series'
    }
  | { status: 'unsupported' }
  | { status: 'ambiguous' }

const excluded =
  /\b(sport|football|rugby|tennis|journal|actualit[eé]s?|d[eé]bat|m[eé]t[eé]o|bulletin|direct|concert|magazine|talk.show)\b/i
const tvMovie = /\btelefilms?\b/
const movie = /\b(?:films?|filmreihe|movies?)\b/
const cinema = /\bcinema\b/
const cinemaProgramming = /\b(?:doc|documentaire|mag|magazine)\s+cinema\b/
const series = /\b(?:series?|feuilletons?)\b/
const comedyCategory = /^(?:comedie|comedy)$/

export function classifyProgramme(programme: ProgrammeInput): Classification {
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR')
  const category = normalize(programme.category ?? '')
  if (excluded.test(`${category} ${programme.title}`)) return { status: 'unsupported' }
  if (tvMovie.test(category))
    return { status: 'classified', mediaType: 'movie', programmeKind: 'tv_movie' }
  const isSeries = programme.season !== null || programme.episode !== null || series.test(category)
  const isComedy = category.split(/[/,;|]/).some((value) => comedyCategory.test(value.trim()))
  const isMovie =
    movie.test(category) ||
    (cinema.test(category) && !cinemaProgramming.test(category)) ||
    (isComedy && !isSeries)
  if (isMovie && isSeries) return { status: 'ambiguous' }
  if (isMovie) return { status: 'classified', mediaType: 'movie', programmeKind: 'movie' }
  if (isSeries) return { status: 'classified', mediaType: 'tv', programmeKind: 'tv_series' }
  return { status: 'unsupported' }
}
