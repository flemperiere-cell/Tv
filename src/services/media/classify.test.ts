import { describe, expect, it } from 'vitest'
import { classifyProgramme } from './classify'
import type { TVProgramme } from '../../models/tv'

const programme: TVProgramme = {
  id: 'programme',
  channelId: '6ter.fr',
  start: '2026-10-27T19:50:00.000Z',
  end: '2026-10-27T21:15:00.000Z',
  title: 'Gaston Lagaffe',
  category: 'Comédie',
  categories: ['Comédie'],
  durationMinutes: 85,
}

describe('programme media classification', () => {
  it('classifies recognized XMLTV movie and series categories', () => {
    for (const category of ['Cinema', 'Cinéma', 'Movie', 'Film Comedie', 'Telefilms']) {
      expect(classifyProgramme({ ...programme, category, categories: [category] })).toBe('movie')
    }

    for (const category of ['Series', 'Série TV', 'Série humoristique', 'Feuilleton']) {
      expect(classifyProgramme({ ...programme, category, categories: [category] })).toBe('tv')
    }
  })

  it('does not infer movie identity from genre or cinema magazine categories', () => {
    expect(
      classifyProgramme({
        ...programme,
        category: 'Divertissement',
        categories: ['Divertissement'],
      }),
    ).toBeNull()
    for (const category of ['Doc Cinéma', 'Documentaire cinéma', 'Mag Cinéma']) {
      expect(classifyProgramme({ ...programme, category, categories: [category] })).toBeNull()
    }
  })

  it('classifies a standalone comedy category as a movie, not an explicit series', () => {
    expect(classifyProgramme(programme)).toBe('movie')
    expect(
      classifyProgramme({
        ...programme,
        category: 'Comédie / Divertissement',
        categories: ['Comédie', 'Divertissement'],
      }),
    ).toBe('movie')
    expect(
      classifyProgramme({
        ...programme,
        category: 'Série comédie dramatique',
        categories: ['Série comédie dramatique'],
      }),
    ).toBe('tv')
  })
})
