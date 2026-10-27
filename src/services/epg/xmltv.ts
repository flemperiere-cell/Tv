import type { Channel, ProgrammeCredits, TVProgramme } from '../../models/tv'
import { SaxesParser, type SaxesTagPlain } from 'saxes'

export const TNT_NUMBERS: Record<string, number> = {
  'TF1.fr': 1,
  'France2.fr': 2,
  'France3.fr': 3,
  'CanalPlus.fr': 4,
  'France5.fr': 5,
  'M6.fr': 6,
  'Arte.fr': 7,
  'LCP.fr': 8,
  'LaChaineParlementaire.fr': 8,
  'W9.fr': 9,
  'TMC.fr': 10,
  'NT1.fr': 11,
  'Gulli.fr': 12,
  'BFMTV.fr': 13,
  'CNews.fr': 14,
  'LCI.fr': 15,
  'FranceInfo.fr': 16,
  'T18.fr': 18,
  'NOVO19.fr': 19,
  'TF1SeriesFilms.fr': 20,
  'LEquipe21.fr': 21,
  '6ter.fr': 22,
  'Numero23.fr': 23,
  'RMCDecouverte.fr': 24,
  'Cherie25.fr': 25,
}

export function parseXmltvDate(value: string): Date {
  const m = value
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])(\d{2})(\d{2})$/)
  if (!m) throw new Error(`Date XMLTV invalide : ${value}`)
  const [, y, mo, d, h, mi, s, sign, oh, om] = m
  const offset = (Number(oh) * 60 + Number(om)) * (sign === '+' ? 1 : -1)
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offset * 60000)
}

function text(el: Element, selector: string) {
  return el.querySelector(selector)?.textContent?.trim() || undefined
}
function episode(el: Element) {
  const raw = Array.from(el.querySelectorAll('episode-num')).find(
    (x) => x.getAttribute('system') === 'xmltv_ns',
  )?.textContent
  if (!raw) return {}
  const [s, e] = raw.split('.')
  return {
    season: s && Number.isFinite(+s) ? +s + 1 : undefined,
    episode: e && Number.isFinite(+e) ? +e + 1 : undefined,
  }
}
function texts(el: Element, selector: string) {
  const values = Array.from(el.querySelectorAll(selector))
    .map((node) => node.textContent?.trim())
    .filter((value): value is string => !!value)
  return values.length ? values : undefined
}
function parseLengthMinutes(value: string | undefined, units: string | undefined) {
  const length = Number(value)
  if (!Number.isFinite(length) || length <= 0) return undefined
  const unit = units?.toLocaleLowerCase('en')
  const minutes = unit === 'seconds' ? length / 60 : unit === 'hours' ? length * 60 : length
  return Math.max(1, Math.round(minutes))
}
function credits(el: Element): ProgrammeCredits | undefined {
  const root = el.querySelector('credits')
  if (!root) return undefined
  const actors = Array.from(root.querySelectorAll('actor'))
    .map((node) => ({
      name: node.textContent?.trim() || '',
      role: node.getAttribute('role')?.trim() || undefined,
    }))
    .filter((actor) => actor.name)
  const result: ProgrammeCredits = {
    directors: texts(root, 'director'),
    actors: actors.length ? actors : undefined,
    presenters: texts(root, 'presenter'),
    writers: texts(root, 'writer'),
    producers: texts(root, 'producer'),
    composers: texts(root, 'composer'),
    editors: texts(root, 'editor'),
    adapters: texts(root, 'adapter'),
    commentators: texts(root, 'commentator'),
    guests: texts(root, 'guest'),
  }
  return Object.values(result).some(Boolean) ? result : undefined
}
function stableId(channelId: string, start: string, title: string) {
  let h = 2166136261
  for (const c of `${channelId}|${start}|${title}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return `${channelId}-${(h >>> 0).toString(36)}`
}

function secureImageUrl(url: string | null | undefined) {
  return url?.replace(/^http:/i, 'https:') || undefined
}

export function parseXmltv(xml: string): { channels: Channel[]; programmes: TVProgramme[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const error = doc.querySelector('parsererror')
  if (error) throw new Error('Le fichier reçu n’est pas un XMLTV valide')
  const channels = Array.from(doc.querySelectorAll('tv > channel'))
    .map((el) => ({
      id: el.id,
      name: text(el, 'display-name') || el.id,
      icon: secureImageUrl(el.querySelector('icon')?.getAttribute('src')),
      number: TNT_NUMBERS[el.id],
    }))
    .filter((c) => c.number)
    .sort((a, b) => (a.number || 99) - (b.number || 99))
  const valid = new Set(channels.map((c) => c.id))
  const programmes: Array<TVProgramme> = []
  for (const el of doc.querySelectorAll('tv > programme')) {
    try {
      const channelId = el.getAttribute('channel') || ''
      if (!valid.has(channelId)) continue
      const title = text(el, 'title')
      const startRaw = el.getAttribute('start')
      const endRaw = el.getAttribute('stop')
      if (!title || !startRaw || !endRaw) continue
      const start = parseXmltvDate(startRaw),
        end = parseXmltvDate(endRaw)
      if (end <= start) continue
      const ep = episode(el)
      const rating = el.querySelector('rating')
      programmes.push({
        id: stableId(channelId, start.toISOString(), title),
        channelId,
        start: start.toISOString(),
        end: end.toISOString(),
        title,
        subtitle: text(el, 'sub-title'),
        description: text(el, 'desc'),
        category: text(el, 'category'),
        categories: texts(el, 'category'),
        durationMinutes:
          parseLengthMinutes(
            text(el, 'length'),
            el.querySelector('length')?.getAttribute('units') ?? undefined,
          ) ?? Math.round((+end - +start) / 60000),
        xmltvLengthMinutes: parseLengthMinutes(
          text(el, 'length'),
          el.querySelector('length')?.getAttribute('units') ?? undefined,
        ),
        imageUrl: el
          .querySelector('icon')
          ?.getAttribute('src')
          ?.replace(/^http:/, 'https:'),
        isNew: !!el.querySelector('new'),
        isLive: /direct/i.test(text(el, 'category') || '') || /direct/i.test(title),
        credits: credits(el),
        year: text(el, 'date'),
        countries: texts(el, 'country'),
        rating: text(el, 'rating > value'),
        ratingSystem: rating?.getAttribute('system') || undefined,
        starRating: text(el, 'star-rating > value'),
        ...ep,
      })
    } catch {
      /* ignore malformed entries */
    }
  }
  programmes.sort((a, b) => a.start.localeCompare(b.start))
  return { channels, programmes }
}

export async function decodeGzip(response: Response): Promise<string> {
  if (!response.body) throw new Error('Réponse EPG vide')
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Ce navigateur ne prend pas en charge la décompression GZIP')
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

interface StreamingProgramme {
  channelId: string
  startRaw: string
  endRaw: string
  title?: string
  subtitle?: string
  description?: string
  categories: string[]
  length?: string
  lengthUnits?: string
  imageUrl?: string
  episodeRaw?: string
  episodeSystem?: string
  isNew?: boolean
  credits: ProgrammeCredits
  year?: string
  countries: string[]
  rating?: string
  ratingSystem?: string
  starRating?: string
}

const attr = (tag: SaxesTagPlain, name: string) => {
  const value = tag.attributes[name]
  return typeof value === 'string' ? value : undefined
}

function mergeProgramme(target: TVProgramme, source: TVProgramme) {
  if (source.credits) target.credits = source.credits
  if (source.year) target.year = source.year
  if (source.countries?.length) target.countries = source.countries
  if (source.rating) target.rating = source.rating
  if (source.ratingSystem) target.ratingSystem = source.ratingSystem
  if (source.starRating) target.starRating = source.starRating
  if (source.xmltvLengthMinutes) {
    target.xmltvLengthMinutes = source.xmltvLengthMinutes
    target.durationMinutes = source.xmltvLengthMinutes
  }
  if (source.categories?.length)
    target.categories = [...new Set([...(target.categories ?? []), ...source.categories])]
  if ((source.description?.length || 0) > (target.description?.length || 0))
    target.description = source.description
  if (!target.imageUrl && source.imageUrl) target.imageUrl = source.imageUrl
}

function matchKey(programme: Pick<TVProgramme, 'start' | 'end' | 'title'>) {
  return `${programme.start}|${programme.end}|${programme.title.toLocaleLowerCase('fr').replace(/\s+/g, ' ').trim()}`
}

function normalizeStreamingProgramme(raw: StreamingProgramme): TVProgramme | undefined {
  if (!raw.title || !raw.startRaw || !raw.endRaw) return undefined
  const start = parseXmltvDate(raw.startRaw),
    end = parseXmltvDate(raw.endRaw)
  if (end <= start) return undefined
  const ep =
    raw.episodeSystem === 'xmltv_ns' && raw.episodeRaw
      ? (() => {
          const [season, episodeNumber] = raw.episodeRaw!.split('.')
          return {
            season: season && Number.isFinite(+season) ? +season + 1 : undefined,
            episode:
              episodeNumber && Number.isFinite(+episodeNumber) ? +episodeNumber + 1 : undefined,
          }
        })()
      : {}
  const hasCredits = Object.values(raw.credits).some(Boolean)
  return {
    id: stableId(raw.channelId, start.toISOString(), raw.title),
    channelId: raw.channelId,
    start: start.toISOString(),
    end: end.toISOString(),
    title: raw.title,
    subtitle: raw.subtitle,
    description: raw.description,
    category: raw.categories[0],
    categories: raw.categories,
    durationMinutes:
      parseLengthMinutes(raw.length, raw.lengthUnits) ?? Math.round((+end - +start) / 60000),
    xmltvLengthMinutes: parseLengthMinutes(raw.length, raw.lengthUnits),
    imageUrl: raw.imageUrl?.replace(/^http:/, 'https:'),
    isNew: raw.isNew,
    isLive: raw.categories.some((value) => /direct/i.test(value)) || /direct/i.test(raw.title),
    credits: hasCredits ? raw.credits : undefined,
    year: raw.year,
    countries: raw.countries.length ? raw.countries : undefined,
    rating: raw.rating,
    ratingSystem: raw.ratingSystem,
    starRating: raw.starRating,
    ...ep,
  }
}

/** Parse le guide complet progressivement sans matérialiser les 125 Mo de XML dans le DOM. */
export async function parseXmltvGzipStream(
  response: Response,
): Promise<{ channels: Channel[]; programmes: TVProgramme[] }> {
  if (!response.body) throw new Error('Réponse EPG vide')
  if (typeof DecompressionStream === 'undefined')
    throw new Error('Ce navigateur ne prend pas en charge la décompression GZIP')
  const channels: Channel[] = [],
    programmes: TVProgramme[] = []
  const tntByKey = new Map<string, TVProgramme[]>(),
    pending = new Map<string, TVProgramme>()
  let channel: { id: string; name?: string; icon?: string } | undefined
  let programme: StreamingProgramme | undefined
  let openingTag: SaxesTagPlain | undefined,
    content = ''
  const stack: string[] = []
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', (tag) => {
    stack.push(tag.name)
    openingTag = tag
    content = ''
    if (tag.name === 'channel') channel = { id: attr(tag, 'id') || '' }
    if (tag.name === 'programme')
      programme = {
        channelId: attr(tag, 'channel') || '',
        startRaw: attr(tag, 'start') || '',
        endRaw: attr(tag, 'stop') || '',
        categories: [],
        countries: [],
        credits: {},
      }
    else if (tag.name === 'icon') {
      const src = attr(tag, 'src')
      if (channel && stack.at(-2) === 'channel') channel.icon = src
      if (programme && stack.at(-2) === 'programme' && !programme.imageUrl) programme.imageUrl = src
    } else if (programme && tag.name === 'length') {
      programme.lengthUnits = attr(tag, 'units')
    } else if (programme && tag.name === 'episode-num')
      programme.episodeSystem = attr(tag, 'system')
    else if (programme && tag.name === 'rating') programme.ratingSystem = attr(tag, 'system')
    else if (programme && tag.name === 'new') programme.isNew = true
  })
  parser.on('text', (value) => {
    content += value
  })
  parser.on('cdata', (value) => {
    content += value
  })
  parser.on('closetag', (tag) => {
    const value = content.trim(),
      parent = stack.at(-2)
    if (channel && parent === 'channel' && tag.name === 'display-name' && !channel.name)
      channel.name = value
    if (programme && value) {
      if (parent === 'programme') {
        if (tag.name === 'title') programme.title = value
        else if (tag.name === 'sub-title') programme.subtitle = value
        else if (tag.name === 'desc') programme.description = value
        else if (tag.name === 'category') programme.categories.push(value)
        else if (tag.name === 'length') programme.length = value
        else if (tag.name === 'date') programme.year = value
        else if (tag.name === 'country') programme.countries.push(value)
        else if (tag.name === 'episode-num') programme.episodeRaw = value
      } else if (parent === 'credits') {
        const keys: Record<string, keyof ProgrammeCredits> = {
          director: 'directors',
          presenter: 'presenters',
          writer: 'writers',
          producer: 'producers',
          composer: 'composers',
          editor: 'editors',
          adapter: 'adapters',
          commentator: 'commentators',
          guest: 'guests',
        }
        if (tag.name === 'actor') {
          const actors = programme.credits.actors || (programme.credits.actors = [])
          actors.push({
            name: value,
            role: openingTag?.name === 'actor' ? attr(openingTag, 'role') : undefined,
          })
        } else if (keys[tag.name]) {
          const key = keys[tag.name],
            list = (programme.credits[key] as string[] | undefined) || []
          list.push(value)
          ;(programme.credits[key] as string[]) = list
        }
      } else if (tag.name === 'value' && parent === 'rating') programme.rating = value
      else if (tag.name === 'value' && parent === 'star-rating') programme.starRating = value
    }
    if (tag.name === 'channel' && channel) {
      const number = TNT_NUMBERS[channel.id]
      if (number)
        channels.push({
          id: channel.id,
          name: channel.name || channel.id,
          icon: secureImageUrl(channel.icon),
          number,
        })
      channel = undefined
    }
    if (tag.name === 'programme' && programme) {
      try {
        const normalized = normalizeStreamingProgramme(programme)
        if (normalized) {
          const key = matchKey(normalized)
          if (TNT_NUMBERS[normalized.channelId]) {
            const extra = pending.get(key)
            if (extra) mergeProgramme(normalized, extra)
            programmes.push(normalized)
            const matches = tntByKey.get(key) || []
            matches.push(normalized)
            tntByKey.set(key, matches)
          } else if (
            normalized.credits ||
            normalized.year ||
            normalized.countries ||
            normalized.starRating
          ) {
            const matches = tntByKey.get(key)
            if (matches) matches.forEach((target) => mergeProgramme(target, normalized))
            else pending.set(key, normalized)
          }
        }
      } catch {
        /* entrée mal formée ignorée */
      }
      programme = undefined
    }
    stack.pop()
    openingTag = undefined
    content = ''
  })
  const stream = response.body
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parser.write(value)
  }
  parser.close()
  channels.sort((a, b) => (a.number || 99) - (b.number || 99))
  programmes.sort((a, b) => a.start.localeCompare(b.start))
  return { channels, programmes }
}
