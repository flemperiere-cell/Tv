import { createApp } from './app.js'
import { migrate } from './db/migrate.js'
import { MediaRepository } from './db/repository.js'
import { openDatabase } from './db/sqlite.js'
import { TmdbProvider } from './providers/tmdb.js'

const databasePath = process.env.DATABASE_PATH || './data/media.sqlite'
const db = openDatabase(databasePath)
migrate(db)
const repository = new MediaRepository(db)
repository.cleanupExpired()

const token = process.env.TMDB_ACCESS_TOKEN?.trim() || ''
const provider = new TmdbProvider(token, process.env.TMDB_LANGUAGE || 'fr-FR')
const app = createApp({
  repository,
  provider,
  providerConfigured: token.length > 0,
  cacheEnabled: process.env.MEDIA_CACHE_ENABLED !== 'false',
  traceTmdb: process.env.TMDB_TRACE === 'true',
  adminToken: process.env.ADMIN_TOKEN,
})

const cleanupTimer = setInterval(
  () => {
    try {
      repository.cleanupExpired()
    } catch (error) {
      app.log.error({ err: error }, 'Expired media cleanup failed')
    }
  },
  24 * 60 * 60 * 1000,
)
cleanupTimer.unref()

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  clearInterval(cleanupTimer)
  try {
    await app.close()
    db.close()
    process.exitCode = 0
  } catch (error) {
    app.log.error({ err: error }, 'Shutdown failed')
    process.exitCode = 1
  }
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

try {
  await app.listen({
    host: process.env.LISTEN_HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
  })
} catch (error) {
  app.log.error({ err: error }, 'Server startup failed')
  db.close()
  process.exitCode = 1
}
