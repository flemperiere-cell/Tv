import { describe, expect, it } from 'vitest'
import {
  defaults,
  loadPreferences,
  normalizePreferences,
  savePreferences,
  validPreferences,
} from './preferences'

describe('préférences', () => {
  it('revient aux valeurs sûres pour une donnée corrompue', () => {
    localStorage.setItem('mon-guide-tv-preferences', '{')
    expect(loadPreferences()).toEqual(defaults)
  })

  it('sauvegarde et recharge', () => {
    savePreferences(defaults)
    expect(loadPreferences()).toEqual(defaults)
  })

  it('valide strictement le schéma', () => {
    expect(validPreferences(defaults)).toBe(true)
    expect(validPreferences({ ...defaults, primeTime: '99:00' })).toBe(false)
  })

  it('sélectionne par défaut les chaînes du bouquet TNT et retire les chaînes disparues', () => {
    const channels = [
      { id: 'TF1.fr', name: 'TF1', number: 1 },
      { id: 'Arte.fr', name: 'Arte', number: 7 },
      { id: 'France24.fr', name: 'France 24' },
    ]
    const p = normalizePreferences(
      {
        ...defaults,
        selectedChannels: [],
        favoriteChannels: ['TF1.fr', 'old'],
        favoriteOrder: ['old', 'TF1.fr'],
      },
      channels,
    )
    expect(p.selectedChannels).toEqual(['TF1.fr', 'Arte.fr'])
    expect(p.favoriteOrder).toEqual(['TF1.fr'])
  })
})
