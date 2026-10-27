import type { TVProgramme } from '../models/tv'

export const TZ = 'Europe/Paris'
const dateKeyFormatter = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function programmeProgress(programme: TVProgramme, now = new Date()) {
  const start = new Date(programme.start).getTime()
  const end = new Date(programme.end).getTime()
  const current = now.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || current < start)
    return { status: 'upcoming' as const, progress: 0 }
  if (current >= end) return { status: 'ended' as const, progress: 100 }
  return {
    status: 'current' as const,
    progress: ((current - start) / (end - start)) * 100,
  }
}

export function shouldDefaultToPrime(now = new Date()) {
  return now.getHours() > 19 || (now.getHours() === 19 && now.getMinutes() >= 30)
}

export function dateKey(d: Date) {
  return dateKeyFormatter.format(d)
}
export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function labelDay(d: Date, now = new Date()) {
  const diff = Math.round(
    (new Date(`${dateKey(d)}T12:00:00`).getTime() -
      new Date(`${dateKey(now)}T12:00:00`).getTime()) /
      86400000,
  )
  if (diff === -1) return 'Hier'
  if (diff === 0) return 'Aujourd’hui'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  })
    .format(d)
    .replace(/^./, (c) => c.toUpperCase())
}
export function timeLabel(iso: string) {
  const { hour, minute } = programmeTime(iso)
  return `${hour}h${minute}`
}

export function programmeTime(iso: string) {
  const parts = timeFormatter.formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  const hour = String(value('hour')).padStart(2, '0')
  const minute = String(value('minute')).padStart(2, '0')
  return { hour, minute, minutes: Number(hour) * 60 + Number(minute) }
}

export function localMinutes(iso: string) {
  return programmeTime(iso).minutes
}

function programmeAt(items: TVProgramme[], target: Date) {
  return items.find((p) => new Date(p.start) <= target && target < new Date(p.end))
}

function parisDateTime(day: string, minutes: number) {
  const [year, month, date] = day.split('-').map(Number)
  const nominalUtc = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60)
  let result = new Date(nominalUtc)
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(result)
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value)
    const displayedAsUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
    )
    result = new Date(result.getTime() + nominalUtc - displayedAsUtc)
  }
  return result
}

export function choosePrimeProgramme(items: TVProgramme[], day: string) {
  const reference = 21 * 60 + 10
  const candidates = items.filter(
    (p) =>
      dateKey(new Date(p.start)) === day &&
      localMinutes(p.start) >= 20 * 60 + 30 &&
      localMinutes(p.start) <= 21 * 60 + 30,
  )
  const long = candidates.filter((p) => (p.durationMinutes ?? 0) >= 45)
  const preferred = long.length ? long : candidates
  if (preferred.length)
    return preferred.reduce((best, p) =>
      Math.abs(localMinutes(p.start) - reference) < Math.abs(localMinutes(best.start) - reference)
        ? p
        : best,
    )
  return programmeAt(items, parisDateTime(day, reference))
}

export function chooseProgramme(
  items: TVProgramme[],
  day: string,
  mode: 'now' | 'prime',
  now = new Date(),
) {
  if (mode === 'prime') return choosePrimeProgramme(items, day)
  return programmeAt(items, day === dateKey(now) ? now : parisDateTime(day, 15 * 60))
}
