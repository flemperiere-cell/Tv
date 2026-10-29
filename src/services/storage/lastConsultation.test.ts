import { beforeEach, describe, expect, it } from 'vitest'
import {
  consultationDayChanged,
  readLastConsultation,
  writeLastConsultation,
} from './lastConsultation'

describe('dernière consultation', () => {
  beforeEach(() => localStorage.clear())

  it('enregistre et recharge la date et l’heure', () => {
    const date = new Date('2026-10-29T18:42:00.000Z')
    writeLastConsultation(date)
    expect(readLastConsultation()?.toISOString()).toBe(date.toISOString())
  })

  it('détecte un changement de jour local', () => {
    const previous = new Date('2026-10-29T22:59:00.000Z')
    const current = new Date('2026-10-29T23:01:00.000Z')
    expect(consultationDayChanged(previous, current)).toBe(true)
  })

  it('ne considère pas une première consultation comme un changement de jour', () => {
    expect(consultationDayChanged(undefined, new Date())).toBe(false)
  })
})
