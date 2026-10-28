import type { TVProgramme } from '../models/tv'

export interface ProgrammeSearchResult {
  programme: TVProgramme
  relevance: number
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim()
}

export function searchProgrammes(programmes: TVProgramme[], query: string) {
  const normalizedQuery = normalize(query)
  if ([...normalizedQuery].length < 3) return []

  const results: ProgrammeSearchResult[] = []
  for (const programme of programmes) {
    const title = normalize(programme.title)
    const actors = (programme.credits?.actors ?? []).map((actor) => normalize(actor.name))
    const categories = [programme.category, ...(programme.categories ?? [])]
      .filter((category): category is string => !!category)
      .map(normalize)

    let relevance = 0
    if (title.includes(normalizedQuery)) {
      relevance = title === normalizedQuery ? 6 : title.startsWith(normalizedQuery) ? 5 : 4
    } else if (actors.some((actor) => actor.includes(normalizedQuery))) {
      relevance = 2
    } else if (categories.some((category) => category.includes(normalizedQuery))) {
      relevance = 1
    }

    if (relevance) results.push({ programme, relevance })
  }

  return results.sort(
    (left, right) =>
      right.relevance - left.relevance ||
      left.programme.start.localeCompare(right.programme.start),
  )
}
