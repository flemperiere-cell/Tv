import type { TVProgramme } from '../../models/tv'
import type { MediaType } from '../../models/media'

const excluded =
  /\b(sport|football|rugby|tennis|journal|actualit[eé]s?|d[eé]bat|m[eé]t[eé]o|bulletin|direct|concert|magazine|talk.show)\b/i
const tvMovie = /\btelefilms?\b/
const movie = /\b(?:films?|filmreihe|movies?)\b/
const cinema = /\bcinema\b/
const cinemaProgramming = /\b(?:doc|documentaire|mag|magazine)\s+cinema\b/
const series = /\b(?:series?|feuilletons?)\b/
const comedyCategory = /^(?:comedie|comedy)$/

export function classifyProgramme(programme: TVProgramme): MediaType | null {
  if (
    !programme.title.trim() ||
    programme.title.length > 200 ||
    (programme.category?.length ?? 0) > 100
  )
    return null
  const category = programme.category ?? ''
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr-FR')
  const normalizedCategory = normalize([category, ...(programme.categories ?? [])].join(' '))
  const combined = `${normalizedCategory} ${normalize(programme.title)}`
  if (programme.isLive || excluded.test(combined)) return null

  if (tvMovie.test(normalizedCategory)) return 'movie'
  const isSeries =
    programme.season !== undefined ||
    programme.episode !== undefined ||
    series.test(normalizedCategory)
  const isComedy = [category, ...(programme.categories ?? [])].some((value) =>
    comedyCategory.test(normalize(value.trim())),
  )
  if (
    movie.test(normalizedCategory) ||
    (cinema.test(normalizedCategory) && !cinemaProgramming.test(normalizedCategory)) ||
    (isComedy && !isSeries)
  )
    return 'movie'
  if (isSeries) return 'tv'
  return null
}
