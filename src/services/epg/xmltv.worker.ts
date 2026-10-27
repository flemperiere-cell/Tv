import { parseXmltvGzipStream } from './xmltv'

self.addEventListener('message', (event: MessageEvent<{ url: string }>) => {
  void (async () => {
    try {
      const response = await fetch(event.data.url, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Source EPG indisponible (${response.status})`)
      const parsed = await parseXmltvGzipStream(response)
      self.postMessage({
        ...parsed,
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      })
    } catch (error) {
      self.postMessage({
        error: error instanceof Error ? error.message : 'Impossible de charger le guide',
      })
    }
  })()
})
