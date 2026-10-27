import type { Channel } from '../../models/tv'
export interface Preferences {
  schemaVersion: 1
  favoriteChannels: string[]
  selectedChannels: string[]
  favoriteOrder: string[]
  defaultView: 'favorites' | 'all'
  primeTime: string
  theme: 'dark'
  cacheEnabled: boolean
}
const KEY = 'mon-guide-tv-preferences'
export const defaults: Preferences = {
  schemaVersion: 1,
  favoriteChannels: ['Arte.fr', 'France2.fr', 'TF1.fr', 'M6.fr'],
  selectedChannels: [],
  favoriteOrder: ['Arte.fr', 'France2.fr', 'TF1.fr', 'M6.fr'],
  defaultView: 'favorites',
  primeTime: '21:10',
  theme: 'dark',
  cacheEnabled: true,
}
export function validPreferences(v: unknown): v is Preferences {
  if (!v || typeof v !== 'object') return false
  const x = v as Partial<Preferences>
  return (
    x.schemaVersion === 1 &&
    Array.isArray(x.favoriteChannels) &&
    x.favoriteChannels.every((i) => typeof i === 'string') &&
    Array.isArray(x.selectedChannels) &&
    x.selectedChannels.every((i) => typeof i === 'string') &&
    Array.isArray(x.favoriteOrder) &&
    ['favorites', 'all'].includes(x.defaultView || '') &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(x.primeTime || '') &&
    typeof x.cacheEnabled === 'boolean'
  )
}
export function loadPreferences(): Preferences {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return validPreferences(v) ? v : defaults
  } catch {
    return defaults
  }
}
export function savePreferences(v: Preferences) {
  localStorage.setItem(KEY, JSON.stringify(v))
}
export function normalizePreferences(v: Preferences, channels: Channel[]): Preferences {
  const ids = channels.map((c) => c.id),
    selected = v.selectedChannels.length ? v.selectedChannels.filter((x) => ids.includes(x)) : ids
  const fav = v.favoriteChannels.filter((x) => ids.includes(x))
  return {
    ...v,
    primeTime: '21:10',
    selectedChannels: selected,
    favoriteChannels: fav,
    favoriteOrder: [
      ...v.favoriteOrder.filter((x) => fav.includes(x)),
      ...fav.filter((x) => !v.favoriteOrder.includes(x)),
    ],
  }
}
export function exportPreferences(v: Preferences) {
  const blob = new Blob([JSON.stringify(v, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = `mon-guide-tv-preferences-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
