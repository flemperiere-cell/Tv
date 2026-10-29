import { dateKey } from '../../utils/dates'

const KEY = 'mon-guide-tv-last-consultation'

export function readLastConsultation() {
  try {
    const value = localStorage.getItem(KEY)
    if (!value) return undefined
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  } catch {
    return undefined
  }
}

export function writeLastConsultation(date = new Date()) {
  try {
    localStorage.setItem(KEY, date.toISOString())
  } catch {
    // L'application reste utilisable si le stockage local est indisponible.
  }
}

export function consultationDayChanged(previous: Date | undefined, current: Date) {
  return previous !== undefined && dateKey(previous) !== dateKey(current)
}
