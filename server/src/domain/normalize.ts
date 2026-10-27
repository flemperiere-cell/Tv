import { createHash } from 'node:crypto'
import type { ProgrammeInput } from './classify.js'

export function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\b(in[eé]dit|vf)\b/gi, ' ')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseReleaseYear(value: string | null) {
  if (!value) return null
  const yearText = value.trim().match(/^(\d{4})(?:\d{4}(?:\d{6})?)?(?:\s*[+-]\d{4})?$/)?.[1]
  if (!yearText) return null
  const year = Number(yearText)
  const currentYear = new Date().getFullYear()
  return year >= 1888 && year <= currentYear + 3 ? year : null
}

export function fingerprint(
  mediaType: 'movie' | 'tv',
  programme: ProgrammeInput,
  programmeKind: 'movie' | 'tv_movie' | 'tv_series' = mediaType === 'tv' ? 'tv_series' : 'movie',
) {
  const title = normalizeTitle(programme.title)
  const year = parseReleaseYear(programme.year)
  const value = `v2|${mediaType}|${programmeKind}|${title}|${year ?? ''}`
  return createHash('sha256').update(value).digest('hex')
}

export function episodeFingerprint(seriesFingerprint: string, programme: ProgrammeInput) {
  if (programme.season === null || programme.episode === null) return seriesFingerprint
  const value = `v1|episode|${seriesFingerprint}|${programme.season}|${programme.episode}`
  return createHash('sha256').update(value).digest('hex')
}
