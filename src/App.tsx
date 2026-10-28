import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { Channel, EpgData, GuideMode, TVProgramme } from './models/tv'
import { Details } from './components/Details'
import { fetchEpg, sourceChanged } from './services/epg/provider'
import { clearCache, isFresh, readCache, writeCache } from './services/storage/cache'
import {
  defaults,
  exportPreferences,
  loadPreferences,
  normalizePreferences,
  savePreferences,
  validPreferences,
  type Preferences,
} from './services/preferences/preferences'
import {
  addDays,
  chooseProgramme,
  dateKey,
  labelDay,
  localMinutes,
  programmeProgress,
  programmeTime,
  shouldDefaultToPrime,
  timeLabel,
} from './utils/dates'
import { searchProgrammes } from './utils/search'

type View = 'favorites' | 'all' | 'settings' | 'about'
type GuideScreen = 'guide' | 'grid'
const DETAIL_HISTORY_KEY = 'monGuideTvProgrammeId'
const today = () => dateKey(new Date())

function ProgrammeRow({
  channel,
  programme,
  clock,
  favorite,
  toggle,
  onOpen,
  date,
}: {
  channel: Channel
  programme?: TVProgramme
  clock: Date
  favorite: boolean
  toggle: () => void
  onOpen: (p: TVProgramme) => void
  date?: string
}) {
  const [broken, setBroken] = useState(false)
  const progress = programme ? programmeProgress(programme, clock) : undefined
  return (
    <article className="programme-row">
      <div className="channel-cell">
        <span className="channel-number">{channel.number}</span>
        {channel.icon && !broken ? (
          <img src={channel.icon} alt={channel.name} onError={() => setBroken(true)} />
        ) : (
          <b>{channel.name.slice(0, 5)}</b>
        )}
        <button
          className={`star ${favorite ? 'active' : ''}`}
          onClick={toggle}
          aria-label={`${favorite ? 'Retirer' : 'Ajouter'} ${channel.name} ${favorite ? 'des' : 'aux'} favoris`}
          aria-pressed={favorite}
        >
          ★
        </button>
      </div>
      {programme ? (
        <button
          className="programme-main"
          onClick={() => onOpen(programme)}
          aria-label={`Détails de ${programme.title}`}
        >
          <span className="time">
            {date && <span className="programme-date">{date}</span>}
            <span>{timeLabel(programme.start)}</span>
          </span>
          <strong>{programme.title}</strong>
          {programme.subtitle && <span className="subtitle">{programme.subtitle}</span>}
          <span className="meta">
            {[
              `${programme.durationMinutes} min`,
              programme.category,
              programme.season &&
                `S${String(programme.season).padStart(2, '0')}${programme.episode ? `E${String(programme.episode).padStart(2, '0')}` : ''}`,
              programme.isNew && 'Inédit',
              programme.isLive && 'Direct',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {progress?.status === 'current' && (
            <span className="programme-progress" aria-hidden="true">
              <span style={{ width: `${progress.progress}%` }} />
            </span>
          )}
        </button>
      ) : (
        <div className="programme-main empty">Programme indisponible</div>
      )}
      <button
        className="thumb"
        disabled={!programme}
        onClick={() => programme && onOpen(programme)}
        aria-label={programme ? `Voir ${programme.title}` : 'Aucune image'}
      >
        {programme?.imageUrl ? (
          <img
            src={programme.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span>TV</span>
        )}
      </button>
    </article>
  )
}

function GridChannelLogo({ channel }: { channel: Channel }) {
  const [broken, setBroken] = useState(false)
  return channel.icon && !broken ? (
    <img src={channel.icon} alt="" onError={() => setBroken(true)} />
  ) : (
    <span className="grid-channel-fallback">{channel.name.slice(0, 5)}</span>
  )
}

function Settings({
  prefs,
  setPrefs,
  channels,
  fetchedAt,
  onClose,
  onAbout,
}: {
  prefs: Preferences
  setPrefs: (p: Preferences) => void
  channels: Channel[]
  fetchedAt?: string
  onClose: () => void
  onAbout: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const toggle = (id: string) =>
    setPrefs({
      ...prefs,
      selectedChannels: prefs.selectedChannels.includes(id)
        ? prefs.selectedChannels.filter((x) => x !== id)
        : [...prefs.selectedChannels, id],
    })
  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const v = JSON.parse(await f.text())
      if (!validPreferences(v)) throw new Error()
      if (confirm('Remplacer vos préférences actuelles ?'))
        setPrefs(normalizePreferences(v, channels))
    } catch {
      alert('Ce fichier de préférences est invalide.')
    }
    e.target.value = ''
  }
  return (
    <main className="settings">
      <button className="back" onClick={onClose}>
        ← Retour au guide
      </button>
      <h2>Choisir mes chaînes</h2>
      <p className="muted">Les réglages sont enregistrés uniquement sur cet appareil.</p>
      <div className="channel-list">
        {channels.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={prefs.selectedChannels.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span>
              {c.number}. {c.name}
            </span>
          </label>
        ))}
      </div>
      <h2>Réglages</h2>
      <p className="muted">
        {fetchedAt
          ? `Guide XMLTV mis à jour le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fetchedAt))}`
          : 'Aucune donnée XMLTV chargée.'}
      </p>
      <label className="field check">
        <input
          type="checkbox"
          checked={prefs.cacheEnabled}
          onChange={async (e) => {
            setPrefs({ ...prefs, cacheEnabled: e.target.checked })
            if (!e.target.checked) await clearCache()
          }}
        />{' '}
        Cache EPG pendant 24 h
      </label>
      <div className="settings-actions">
        <button onClick={() => exportPreferences(prefs)}>Exporter mes préférences</button>
        <button onClick={() => file.current?.click()}>Importer mes préférences</button>
        <input
          ref={file}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={importFile}
        />
        <button
          className="danger"
          onClick={() =>
            confirm('Réinitialiser toutes vos préférences ?') &&
            setPrefs(normalizePreferences(defaults, channels))
          }
        >
          Réinitialiser
        </button>
      </div>
      <h2>À propos</h2>
      <button className="about-link" onClick={onAbout}>
        Informations et attribution des données
      </button>
    </main>
  )
}

function About({ onClose }: { onClose: () => void }) {
  return (
    <main className="settings about-page">
      <button className="back" onClick={onClose}>
        ← Retour aux réglages
      </button>
      <h2>À propos de Mon Guide TV</h2>
      <p className="muted">
        Les horaires et informations de diffusion sont fournis par le guide XMLTV configuré sur cet
        appareil. Les compléments de films et séries sont obtenus à la demande auprès de TMDB.
      </p>
      <p className="tmdb-attribution about-attribution">
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">
          TMDB
        </a>
        <span>Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</span>
      </p>
      <p className="muted">
        Mon Guide TV n’est affilié ni à TMDB ni aux chaînes. Les données et images restent soumises
        aux conditions de leurs fournisseurs respectifs.
      </p>
    </main>
  )
}

export default function App() {
  const [data, setData] = useState<EpgData>()
  const [prefs, setPrefsState] = useState(loadPreferences)
  const [view, setView] = useState<View>(() => loadPreferences().defaultView)
  const [screen, setScreen] = useState<GuideScreen>('guide')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isNavigationPending, startNavigationTransition] = useTransition()
  const [mode, setMode] = useState<GuideMode>(() => (shouldDefaultToPrime() ? 'prime' : 'now'))
  const [gridScrollRequest, setGridScrollRequest] = useState(0)
  const [day, setDay] = useState(today)
  const [clock, setClock] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [selected, setSelected] = useState<TVProgramme>()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const request = useRef<Promise<void> | undefined>(undefined)
  const gridScroller = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const gridInitialPosition = useRef(true)
  useEffect(() => {
    const updateClock = () => setClock(new Date())
    const updateClockWhenVisible = () => {
      if (document.visibilityState === 'visible') updateClock()
    }
    const timer = window.setInterval(updateClock, 30_000)
    document.addEventListener('visibilitychange', updateClockWhenVisible)
    window.addEventListener('focus', updateClock)
    window.addEventListener('pageshow', updateClock)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', updateClockWhenVisible)
      window.removeEventListener('focus', updateClock)
      window.removeEventListener('pageshow', updateClock)
    }
  }, [])
  const setPrefs = (p: Preferences) => {
    setPrefsState(p)
    savePreferences(p)
  }
  const load = async (force = false) => {
    if (request.current) return request.current
    const run = (async () => {
      if (force) setRefreshing(true)
      else setLoading(true)
      setError('')
      const cached = await readCache()
      if (cached) setData(cached)
      if (cached && !force && prefs.cacheEnabled && isFresh(cached)) {
        if (!(await sourceChanged(cached.lastModified))) {
          setLoading(false)
          return
        }
      }
      try {
        const fresh = await fetchEpg()
        setData(fresh)
        if (prefs.cacheEnabled) await writeCache(fresh)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Impossible de charger les programmes')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    })()
    request.current = run.finally(() => {
      request.current = undefined
    })
    return request.current
  }
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])
  useEffect(() => {
    const online = () => setOffline(false),
      off = () => setOffline(true),
      up = () => setUpdateReady(true)
    addEventListener('online', online)
    addEventListener('offline', off)
    addEventListener('pwa-update', up)
    return () => {
      removeEventListener('online', online)
      removeEventListener('offline', off)
      removeEventListener('pwa-update', up)
    }
  }, [])
  useEffect(() => {
    if (data) {
      const n = normalizePreferences(prefs, data.channels)
      if (JSON.stringify(n) !== JSON.stringify(prefs)) setPrefs(n)
    }
  }, [data])
  useEffect(() => {
    const syncSelectedProgramme = (event?: PopStateEvent) => {
      const state = event ? event.state : history.state
      const programmeId =
        state && typeof state === 'object'
          ? (state as Record<string, unknown>)[DETAIL_HISTORY_KEY]
          : undefined
      setSelected(
        typeof programmeId === 'string'
          ? data?.programmes.find((programme) => programme.id === programmeId)
          : undefined,
      )
    }
    syncSelectedProgramme()
    const onPopState = (event: PopStateEvent) => syncSelectedProgramme(event)
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [data])
  const openDetails = (programme: TVProgramme) => {
    history.pushState({ ...history.state, [DETAIL_HISTORY_KEY]: programme.id }, '')
    setScheduleOpen(false)
    setSelected(programme)
  }
  const selectDetailsProgramme = (programme: TVProgramme) => {
    history.replaceState({ ...history.state, [DETAIL_HISTORY_KEY]: programme.id }, '')
    setScheduleOpen(false)
    setSelected(programme)
  }
  const closeDetails = () => {
    if (history.state?.[DETAIL_HISTORY_KEY] === selected?.id) history.back()
    else setSelected(undefined)
  }
  useEffect(() => {
    if (screen !== 'grid') {
      gridInitialPosition.current = true
      return
    }
    if (!data) return
    gridInitialPosition.current = false
    gridScroller.current?.querySelectorAll<HTMLElement>('.grid-lane').forEach((lane) => {
      const target = lane.querySelector<HTMLElement>('[data-scroll-target="true"]')
      const paddingTop = Number.parseFloat(getComputedStyle(lane).paddingTop) || 0
      lane.scrollTo({
        top: target
          ? lane.scrollTop +
            target.getBoundingClientRect().top -
            lane.getBoundingClientRect().top -
            lane.clientTop -
            paddingTop
          : 0,
        behavior: 'auto',
      })
    })
  }, [
    screen,
    day,
    mode,
    gridScrollRequest,
    data,
    view,
    prefs.selectedChannels,
    prefs.favoriteChannels,
  ])
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 1)).filter(
        (d) =>
          !data?.periodStart ||
          !data.periodEnd ||
          (d >= addDays(new Date(data.periodStart), -1) && d <= new Date(data.periodEnd)),
      ),
    [data],
  )
  const visibleChannels = useMemo(() => {
    if (!data) return []
    const c = data.channels.filter((x) => prefs.selectedChannels.includes(x.id))
    return (view === 'favorites' ? c.filter((x) => prefs.favoriteChannels.includes(x.id)) : c).sort(
      (a, b) => (a.number ?? 999) - (b.number ?? 999),
    )
  }, [data, prefs, view])
  const programmesByChannel = useMemo(() => {
    const m = new Map<string, TVProgramme[]>()
    for (const p of data?.programmes || []) {
      const a = m.get(p.channelId) || []
      a.push(p)
      m.set(p.channelId, a)
    }
    return m
  }, [data])
  const channelsById = useMemo(
    () => new Map((data?.channels ?? []).map((channel) => [channel.id, channel])),
    [data],
  )
  const searchResults = useMemo(
    () => searchProgrammes(data?.programmes ?? [], searchQuery),
    [data, searchQuery],
  )
  const gridProgrammesByChannel = useMemo(() => {
    const programmes = new Map<
      string,
      Array<{ programme: TVProgramme; startMinute: number; time: string }>
    >()
    for (const programme of data?.programmes ?? []) {
      if (dateKey(new Date(programme.start)) !== day) continue
      const entries = programmes.get(programme.channelId) ?? []
      entries.push({
        programme,
        startMinute: programmeTime(programme.start).minutes,
        time: timeLabel(programme.start),
      })
      programmes.set(programme.channelId, entries)
    }
    for (const entries of programmes.values())
      entries.sort((a, b) => a.programme.start.localeCompare(b.programme.start))
    return programmes
  }, [data, day])
  const toggleFavorite = (id: string) => {
    const has = prefs.favoriteChannels.includes(id)
    setPrefs({
      ...prefs,
      favoriteChannels: has
        ? prefs.favoriteChannels.filter((x) => x !== id)
        : [...prefs.favoriteChannels, id],
      favoriteOrder: has
        ? prefs.favoriteOrder.filter((x) => x !== id)
        : [...prefs.favoriteOrder, id],
    })
  }
  const setGuideView = (nextView: 'favorites' | 'all') => {
    setView(nextView)
    setPrefs({ ...prefs, defaultView: nextView })
  }
  const returnToToday = () => {
    startNavigationTransition(() => {
      setDay(today())
      setMode(shouldDefaultToPrime(clock) ? 'prime' : 'now')
      setGridScrollRequest((request) => request + 1)
    })
  }
  const programmeDuration = (programme: TVProgramme) =>
    programme.durationMinutes ??
    (new Date(programme.end).getTime() - new Date(programme.start).getTime()) / 60000
  const gridFocusMinute = gridInitialPosition.current
    ? day === today()
      ? localMinutes(new Date().toISOString())
      : 0
    : mode === 'now'
      ? day === today()
        ? localMinutes(new Date().toISOString())
        : 15 * 60
      : 21 * 60 + 10
  if (view === 'about') return <About onClose={() => setView('settings')} />
  if (view === 'settings')
    return (
      <div className="app">
        <Header
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          onSettings={() => setView('favorites')}
        />
        <Settings
          prefs={prefs}
          setPrefs={setPrefs}
          channels={data?.channels || []}
          fetchedAt={data?.fetchedAt}
          onClose={() => setView(prefs.defaultView)}
          onAbout={() => setView('about')}
        />
      </div>
    )
  return (
    <div className="app">
      <Header
        day={day}
        days={days}
        onDayChange={setDay}
        onReturnToToday={returnToToday}
        onRefresh={() => void load(true)}
        refreshing={refreshing}
        onSettings={() => setView('settings')}
      />
      <nav className="toolbar" aria-label="Navigation du guide" aria-busy={isNavigationPending}>
        <button
          className={`favorite-toggle ${view === 'favorites' ? 'selected' : ''}`}
          onClick={() => setGuideView(view === 'favorites' ? 'all' : 'favorites')}
          aria-label={view === 'favorites' ? 'Afficher toutes les chaînes' : 'Afficher mes favoris'}
          aria-pressed={view === 'favorites'}
          title={view === 'favorites' ? 'Mes favoris' : 'Toutes les chaînes'}
        >
          <span className="favorite-toggle-icon">★</span>
        </button>
        <button
          className={`search-toggle ${searchOpen ? 'selected' : ''}`}
          onClick={() => {
            if (searchOpen) {
              setSearchQuery('')
              setSearchOpen(false)
            } else {
              setSearchOpen(true)
            }
          }}
          aria-label="Rechercher un programme"
          aria-expanded={searchOpen}
          aria-pressed={searchOpen}
          title="Rechercher"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
          </svg>
        </button>
        <div className="segmented">
          <button
            className={mode === 'now' ? 'selected' : ''}
            onClick={() => {
              startNavigationTransition(() => {
                setMode('now')
                setGridScrollRequest((request) => request + 1)
              })
            }}
          >
            {day === today() ? 'Maintenant' : '15 h'}
          </button>
          <button
            className={mode === 'prime' ? 'selected' : ''}
            onClick={() => {
              startNavigationTransition(() => {
                setMode('prime')
                setGridScrollRequest((request) => request + 1)
              })
            }}
          >
            {day === today() ? 'Ce soir' : 'Le soir'}
          </button>
        </div>
        <button
          className={`grid-toggle ${screen === 'grid' ? 'selected' : ''}`}
          onClick={() =>
            startNavigationTransition(() =>
              setScreen((current) => (current === 'grid' ? 'guide' : 'grid')),
            )
          }
          aria-pressed={screen === 'grid'}
        >
          {isNavigationPending && <span className="mini-spinner" aria-hidden="true" />}
          <span className="grid-toggle-label">Grille</span>
        </button>
      </nav>
      {searchOpen && (
        <div className="search-panel">
          <div className="search-input-wrap">
            <input
              ref={searchInput}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onDoubleClick={(event) => event.currentTarget.select()}
              placeholder="Titre, acteur, catégorie…"
              aria-label="Rechercher un programme"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Effacer la recherche"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            className="search-close"
            onClick={() => {
              setSearchQuery('')
              setSearchOpen(false)
            }}
            aria-label="Fermer la recherche"
          >
            ×
          </button>
        </div>
      )}
      {(offline || error) && (
        <div className={`status ${error ? 'warning' : ''}`}>
          {offline ? 'Hors ligne · ' : ''}
          {error
            ? `${error}${data ? ' · Dernières données affichées' : ''}`
            : ''}
        </div>
      )}
      {updateReady && (
        <button className="update" onClick={() => location.reload()}>
          Une mise à jour est disponible · Actualiser
        </button>
      )}
      {searchOpen ? (
        <main className="guide search-results" aria-live="polite" aria-label="Résultats de recherche">
          {searchQuery.trim().length < 3 ? (
            <p className="search-message">Saisissez au moins 3 caractères pour lancer la recherche.</p>
          ) : loading && !data ? (
            <p className="search-message">Chargement du guide…</p>
          ) : searchResults.length ? (
            searchResults.map(({ programme }) => {
              const channel = channelsById.get(programme.channelId)
              if (!channel) return null
              return (
                <div key={programme.id} className="row-wrap">
                  <ProgrammeRow
                    channel={channel}
                    programme={programme}
                    clock={clock}
                    favorite={prefs.favoriteChannels.includes(channel.id)}
                    toggle={() => toggleFavorite(channel.id)}
                    onOpen={openDetails}
                    date={labelDay(new Date(programme.start), clock)}
                  />
                </div>
              )
            })
          ) : (
            <p className="search-message">Aucun programme trouvé.</p>
          )}
        </main>
      ) : screen === 'guide' ? (
        <main className="guide" aria-live="polite">
          {loading && !data && (
            <div className="loader">
              <span />
              Chargement du guide réel…
            </div>
          )}
          {!loading && !data && (
            <div className="empty-state">
              <h2>Programmes indisponibles</h2>
              <p>{error || 'Aucune donnée en cache.'}</p>
              <button onClick={() => void load(true)}>Réessayer</button>
            </div>
          )}
          {view === 'favorites' && visibleChannels.length === 0 && data && (
            <div className="empty-state">
              <h2>Aucun favori</h2>
              <p>Ajoutez une étoile à une chaîne ou affichez toutes les chaînes.</p>
              <button onClick={() => setGuideView('all')}>Voir toutes les chaînes</button>
            </div>
          )}
          {visibleChannels.map((c) => (
            <div key={c.id} className="row-wrap">
              <ProgrammeRow
                channel={c}
                programme={chooseProgramme(programmesByChannel.get(c.id) || [], day, mode)}
                clock={clock}
                favorite={prefs.favoriteChannels.includes(c.id)}
                toggle={() => toggleFavorite(c.id)}
                onOpen={openDetails}
              />
            </div>
          ))}
        </main>
      ) : (
        <main className="grid-screen" aria-label="Grille des programmes">
          {loading && !data ? (
            <div className="loader">
              <span />
              Chargement du guide réel…
            </div>
          ) : visibleChannels.length === 0 ? (
            <div className="empty-state">
              <h2>{data ? 'Aucune chaîne à afficher' : 'Programmes indisponibles'}</h2>
              <p>
                {data
                  ? 'Aucune chaîne ne correspond à cette sélection.'
                  : error || 'Aucune donnée en cache.'}
              </p>
              {!data && <button onClick={() => void load(true)}>Réessayer</button>}
            </div>
          ) : (
            <div className="grid-scroller" ref={gridScroller} aria-label="Programmes par chaîne">
              <div
                className="schedule-grid"
                style={{ gridTemplateColumns: `repeat(${visibleChannels.length}, 176px)` }}
              >
                {visibleChannels.map((channel) => (
                  <section className="grid-channel-column" key={channel.id}>
                    <header className="grid-channel">
                      <GridChannelLogo channel={channel} />
                      <span>{channel.name}</span>
                      <button
                        className={`star ${prefs.favoriteChannels.includes(channel.id) ? 'active' : ''}`}
                        onClick={() => toggleFavorite(channel.id)}
                        aria-label={`${prefs.favoriteChannels.includes(channel.id) ? 'Retirer' : 'Ajouter'} ${channel.name} ${prefs.favoriteChannels.includes(channel.id) ? 'des' : 'aux'} favoris`}
                        aria-pressed={prefs.favoriteChannels.includes(channel.id)}
                      >
                        ★
                      </button>
                    </header>
                    <div
                      className="grid-lane"
                      role="region"
                      aria-label={`Programmes de ${channel.name}`}
                      tabIndex={0}
                    >
                      {(gridProgrammesByChannel.get(channel.id) ?? []).map(
                        ({ programme, startMinute, time }) => {
                          const startsAt = startMinute
                          const endsAt = startsAt + programmeDuration(programme)
                          const isLong = programmeDuration(programme) >= 45
                          const showImage = Boolean(programme.imageUrl) && isLong
                          const progress = programmeProgress(programme, clock)
                          return (
                            <button
                              className={`grid-programme ${showImage ? 'with-image' : ''} ${progress.status === 'ended' ? 'ended' : ''}`}
                              key={programme.id}
                              onClick={() => openDetails(programme)}
                              aria-label={`${timeLabel(programme.start)} ${programme.title}`}
                              data-scroll-target={
                                startsAt <= gridFocusMinute && gridFocusMinute < endsAt
                              }
                            >
                              <span>{time}</span>
                              <strong>{programme.title}</strong>
                              {showImage && programme.imageUrl && (
                                <img
                                  className="grid-programme-image"
                                  src={programme.imageUrl}
                                  alt=""
                                  loading="lazy"
                                  onError={(event) => {
                                    event.currentTarget.hidden = true
                                  }}
                                />
                              )}
                              {progress.status === 'current' && (
                                <span className="programme-progress" aria-hidden="true">
                                  <span style={{ width: `${progress.progress}%` }} />
                                </span>
                              )}
                            </button>
                          )
                        },
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </main>
      )}
      {selected && (
        <Details
          programme={selected}
          channel={data?.channels.find((c) => c.id === selected.channelId)}
          channelProgrammes={programmesByChannel.get(selected.channelId) || []}
          scheduleOpen={scheduleOpen}
          onScheduleOpenChange={setScheduleOpen}
          onClose={closeDetails}
          onSelect={selectDetailsProgramme}
        />
      )}
    </div>
  )
}
function Header({
  onSettings,
  onRefresh,
  refreshing,
  day,
  days,
  onDayChange,
  onReturnToToday,
}: {
  onSettings: () => void
  onRefresh: () => void
  refreshing: boolean
  day?: string
  days?: Date[]
  onDayChange?: (day: string) => void
  onReturnToToday?: () => void
}) {
  return (
    <header>
      <div className="brand">
        <span className="brand-icon">TV</span>
      </div>
      {day && onReturnToToday && (
        <span className="return-to-today-slot">
          {day !== today() && (
            <button
              className="return-to-today"
              onClick={onReturnToToday}
              aria-label={`Revenir à aujourd’hui et ${shouldDefaultToPrime() ? 'ce soir' : 'maintenant'}`}
              title={`Aujourd’hui · ${shouldDefaultToPrime() ? 'Ce soir' : 'Maintenant'}`}
            >
              Aujourd’hui
            </button>
          )}
        </span>
      )}
      {day && days && onDayChange && (
        <select
          className="header-day"
          aria-label="Choisir le jour"
          value={day}
          onChange={(e) => onDayChange(e.target.value)}
        >
          {days.map((d) => (
            <option key={dateKey(d)} value={dateKey(d)}>
              {labelDay(d)}
            </option>
          ))}
        </select>
      )}
      <div className="header-actions">
        <button
          className="refresh"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={
            refreshing ? 'Actualisation des programmes en cours' : 'Actualiser les programmes'
          }
          aria-busy={refreshing}
        >
          {refreshing ? <span className="mini-spinner" aria-hidden="true" /> : '⟳'}
        </button>
        <button className="settings-button" onClick={onSettings} aria-label="Ouvrir les paramètres">
          ⚙
        </button>
      </div>
    </header>
  )
}
