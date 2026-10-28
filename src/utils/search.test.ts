import { describe, expect, it } from 'vitest'
import type { TVProgramme } from '../models/tv'
import { searchProgrammes } from './search'

function programme(
  id: string,
  title: string,
  start: string,
  extra: Partial<TVProgramme> = {},
): TVProgramme {
  return {
    id,
    channelId: 'tf1.fr',
    start,
    end: new Date(new Date(start).getTime() + 60 * 60_000).toISOString(),
    title,
    durationMinutes: 60,
    ...extra,
  }
}

describe('programme search', () => {
  const programmes = [
    programme('category', 'Une émission', '2026-10-27T18:00:00.000Z', {
      category: 'Cinéma',
      categories: ['Cinéma'],
    }),
    programme('actor', 'Un autre programme', '2026-10-27T17:00:00.000Z', {
      credits: { actors: [{ name: 'Jean Dupont' }] },
    }),
    programme('later-title', 'Jean Dupont enquête', '2026-10-27T20:00:00.000Z'),
    programme('earlier-title', 'Jean Dupont au cinéma', '2026-10-27T16:00:00.000Z'),
  ]

  it('requires at least three characters and ignores accents and case', () => {
    expect(searchProgrammes(programmes, 'éé')).toEqual([])
    expect(searchProgrammes(programmes, 'CIN')).toHaveLength(2)
  })

  it('ranks title before actors and category, then orders by broadcast time', () => {
    expect(searchProgrammes(programmes, 'jean').map(({ programme }) => programme.id)).toEqual([
      'earlier-title',
      'later-title',
      'actor',
    ])
    expect(searchProgrammes(programmes, 'cin').map(({ programme }) => programme.id)).toEqual([
      'earlier-title',
      'category',
    ])
  })
})
