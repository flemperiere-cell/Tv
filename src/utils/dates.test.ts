import { describe, expect, it } from 'vitest'
import type { TVProgramme } from '../models/tv'
import {
  choosePrimeProgramme,
  chooseProgramme,
  dateKey,
  programmeProgress,
  shouldDefaultToPrime,
} from './dates'

const p = (start: string, end: string, title = 'Test'): TVProgramme => ({
  id: `${start}-${title}`,
  channelId: 'TF1.fr',
  start,
  end,
  title,
  durationMinutes: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
})

describe('sélection temporelle', () => {
  it('sélectionne début inclus et fin exclue pour Maintenant', () => {
    const xs = [p('2026-10-26T19:50:00Z', '2026-10-26T21:00:00Z')]
    expect(chooseProgramme(xs, '2026-10-26', 'now', new Date('2026-10-26T20:59:59Z'))).toBe(xs[0])
    expect(
      chooseProgramme(xs, '2026-10-26', 'now', new Date('2026-10-26T21:00:00Z')),
    ).toBeUndefined()
  })

  it('préfère un programme long à la météo précédant le prime', () => {
    const weather = p('2026-10-26T19:55:00Z', '2026-10-26T20:10:00Z', 'Météo') // 20 h 55 Paris
    const movie = p('2026-10-26T20:10:00Z', '2026-10-26T22:10:00Z', 'Film') // 21 h 10 Paris
    expect(choosePrimeProgramme([weather, movie], '2026-10-26')).toBe(movie)
  })

  it('choisit parmi les programmes courts si aucun long ne correspond', () => {
    const early = p('2026-10-26T19:50:00Z', '2026-10-26T20:10:00Z', 'Court 1')
    const close = p('2026-10-26T20:05:00Z', '2026-10-26T20:35:00Z', 'Court 2')
    expect(choosePrimeProgramme([early, close], '2026-10-26')).toBe(close)
  })

  it('se replie sur le programme diffusé à 21 h 10', () => {
    const longRunning = p('2026-10-26T19:20:00Z', '2026-10-26T21:00:00Z', 'Direct') // débute à 20 h 20
    expect(choosePrimeProgramme([longRunning], '2026-10-26')).toBe(longRunning)
  })

  it('retourne undefined si le programme du soir est indisponible', () => {
    expect(choosePrimeProgramme([], '2026-10-26')).toBeUndefined()
  })

  it('formate la date dans Europe/Paris', () => {
    expect(dateKey(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26')
  })

  it('active Ce soir à partir de 19 h 30 heure locale', () => {
    expect(shouldDefaultToPrime(new Date(2026, 9, 26, 19, 29))).toBe(false)
    expect(shouldDefaultToPrime(new Date(2026, 9, 26, 19, 30))).toBe(true)
    expect(shouldDefaultToPrime(new Date(2026, 9, 26, 23, 0))).toBe(true)
  })

  it('calcule la progression et les états passé, en cours et à venir', () => {
    const programme = p('2026-10-26T20:00:00Z', '2026-10-26T22:00:00Z')

    expect(programmeProgress(programme, new Date('2026-10-26T19:59:59Z'))).toEqual({
      status: 'upcoming',
      progress: 0,
    })
    expect(programmeProgress(programme, new Date('2026-10-26T21:00:00Z'))).toEqual({
      status: 'current',
      progress: 50,
    })
    expect(programmeProgress(programme, new Date('2026-10-26T22:00:00Z'))).toEqual({
      status: 'ended',
      progress: 100,
    })
  })
})
