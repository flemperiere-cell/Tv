import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import type { Channel, EpgData, GuideMode, TVProgramme } from './models/tv'
import { Details } from './components/Details'
import { EPG_CATALOG_VERSION, fetchEpg, sourceChanged } from './services/epg/provider'
import { clearCache, isFresh, readCache, writeCache } from './services/storage/cache'
import {
  consultationDayChanged,
  readLastConsultation,
  writeLastConsultation,
} from './services/storage/lastConsultation'
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
  choosePrimeProgramme,
  dateKey,
  dateTimeAt,
  labelDay,
  localMinutes,
  programmeProgress,
  programmeStartedYesterday,
  shouldDefaultToPrime,
  timeLabel,
} from './utils/dates'
import { MIN_SEARCH_QUERY_LENGTH, normalizeSearchText, searchProgrammes } from './utils/search'
import { getUpdateSnapshot, subscribeToUpdate, updateSW } from './services/pwa/update'

type View = 'favorites' | 'all' | 'settings' | 'about'
type GuideScreen = 'guide' | 'grid'
const GRID_CHUNK_SIZE = 20
const GRID_INITIAL_SIZE = 32
const GRID_WINDOW_SIZE = 48
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_RESULT_BATCH_SIZE = 50
const DETAIL_HISTORY_KEY = 'monGuideTvProgrammeId'
const today = () => dateKey(new Date())
const gridDayFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'full',
})

function programmeDuration(programme: TVProgramme) {
  return (
    programme.durationMinutes ??
    (new Date(programme.end).getTime() - new Date(programme.start).getTime()) / 60000
  )
}

function GridLane({
  channel,
  entries,
  focusAt,
  rangeKey,
  clock,
  onOpen,
}: {
  channel: Channel
  entries: Array<{ programme: TVProgramme; time: string }>
  focusAt: Date
  rangeKey: string
  clock: Date
  onOpen: (programme: TVProgramme) => void
}) {
  const lane = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ key: '', start: 0, end: 0 })
  const rangeRef = useRef(range)
  const loadingEnabled = useRef(false)
  const scrollAnchor = useRef<{ index: number; offset: number } | null>(null)
  const focusedIndex = entries.findIndex(
    ({ programme }) => new Date(programme.start) <= focusAt && focusAt < new Date(programme.end),
  )
  const initialStart = Math.max(0, focusedIndex)
  const initialEnd = Math.min(entries.length, initialStart + GRID_INITIAL_SIZE)
  const visibleRange =
    range.key === rangeKey ? range : { key: rangeKey, start: initialStart, end: initialEnd }
  rangeRef.current = visibleRange
  const visibleEntries = entries.slice(visibleRange.start, visibleRange.end)

  useLayoutEffect(() => {
    if (range.key === rangeKey) return
    loadingEnabled.current = false
    scrollAnchor.current = null
    const nextRange = { key: rangeKey, start: initialStart, end: initialEnd }
    rangeRef.current = nextRange
    setRange(nextRange)
  }, [initialEnd, initialStart, range.key, rangeKey])

  useLayoutEffect(() => {
    const scrollElement = lane.current
    const anchor = scrollAnchor.current
    if (!scrollElement || !anchor) return
    const anchorElement = scrollElement.querySelector<HTMLElement>(
      `[data-grid-index="${anchor.index}"]`,
    )
    if (anchorElement) {
      scrollElement.scrollTop +=
        anchorElement.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top -
        anchor.offset
    }
    scrollAnchor.current = null
  }, [visibleRange.start, visibleRange.end])

  const loadWindow = () => {
    const scrollElement = lane.current
    if (!scrollElement || !loadingEnabled.current) return

    const currentRange = rangeRef.current
    const nearTop = scrollElement.scrollTop < 80
    const nearBottom =
      scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop < 160
    let nextStart = currentRange.start
    let nextEnd = currentRange.end

    if (nearTop && currentRange.start > 0) {
      nextStart = Math.max(0, currentRange.start - GRID_CHUNK_SIZE)
      nextEnd = Math.min(entries.length, nextStart + GRID_WINDOW_SIZE)
    } else if (nearBottom && currentRange.end < entries.length) {
      nextEnd = Math.min(entries.length, currentRange.end + GRID_CHUNK_SIZE)
      nextStart = Math.max(currentRange.start, nextEnd - GRID_WINDOW_SIZE)
    } else {
      return
    }

    if (nextStart === currentRange.start && nextEnd === currentRange.end) return
    const anchorIndex = nextStart > currentRange.start ? nextStart : currentRange.start
    const anchorElement = scrollElement.querySelector<HTMLElement>(
      `[data-grid-index="${anchorIndex}"]`,
    )
    scrollAnchor.current = anchorElement
      ? {
          index: anchorIndex,
          offset:
            anchorElement.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top,
        }
      : null
    const nextRange = { key: rangeKey, start: nextStart, end: nextEnd }
    rangeRef.current = nextRange
    setRange(nextRange)
  }

  return (
    <div
      className="grid-lane"
      ref={lane}
      onScroll={loadWindow}
      onWheel={() => {
        loadingEnabled.current = true
      }}
      onTouchStart={() => {
        loadingEnabled.current = true
      }}
      onPointerDown={() => {
        loadingEnabled.current = true
      }}
      onKeyDown={() => {
        loadingEnabled.current = true
      }}
      role="region"
      aria-label={`Programmes de ${channel.name}`}
      tabIndex={0}
    >
      {visibleEntries.map(({ programme, time }, offset) => {
        const index = visibleRange.start + offset
        const itemDay = dateKey(new Date(programme.start))
        const previousDay = index > 0 ? dateKey(new Date(entries[index - 1].programme.start)) : null
        const duration = programmeDuration(programme)
        const showImage = Boolean(programme.imageUrl) && duration >= 45
        const progress = programmeProgress(programme, clock)
        const startedYesterday = programmeStartedYesterday(programme, clock)
        const timeLabelText = `${time}${startedYesterday ? ' (hier)' : ''}`
        return (
          <Fragment key={programme.id}>
            {(index === visibleRange.start || itemDay !== previousDay) && (
              <div className="grid-lane-day">
                {gridDayFormatter.format(new Date(programme.start))}
              </div>
            )}
            <div className="grid-lane-entry">
              <button
                className={`grid-programme ${showImage ? 'with-image' : ''} ${progress.status === 'ended' ? 'ended' : ''}`}
                onClick={() => onOpen(programme)}
                aria-label={`${timeLabelText} ${programme.title}`}
                data-scroll-target={
                  new Date(programme.start) <= focusAt && focusAt < new Date(programme.end)
                }
                data-grid-index={index}
              >
                <span className="grid-programme-time">
                  <span>
                    {time}
                    {startedYesterday && <span className="programme-time-yesterday"> (hier)</span>}
                  </span>
                  <span className="grid-programme-duration">{Math.round(duration)} min</span>
                </span>
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
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

function ProgrammeRow({
  channel,
  programme,
  clock,
  favorite,
  toggle,
  onOpen,
  onSwipe,
  date,
}: {
  channel: Channel
  programme?: TVProgramme
  clock: Date
  favorite: boolean
  toggle: () => void
  onOpen: (p: TVProgramme) => void
  onSwipe?: (direction: 1 | -1) => void
  date?: string
}) {
  const [broken, setBroken] = useState(false)
  const row = useRef<HTMLElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const swipeDirection = useRef<1 | -1>(1)
  const previousProgrammeId = useRef(programme?.id)
  const suppressClick = useRef(false)
  const progress = programme ? programmeProgress(programme, clock) : undefined

  useLayoutEffect(() => {
    if (previousProgrammeId.current === programme?.id) return
    previousProgrammeId.current = programme?.id
    const element = row.current
    if (!programme || !element || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
      return

    const direction = swipeDirection.current
    const animation = element.animate(
      [
        { transform: `translateX(${direction * 24}px)`, opacity: 0.75 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      { duration: 220, easing: 'cubic-bezier(0.22, 0.8, 0.32, 1)' },
    )
    return () => animation.cancel()
  }, [programme?.id])

  return (
    <article
      className={`programme-row ${onSwipe ? 'swipeable' : ''} ${progress?.status === 'ended' ? 'ended' : ''}`}
      ref={row}
      onTouchStart={(event) => {
        const touch = event.touches.item(0)
        touchStart.current =
          onSwipe && event.touches.length === 1 && touch
            ? { x: touch.clientX, y: touch.clientY }
            : null
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current
        const touch = event.changedTouches.item(0)
        touchStart.current = null
        if (!onSwipe || !start || !touch) return
        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return
        const direction = deltaX < 0 ? 1 : -1
        event.preventDefault()
        suppressClick.current = true
        requestAnimationFrame(() => {
          suppressClick.current = false
        })
        swipeDirection.current = direction
        onSwipe(direction)
      }}
      onTouchCancel={() => {
        touchStart.current = null
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
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
          aria-label={`Détails de ${programme.title}, ${timeLabel(programme.start)} – ${timeLabel(programme.end)}`}
        >
          <span className="time">
            {date && <span className="programme-date">{date}</span>}
            <span className="time-range">
              {timeLabel(programme.start)}
              <span className="time-range-separator"> – </span>
              <span className="programme-end-time">{timeLabel(programme.end)}</span>
            </span>
            {programmeStartedYesterday(programme, clock) && (
              <span className="programme-time-yesterday">(hier)</span>
            )}
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
  const [channelFilter, setChannelFilter] = useState('')
  const deferredChannelFilter = useDeferredValue(channelFilter)
  const [openSections, setOpenSections] = useState({
    channels: true,
    settings: false,
    about: false,
  })
  const searchableChannels = useMemo(
    () =>
      channels.map((channel) => ({
        channel,
        searchText: normalizeSearchText(`${channel.number ?? ''} ${channel.name} ${channel.id}`),
      })),
    [channels],
  )
  const normalizedChannelFilter = normalizeSearchText(deferredChannelFilter)
  const filteredChannels = useMemo(
    () =>
      searchableChannels
        .filter(({ searchText }) => searchText.includes(normalizedChannelFilter))
        .map(({ channel }) => channel),
    [normalizedChannelFilter, searchableChannels],
  )
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
      <details className="settings-section" open={openSections.channels}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            setOpenSections((current) => ({ ...current, channels: !current.channels }))
          }}
        >
          <h2>Choisir mes chaînes</h2>
        </summary>
        <div className="settings-section-content">
          <p className="muted">Les réglages sont enregistrés uniquement sur cet appareil.</p>
          <div className="search-input-wrap channel-filter">
            <input
              type="text"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              placeholder="Nom, numéro ou identifiant"
              aria-label="Filtrer les chaînes"
            />
            {channelFilter && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setChannelFilter('')}
                aria-label="Effacer le filtre des chaînes"
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          <div className="channel-list">
            {filteredChannels.map((channel) => (
              <label key={channel.id}>
                <input
                  type="checkbox"
                  checked={prefs.selectedChannels.includes(channel.id)}
                  onChange={() => toggle(channel.id)}
                />
                <span>
                  {channel.number ? `${channel.number}. ` : ''}
                  {channel.name}
                </span>
              </label>
            ))}
          </div>
          {filteredChannels.length === 0 && (
            <p className="muted" role="status">
              Aucune chaîne ne correspond à ce filtre.
            </p>
          )}
        </div>
      </details>
      <details className="settings-section" open={openSections.settings}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            setOpenSections((current) => ({ ...current, settings: !current.settings }))
          }}
        >
          <h2>Réglages</h2>
        </summary>
        <div className="settings-section-content">
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
        </div>
      </details>
      <details className="settings-section" open={openSections.about}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            setOpenSections((current) => ({ ...current, about: !current.about }))
          }}
        >
          <h2>À propos</h2>
        </summary>
        <div className="settings-section-content">
          <button className="about-link" onClick={onAbout}>
            Informations et attribution des données
          </button>
        </div>
      </details>
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
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [searchResultLimit, setSearchResultLimit] = useState(SEARCH_RESULT_BATCH_SIZE)
  const [isNavigationPending, startNavigationTransition] = useTransition()
  const [mode, setMode] = useState<GuideMode>(() => (shouldDefaultToPrime() ? 'prime' : 'now'))
  const [programmeIndexesByChannel, setProgrammeIndexesByChannel] = useState<
    Record<string, number>
  >({})
  const [gridScrollRequest, setGridScrollRequest] = useState(0)
  const [day, setDay] = useState(today)
  const [clock, setClock] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [selected, setSelected] = useState<TVProgramme>()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const updateReady = useSyncExternalStore(subscribeToUpdate, getUpdateSnapshot)
  const request = useRef<Promise<void> | undefined>(undefined)
  const gridScroller = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const gridInitialPosition = useRef(true)
  useEffect(() => {
    let lastConsultation = readLastConsultation()
    const updateClock = () => {
      const now = new Date()
      setClock(now)
      if (consultationDayChanged(lastConsultation, now)) {
        startNavigationTransition(() => {
          setDay(dateKey(now))
          setMode(shouldDefaultToPrime(now) ? 'prime' : 'now')
          setProgrammeIndexesByChannel({})
          setGridScrollRequest((request) => request + 1)
        })
      }
      lastConsultation = now
      writeLastConsultation(now)
    }
    const updateClockWhenVisible = () => {
      if (document.visibilityState === 'visible') updateClock()
    }
    updateClockWhenVisible()
    const timer = window.setInterval(updateClockWhenVisible, 30_000)
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
      if (
        cached &&
        !force &&
        prefs.cacheEnabled &&
        cached.catalogVersion === EPG_CATALOG_VERSION &&
        isFresh(cached)
      ) {
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
    if ([...normalizeSearchText(searchQuery)].length < MIN_SEARCH_QUERY_LENGTH) {
      setDebouncedSearchQuery('')
      return
    }
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchQuery])
  useEffect(() => {
    const online = () => setOffline(false),
      off = () => setOffline(true)
    addEventListener('online', online)
    addEventListener('offline', off)
    return () => {
      removeEventListener('online', online)
      removeEventListener('offline', off)
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
      const dayHeading = target?.closest('.grid-lane-entry')?.previousElementSibling
      const dayHeadingHeight =
        dayHeading instanceof HTMLElement && dayHeading.classList.contains('grid-lane-day')
          ? dayHeading.getBoundingClientRect().height
          : 0
      lane.scrollTo({
        top: target
          ? lane.scrollTop +
            target.getBoundingClientRect().top -
            lane.getBoundingClientRect().top -
            lane.clientTop -
            paddingTop -
            dayHeadingHeight
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
    for (const programmes of m.values()) programmes.sort((a, b) => a.start.localeCompare(b.start))
    return m
  }, [data])
  const channelsById = useMemo(
    () => new Map((data?.channels ?? []).map((channel) => [channel.id, channel])),
    [data],
  )
  const searchableProgrammes = useMemo(
    () => prefs.selectedChannels.flatMap((channelId) => programmesByChannel.get(channelId) ?? []),
    [prefs.selectedChannels, programmesByChannel],
  )
  const searchResults = useMemo(
    () => searchProgrammes(searchableProgrammes, debouncedSearchQuery),
    [searchableProgrammes, debouncedSearchQuery],
  )
  const gridProgrammesByChannel = useMemo(() => {
    const programmes = new Map<string, Array<{ programme: TVProgramme; time: string }>>()
    for (const programme of data?.programmes ?? []) {
      const entries = programmes.get(programme.channelId) ?? []
      entries.push({
        programme,
        time: timeLabel(programme.start),
      })
      programmes.set(programme.channelId, entries)
    }
    for (const entries of programmes.values())
      entries.sort((a, b) => a.programme.start.localeCompare(b.programme.start))
    return programmes
  }, [data])
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
    setProgrammeIndexesByChannel({})
    setView(nextView)
    setPrefs({ ...prefs, defaultView: nextView })
  }
  const setGuideDay = (nextDay: string) => {
    setProgrammeIndexesByChannel({})
    setDay(nextDay)
  }
  const selectGuideMode = (nextMode: GuideMode) => {
    setProgrammeIndexesByChannel({})
    startNavigationTransition(() => {
      setMode(nextMode)
      setGridScrollRequest((request) => request + 1)
    })
  }
  const returnToToday = () => {
    setProgrammeIndexesByChannel({})
    startNavigationTransition(() => {
      setDay(today())
      setMode(shouldDefaultToPrime(clock) ? 'prime' : 'now')
      setGridScrollRequest((request) => request + 1)
    })
  }
  const gridFocusMinute = gridInitialPosition.current
    ? day === today()
      ? localMinutes(new Date().toISOString())
      : 0
    : mode === 'now'
      ? day === today()
        ? localMinutes(new Date().toISOString())
        : 15 * 60
      : 21 * 60 + 10
  const gridFocusAt = day === today() && mode === 'now' ? clock : dateTimeAt(day, gridFocusMinute)
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
        onDayChange={setGuideDay}
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
        {searchOpen ? (
          <div className="search-panel">
            <div className="search-input-wrap">
              <input
                ref={searchInput}
                type="text"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  setSearchResultLimit(SEARCH_RESULT_BATCH_SIZE)
                }}
                onDoubleClick={(event) => event.currentTarget.select()}
                placeholder="Titre, acteur, catégorie…"
                aria-label="Rechercher un programme"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setSearchQuery('')
                    setSearchResultLimit(SEARCH_RESULT_BATCH_SIZE)
                  }}
                  aria-label="Effacer la recherche"
                >
                  ×
                </button>
              )}
            </div>
            <button
              type="button"
              className="search-close"
              onClick={() => setSearchOpen(false)}
              aria-label="Fermer la recherche"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : (
          <>
            <div className="segmented">
              <button
                className={mode === 'now' ? 'selected' : ''}
                onClick={() => selectGuideMode('now')}
              >
                {day === today() ? 'Maintenant' : '15 h'}
              </button>
              <button
                className={mode === 'prime' ? 'selected' : ''}
                onClick={() => selectGuideMode('prime')}
              >
                {day === today() ? 'Ce soir' : 'Le soir'}
              </button>
            </div>
            <button
              className={`grid-toggle ${screen === 'grid' ? 'selected' : ''}`}
              onClick={() => {
                setProgrammeIndexesByChannel({})
                startNavigationTransition(() =>
                  setScreen((current) => (current === 'grid' ? 'guide' : 'grid')),
                )
              }}
              aria-pressed={screen === 'grid'}
            >
              <span className="grid-toggle-label">
                {screen === 'grid' ? 'Guide' : 'Grille'}
              </span>
            </button>
          </>
        )}
      </nav>
      {(offline || error) && (
        <div className={`status ${error ? 'warning' : ''}`}>
          {offline ? 'Hors ligne · ' : ''}
          {error ? `${error}${data ? ' · Dernières données affichées' : ''}` : ''}
        </div>
      )}
      {updateReady && (
        <button className="update" onClick={() => void updateSW(true)}>
          Une mise à jour est disponible · Actualiser
        </button>
      )}
      {searchOpen ? (
        <main
          className="guide search-results"
          aria-live="polite"
          aria-label="Résultats de recherche"
        >
          {[...normalizeSearchText(searchQuery)].length < MIN_SEARCH_QUERY_LENGTH ? (
            <p className="search-message">
              Saisissez au moins 3 caractères pour lancer la recherche.
            </p>
          ) : loading && !data ? (
            <p className="search-message">Chargement du guide…</p>
          ) : searchQuery !== debouncedSearchQuery ? (
            <p className="search-message">Recherche en cours…</p>
          ) : searchResults.length ? (
            <>
              <p className="search-message">
                {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''}
                {searchResults.length > searchResultLimit
                  ? ` · affichage des ${searchResultLimit} premiers`
                  : ''}
              </p>
              {searchResults.slice(0, searchResultLimit).map(({ programme }) => {
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
              })}
              {searchResults.length > searchResultLimit && (
                <button
                  className="search-load-more"
                  onClick={() => setSearchResultLimit((limit) => limit + SEARCH_RESULT_BATCH_SIZE)}
                >
                  Afficher les{' '}
                  {Math.min(SEARCH_RESULT_BATCH_SIZE, searchResults.length - searchResultLimit)}{' '}
                  résultats suivants
                </button>
              )}
            </>
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
          {visibleChannels.map((c) => {
            const channelProgrammes = programmesByChannel.get(c.id) ?? []
            const nowProgramme = chooseProgramme(channelProgrammes, day, 'now', clock)
            const nowIndex = nowProgramme
              ? channelProgrammes.findIndex((programme) => programme.id === nowProgramme.id)
              : -1
            const primeProgramme =
              mode === 'prime' ? choosePrimeProgramme(channelProgrammes, day) : undefined
            const programmes = channelProgrammes
            const defaultIndex =
              mode === 'prime'
                ? primeProgramme
                  ? programmes.findIndex((programme) => programme.id === primeProgramme.id)
                  : -1
                : nowIndex
            const selectedIndex = Math.min(
              programmeIndexesByChannel[c.id] ?? defaultIndex,
              programmes.length - 1,
            )
            const selectedProgramme = programmes[selectedIndex]
            const onSwipe =
              selectedIndex >= 0 && programmes.length > 1
                ? (direction: 1 | -1) =>
                    setProgrammeIndexesByChannel((indexes) => {
                      const current = Math.min(indexes[c.id] ?? defaultIndex, programmes.length - 1)
                      const next = current + direction
                      if (next < 0 || next >= programmes.length) return indexes
                      return { ...indexes, [c.id]: next }
                    })
                : undefined

            return (
              <div key={c.id} className="row-wrap">
                <ProgrammeRow
                  channel={c}
                  programme={selectedProgramme}
                  clock={clock}
                  favorite={prefs.favoriteChannels.includes(c.id)}
                  toggle={() => toggleFavorite(c.id)}
                  onOpen={openDetails}
                  onSwipe={onSwipe}
                />
              </div>
            )
          })}
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
                    <GridLane
                      channel={channel}
                      entries={gridProgrammesByChannel.get(channel.id) ?? []}
                      focusAt={gridFocusAt}
                      rangeKey={`${day}:${mode}:${gridScrollRequest}:${data?.fetchedAt ?? ''}:${gridProgrammesByChannel.get(channel.id)?.length ?? 0}`}
                      clock={clock}
                      onOpen={openDetails}
                    />
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
