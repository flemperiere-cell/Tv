import type { EpgData } from '../../models/tv'

export const EPG_URL = import.meta.env.VITE_EPG_URL || 'https://xmltvfr.fr/xmltv/xmltv.xml.gz'

type EpgWorkerResult = {
  channels: EpgData['channels']
  programmes: EpgData['programmes']
  etag?: string
  lastModified?: string
}
type EpgWorkerMessage = EpgWorkerResult | { error: string }

export async function fetchEpg(signal?: AbortSignal): Promise<EpgData> {
  if (signal?.aborted) throw signal.reason
  const worker = new Worker(new URL('./xmltv.worker.ts', import.meta.url), { type: 'module' })
  const parsed = await new Promise<EpgWorkerResult>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Chargement annulé', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<EpgWorkerMessage>) => {
      cleanup()
      if ('error' in event.data) {
        reject(new Error(event.data.error))
        return
      }
      if (!Array.isArray(event.data.channels) || !Array.isArray(event.data.programmes)) {
        reject(new Error('Réponse de chargement EPG invalide'))
        return
      }
      resolve(event.data)
    }
    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'Impossible de charger le guide'))
    }
    worker.postMessage({ url: EPG_URL })
  })
  if (!parsed.channels.length || !parsed.programmes.length)
    throw new Error('Le guide reçu ne contient aucun programme TNT valide')
  return {
    channels: parsed.channels,
    programmes: parsed.programmes,
    source: 'XML TV Fr — guide complet',
    fetchedAt: new Date().toISOString(),
    etag: parsed.etag,
    lastModified: parsed.lastModified,
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
