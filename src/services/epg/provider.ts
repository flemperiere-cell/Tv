import type { EpgData } from '../../models/tv'
import { parseXmltvGzipStream } from './xmltv'

export const EPG_URL = import.meta.env.VITE_EPG_URL || 'https://xmltvfr.fr/xmltv/xmltv.xml.gz'

export async function fetchEpg(signal?: AbortSignal): Promise<EpgData> {
  const response = await fetch(EPG_URL, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error(`Source EPG indisponible (${response.status})`)
  const parsed = await parseXmltvGzipStream(response)
  if (!parsed.channels.length || !parsed.programmes.length)
    throw new Error('Le guide reçu ne contient aucun programme TNT valide')
  return {
    ...parsed,
    source: 'XML TV Fr — guide complet',
    fetchedAt: new Date().toISOString(),
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    periodStart: parsed.programmes[0]?.start,
    periodEnd: parsed.programmes.at(-1)?.end,
  }
}

export async function sourceChanged(lastModified?: string) {
  if (!lastModified) return false
  try {
    const response = await fetch(EPG_URL, { method: 'HEAD', cache: 'no-store' })
    if (!response.ok) return false
    const current = response.headers.get('last-modified')
    return !!current && current !== lastModified
  } catch {
    return false
  }
}
