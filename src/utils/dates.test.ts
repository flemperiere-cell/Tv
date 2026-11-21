import { describe, expect, it } from 'vitest'
import type { TVProgramme } from '../models/tv'
import {
  choosePrimeProgramme,
  chooseProgramme,
  dateKey,
  programmeProgress,
  programmeStartedYesterday,
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

  it('choisit le début le plus proche de 21 h 10, sans préférence de durée', () => {
    const short = p('2026-10-26T20:10:00Z', '2026-10-26T20:25:00Z', 'Court') // 21 h 10 Paris
    const long = p('2026-10-26T20:20:00Z', '2026-10-26T22:20:00Z', 'Long') // 21 h 20 Paris
    expect(choosePrimeProgramme([short, long], '2026-10-26')).toBe(short)
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

  it('identifie un programme commencé la veille en heure de Paris', () => {
    const now = new Date('2026-11-05T23:05:00.000Z')
    const ongoingFromYesterday = p('2026-11-05T21:30:00.000Z', '2026-11-05T23:30:00.000Z')
    const endedYesterday = p('2026-11-05T20:00:00.000Z', '2026-11-05T21:00:00.000Z')
    const startsToday = p('2026-11-05T23:30:00.000Z', '2026-11-06T00:30:00.000Z')

    expect(programmeStartedYesterday(ongoingFromYesterday, now)).toBe(true)
    expect(programmeStartedYesterday(endedYesterday, now)).toBe(false)
    expect(programmeStartedYesterday(startsToday, now)).toBe(false)
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
