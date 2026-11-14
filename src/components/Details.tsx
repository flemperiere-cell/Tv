import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { Channel, TVProgramme } from '../models/tv'
import type { MatchAlternative, MatchResponse, MediaMetadata } from '../models/media'
import { classifyProgramme } from '../services/media/classify'
import { enrichProgramme, fetchMediaDetails } from '../services/media/client'
import { dateKey, programmeProgress, programmeStartedYesterday, timeLabel } from '../utils/dates'
import { googlePersonSearchUrl } from '../utils/links'
import { MediaCast } from './MediaCast'

const broadcastTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  timeStyle: 'short',
})
const scheduleDayFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'full',
})
const SCHEDULE_CHUNK_SIZE = 20
const SCHEDULE_WINDOW_SIZE = 48

function scheduleRangeAround(index: number, length: number) {
  const start = Math.max(0, index - Math.floor(SCHEDULE_CHUNK_SIZE / 2))
  return { start, end: Math.min(length, start + SCHEDULE_CHUNK_SIZE) }
}

function localizedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

interface EnrichmentResult {
  programmeId: string
  status: 'matched' | 'ambiguous' | 'not-found' | 'unsupported' | 'error'
  response?: MatchResponse
  message?: string
}

function scoreLabel(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

function criterionStatusLabel(
  status: NonNullable<MatchAlternative['scoring']>['criteria'][number]['status'],
) {
  switch (status) {
    case 'match':
      return 'Concordant'
    case 'partial':
      return 'Partiel'
    case 'mismatch':
      return 'Différent'
    case 'unavailable':
      return 'Non évalué · donnée manquante'
    case 'not_applicable':
      return 'Non applicable'
  }
}

function metadataFacts(metadata: MediaMetadata) {
  const date = metadata.releaseDate || metadata.firstAirDate
  return [
    ['Date de sortie', date ? localizedDate(date) : undefined],
    ['Genres', metadata.genres.join(', ') || undefined],
    ['Pays de production', metadata.countries.join(', ') || undefined],
    ['Durée', metadata.runtimeMinutes ? `${metadata.runtimeMinutes} min` : undefined],
  ].filter((entry): entry is [string, string] => !!entry[1])
}

function PersonLinks({
  people,
}: {
  people: Array<{ name: string; providerId?: number | null; role?: string }>
}): ReactNode {
  return (
    <>
      {people.map((person, index) => (
        <span key={`${person.providerId ?? person.name}-${index}`}>
          {index > 0 && ', '}
          <a
            className="person-link"
            href={googlePersonSearchUrl(person.name)}
            target="_blank"
            rel="noreferrer"
          >
            {person.name}
          </a>
          {person.role && ` (${person.role})`}
        </span>
      ))}
    </>
  )
}

export function Details({
  programme,
  channel,
  channelProgrammes,
  scheduleOpen,
  onScheduleOpenChange,
  onClose,
  onSelect,
}: {
  programme: TVProgramme
  channel?: Channel
  channelProgrammes: TVProgramme[]
  scheduleOpen: boolean
  onScheduleOpenChange: (open: boolean) => void
  onClose: () => void
  onSelect: (programme: TVProgramme) => void
}) {
  const [result, setResult] = useState<EnrichmentResult>()
  const [retry, setRetry] = useState(0)
  const [previewMetadata, setPreviewMetadata] = useState<MediaMetadata | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [scoreAlternative, setScoreAlternative] = useState<MatchAlternative | null>(null)
  const [showMatchedSuggestions, setShowMatchedSuggestions] = useState(false)
  const [brokenChannelIcon, setBrokenChannelIcon] = useState(false)
  const [activeImage, setActiveImage] = useState(0)
  const [imageExpanded, setImageExpanded] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const scheduleScroller = useRef<HTMLDivElement>(null)
  const [scheduleRange, setScheduleRange] = useState({
    programmeId: '',
    start: 0,
    end: 0,
  })
  const scheduleRangeRef = useRef(scheduleRange)
  const scheduleLoadEnabled = useRef(false)
  const scheduleScrollAnchor = useRef<{ index: number; offset: number } | null>(null)
  const schedulePositionRequested = useRef(false)
  const scheduleSelectionPinned = useRef(false)
  const previousScheduleView = useRef({ programmeId: '', open: false })
  const previewController = useRef<AbortController | null>(null)
  const scoreDialogRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const imageSwipeStart = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const imageTouchStart = useRef<{ x: number; y: number } | null>(null)
  const lastImageTap = useRef<{ x: number; y: number; time: number } | null>(null)
  const touchDoubleClickTime = useRef<number | null>(null)
  const mediaType = classifyProgramme(programme)
  useEffect(() => {
    setBrokenChannelIcon(false)
  }, [channel?.icon])
  useEffect(() => {
    setActiveImage(0)
    setImageExpanded(false)
    setScoreAlternative(null)
    setShowMatchedSuggestions(false)
  }, [programme.id])
  useEffect(() => {
    if (!scoreAlternative) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScoreAlternative(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    scoreDialogRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [scoreAlternative])
  const clearAlternative = () => {
    previewController.current?.abort()
    setPreviewKey(null)
    setPreviewMetadata(null)
    setPreviewLoading(false)
    setPreviewError(null)
  }
  const handleBack = () => {
    if (scoreAlternative) setScoreAlternative(null)
    else if (previewKey) clearAlternative()
    else onClose()
  }
  const schedule = useMemo(
    () => [...channelProgrammes].sort((a, b) => a.start.localeCompare(b.start)),
    [channelProgrammes],
  )
  const foundProgrammeIndex = schedule.findIndex((item) => item.id === programme.id)
  const selectedProgrammeIndex = Math.max(0, foundProgrammeIndex)
  const visibleScheduleRange =
    scheduleRange.programmeId === programme.id
      ? scheduleRange
      : {
          programmeId: programme.id,
          ...scheduleRangeAround(selectedProgrammeIndex, schedule.length),
        }
  scheduleRangeRef.current = visibleScheduleRange
  const visibleSchedule = schedule.slice(visibleScheduleRange.start, visibleScheduleRange.end)
  const progress = programmeProgress(programme, clock)

  useLayoutEffect(() => {
    const openingOrChangingProgramme =
      scheduleOpen &&
      (!previousScheduleView.current.open ||
        previousScheduleView.current.programmeId !== programme.id)
    previousScheduleView.current = { programmeId: programme.id, open: scheduleOpen }
    if (openingOrChangingProgramme) {
      schedulePositionRequested.current = true
      scheduleSelectionPinned.current = true
    }

    const newProgramme = scheduleRange.programmeId !== programme.id
    const selectedProgrammeWasPruned =
      scheduleOpen &&
      foundProgrammeIndex >= 0 &&
      (selectedProgrammeIndex < scheduleRange.start || selectedProgrammeIndex >= scheduleRange.end)
    if (!newProgramme && !selectedProgrammeWasPruned) return
    scheduleLoadEnabled.current = false
    scheduleScrollAnchor.current = null
    const nextRange = {
      programmeId: programme.id,
      ...scheduleRangeAround(selectedProgrammeIndex, schedule.length),
    }
    scheduleRangeRef.current = nextRange
    setScheduleRange(nextRange)
    if (scheduleScroller.current) scheduleScroller.current.scrollTop = 0
  }, [
    programme.id,
    schedule,
    scheduleOpen,
    scheduleRange.end,
    scheduleRange.programmeId,
    scheduleRange.start,
    foundProgrammeIndex,
    selectedProgrammeIndex,
  ])

  useLayoutEffect(() => {
    const scroller = scheduleScroller.current
    const anchor = scheduleScrollAnchor.current
    if (scroller && anchor) {
      const element = scroller.querySelector<HTMLElement>(`[data-schedule-index="${anchor.index}"]`)
      if (element) {
        scroller.scrollTop +=
          element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset
      }
      scheduleScrollAnchor.current = null
    }

    if (!scheduleOpen || !scroller || !schedulePositionRequested.current) return
    const active = scroller.querySelector<HTMLElement>('[data-current-programme="true"]')
    if (active) {
      scroller.scrollTop +=
        active.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      schedulePositionRequested.current = false
    }
  }, [programme.id, scheduleOpen, visibleScheduleRange.start, visibleScheduleRange.end])

  const keepScheduleSelectionAtTop = () => {
    const scroller = scheduleScroller.current
    const active = scroller?.querySelector<HTMLElement>('[data-current-programme="true"]')
    if (!scroller || !active || !scheduleSelectionPinned.current) return
    scroller.scrollTop += active.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  }

  const loadScheduleWindow = () => {
    const scroller = scheduleScroller.current
    if (!scroller || !scheduleLoadEnabled.current) return

    const currentRange = scheduleRangeRef.current
    const nearTop = scroller.scrollTop < 80
    const nearBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 160
    let nextStart = currentRange.start
    let nextEnd = currentRange.end

    if (nearTop && currentRange.start > 0) {
      nextStart = Math.max(0, currentRange.start - SCHEDULE_CHUNK_SIZE)
      nextEnd = Math.min(schedule.length, nextStart + SCHEDULE_WINDOW_SIZE)
    } else if (nearBottom && currentRange.end < schedule.length) {
      nextEnd = Math.min(schedule.length, currentRange.end + SCHEDULE_CHUNK_SIZE)
      nextStart = Math.max(currentRange.start, nextEnd - SCHEDULE_WINDOW_SIZE)
    } else {
      return
    }

    if (nextStart === currentRange.start && nextEnd === currentRange.end) return
    const anchorIndex = nextStart > currentRange.start ? nextStart : currentRange.start
    const anchorElement = scroller.querySelector<HTMLElement>(
      `[data-schedule-index="${anchorIndex}"]`,
    )
    scheduleScrollAnchor.current = anchorElement
      ? {
          index: anchorIndex,
          offset: anchorElement.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        }
      : null
    const nextRange = { programmeId: programme.id, start: nextStart, end: nextEnd }
    scheduleRangeRef.current = nextRange
    setScheduleRange(nextRange)
  }

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

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && handleBack()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', f)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', f)
    }
  }, [handleBack])

  useEffect(() => {
    if (!mediaType) return
    const controller = new AbortController()
    void enrichProgramme(programme, controller.signal).then(
      (response) => {
        const status =
          response.status === 'matched'
            ? 'matched'
            : response.status === 'ambiguous'
              ? 'ambiguous'
              : response.status === 'unsupported'
                ? 'unsupported'
                : 'not-found'
        setResult({ programmeId: programme.id, status, response })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setResult({
          programmeId: programme.id,
          status: 'error',
          message: error instanceof Error ? error.message : 'Complément momentanément indisponible',
        })
      },
    )
    return () => controller.abort()
  }, [programme, mediaType, retry])

  useEffect(
    () => () => {
      previewController.current?.abort()
    },
    [programme.id],
  )

  const selectAlternative = async (alternative: MatchAlternative) => {
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    const key = `${alternative.mediaType}:${alternative.providerId}`
    setPreviewKey(key)
    setPreviewMetadata(null)
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const details = await fetchMediaDetails(alternative, controller.signal)
      if (!controller.signal.aborted) setPreviewMetadata(details)
    } catch (error) {
      if (!controller.signal.aborted)
        setPreviewError(error instanceof Error ? error.message : 'Fiche TMDB indisponible')
    } finally {
      if (!controller.signal.aborted) setPreviewLoading(false)
    }
  }

  const currentResult = result?.programmeId === programme.id ? result : undefined
  const matchedMetadata =
    currentResult?.status === 'matched' ? (currentResult.response?.metadata ?? null) : null
  const metadata = previewMetadata ?? matchedMetadata
  const suggestions = currentResult?.response?.alternatives ?? []
  const matchedAutomatically =
    currentResult?.status === 'matched' &&
    !currentResult.response?.match?.manual &&
    suggestions.length > 0
  const isLoading = Boolean(mediaType && !currentResult)
  useEffect(() => {
    if (!scoreAlternative || scoreAlternative.scoring || !currentResult?.response) return
    const refreshed = currentResult.response.alternatives.find(
      (item) =>
        item.providerId === scoreAlternative.providerId &&
        item.mediaType === scoreAlternative.mediaType,
    )
    if (refreshed?.scoring) setScoreAlternative(refreshed)
  }, [currentResult, scoreAlternative])
  const openScoreDetails = (alternative: MatchAlternative) => {
    setScoreAlternative(alternative)
    if (!alternative.scoring && currentResult) {
      setResult(undefined)
      setRetry((value) => value + 1)
    }
  }
  const credits = programme.credits
  const people = (values?: string[]) => values?.join(', ')
  const actors = credits?.actors
    ?.map((actor) => (actor.role ? `${actor.name} (${actor.role})` : actor.name))
    .join(', ')
  const broadcastDate = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'full',
  }).format(new Date(programme.start))
  const tmdbScore =
    metadata?.voteAverage !== null && metadata?.voteAverage !== undefined
      ? new Intl.NumberFormat('fr-FR', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(metadata.voteAverage)
      : undefined
  const directorPeople = [
    ...(credits?.directors ?? []).map((name) => ({ name })),
    ...((metadata?.mediaType === 'tv' ? metadata.creators : metadata?.directors) ?? []),
  ].filter(
    (person, index, people) =>
      people.findIndex((candidate) => candidate.name === person.name) === index,
  )
  const googleSearchQuery = [programme.title, programme.category, metadata?.year ?? programme.year]
    .filter(Boolean)
    .join(' ')
  const facts: Array<[string, ReactNode]> = [
    [
      metadata?.mediaType === 'tv' ? 'Création' : 'Réalisation',
      directorPeople.length ? <PersonLinks people={directorPeople} /> : undefined,
    ],
    [
      'Casting et personnages',
      credits?.actors?.length ? <PersonLinks people={credits.actors} /> : actors,
    ],
    ['Présentation', people(credits?.presenters)],
    ['Scénario', people(credits?.writers)],
    ['Production', people(credits?.producers)],
    ['Musique', people(credits?.composers)],
    ['Montage', people(credits?.editors)],
    ['Adaptation', people(credits?.adapters)],
    ['Commentaires', people(credits?.commentators)],
    ['Invités XMLTV', people(credits?.guests)],
    ['Pays', people(programme.countries)],
    ['Année XMLTV', programme.year],
    [
      'Classification',
      programme.rating
        ? `${programme.rating}${programme.ratingSystem ? ` (${programme.ratingSystem})` : ''}`
        : undefined,
    ],
    ['Note', programme.starRating],
    ...(metadata ? metadataFacts(metadata) : []),
  ]
  const displayedDescription = programme.description || metadata?.overview || undefined
  const images = [
    programme.imageUrl && { url: programme.imageUrl, label: 'Image du guide TV' },
    metadata?.backdropUrl && { url: metadata.backdropUrl, label: 'Image TMDB' },
    metadata?.posterUrl && { url: metadata.posterUrl, label: 'Affiche TMDB' },
  ].filter((image): image is { url: string; label: string } => Boolean(image))
  const selectedImage = images[activeImage % images.length]

  useEffect(() => {
    if (images.length < 2 || imageExpanded) return
    const timer = window.setTimeout(
      () => setActiveImage((current) => (current + 1) % images.length),
      3000,
    )
    return () => window.clearTimeout(timer)
  }, [programme.id, images.length, activeImage, imageExpanded])

  const startImageSwipe = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    if (event.pointerType === 'mouse') {
      lastImageTap.current = null
      touchDoubleClickTime.current = null
    }
    imageSwipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const finishImageSwipe = (event: PointerEvent<HTMLDivElement>) => {
    const start = imageSwipeStart.current
    imageSwipeStart.current = null
    if (!start || start.pointerId !== event.pointerId) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    setActiveImage((current) => (current + (deltaX < 0 ? 1 : -1) + images.length) % images.length)
  }
  const startImageTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      imageTouchStart.current = null
      lastImageTap.current = null
      return
    }
    const touch = event.touches[0]
    imageTouchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const finishImageTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = imageTouchStart.current
    const touch = event.changedTouches[0]
    imageTouchStart.current = null
    if (
      !start ||
      !touch ||
      Math.abs(touch.clientX - start.x) > 20 ||
      Math.abs(touch.clientY - start.y) > 20
    ) {
      lastImageTap.current = null
      return
    }

    const previousTap = lastImageTap.current
    const elapsed = event.timeStamp - (previousTap?.time ?? 0)
    if (
      previousTap &&
      elapsed <= 350 &&
      Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) <= 32
    ) {
      lastImageTap.current = null
      touchDoubleClickTime.current = event.timeStamp
      setImageExpanded((expanded) => !expanded)
      return
    }

    lastImageTap.current = { x: touch.clientX, y: touch.clientY, time: event.timeStamp }
  }
  const toggleImageExpanded = (event: React.MouseEvent<HTMLDivElement>) => {
    const touchDoubleClick = touchDoubleClickTime.current
    touchDoubleClickTime.current = null
    if (touchDoubleClick !== null && event.timeStamp - touchDoubleClick <= 500) return
    setImageExpanded((expanded) => !expanded)
  }

  const startEdgeGesture = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    const rightEdge = event.currentTarget.getBoundingClientRect().right
    touchStart.current =
      touch && touch.clientX >= rightEdge - 40 ? { x: touch.clientX, y: touch.clientY } : null
  }
  const finishEdgeGesture = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    touchStart.current = null
    if (
      start &&
      touch &&
      start.x - touch.clientX > 48 &&
      start.x - touch.clientX > Math.abs(start.y - touch.clientY)
    )
      onScheduleOpenChange(true)
  }

  return (
    <main
      className="detail-screen"
      onTouchStart={startEdgeGesture}
      onTouchEnd={finishEdgeGesture}
      onTouchCancel={() => {
        touchStart.current = null
      }}
    >
      <div className="detail-layout">
        <section
          className="detail-page"
          aria-labelledby="detail-title"
          onClick={() => {
            if (scheduleOpen) onScheduleOpenChange(false)
          }}
        >
          <div className="detail-toolbar">
            <button
              className="detail-back"
              onClick={handleBack}
              aria-label={previewKey ? 'Retour à la fiche du programme' : 'Retour au guide'}
            >
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path d="M19.5 5 8.5 16l11 11M9 16h15" />
              </svg>
            </button>
            <span className="detail-broadcast-logo" aria-hidden="true">
              {channel?.icon && !brokenChannelIcon ? (
                <img src={channel.icon} alt="" onError={() => setBrokenChannelIcon(true)} />
              ) : (
                <span>{channel?.name.slice(0, 5) ?? 'TV'}</span>
              )}
            </span>
            <div className="detail-broadcast">
              <span className="detail-broadcast-channel">{channel?.name ?? 'Programme TV'}</span>
              <span className="detail-broadcast-time">
                {broadcastTimeFormatter.format(new Date(programme.start))}
                {' — '}
                {broadcastTimeFormatter.format(new Date(programme.end))}
                {' · '}
                {broadcastDate}
              </span>
            </div>
            {progress.status === 'ended' && (
              <span className="detail-broadcast-status" role="status">
                Terminé
              </span>
            )}
          </div>
          {selectedImage && (
            <>
              <div
                className={`hero-slide ${imageExpanded ? 'image-expanded' : ''}`}
                aria-roledescription="carrousel"
                aria-label="Images du programme"
                onPointerDown={startImageSwipe}
                onPointerUp={finishImageSwipe}
                onTouchStart={startImageTouch}
                onTouchEnd={finishImageTouch}
                onTouchCancel={() => {
                  imageTouchStart.current = null
                  lastImageTap.current = null
                }}
                onDoubleClick={toggleImageExpanded}
                onPointerCancel={() => {
                  imageSwipeStart.current = null
                }}
              >
                <img
                  key={selectedImage.url}
                  className="hero"
                  src={selectedImage.url}
                  alt={`${selectedImage.label} pour ${programme.title}`}
                  draggable={false}
                />
              </div>
              {images.length > 1 && (
                <div className="hero-pagination" aria-label="Choisir une image">
                  {images.map((image, index) => (
                    <button
                      key={image.url}
                      type="button"
                      className={`hero-pagination-dot ${activeImage % images.length === index ? 'active' : ''}`}
                      onClick={() => setActiveImage(index)}
                      aria-label={`Afficher ${image.label.toLocaleLowerCase('fr-FR')} (${index + 1}/${images.length})`}
                      aria-pressed={activeImage % images.length === index}
                    />
                  ))}
                </div>
              )}
              {progress.status === 'current' && (
                <div className="detail-progress" aria-hidden="true">
                  <span style={{ width: `${progress.progress}%` }} />
                </div>
              )}
            </>
          )}
          <div className="modal-content">
            <div className="detail-title-row">
              <h2 id="detail-title">{programme.title}</h2>
            </div>
            <div className="detail-info-row">
              <div className="detail-info-main">
                <p className="meta">
                  {[
                    `${programme.durationMinutes} min`,
                    programme.category,
                    programme.season !== undefined && `Saison ${programme.season}`,
                    programme.episode !== undefined && `Épisode ${programme.episode}`,
                    programme.isNew && 'Inédit',
                    programme.isLive && 'En direct',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {metadata && metadata.title !== programme.title && (
                  <p className="media-original-title">
                    Fiche TMDB : {metadata.title}
                    {metadata.originalTitle && metadata.originalTitle !== metadata.title
                      ? ` · Titre original : ${metadata.originalTitle}`
                      : ''}
                  </p>
                )}
                {programme.subtitle && <h3>{programme.subtitle}</h3>}
                {metadata?.year && (
                  <p className="media-release-year">
                    <span>{metadata.year}</span>
                    {' · '}
                    <a href={metadata.tmdbUrl} target="_blank" rel="noreferrer">
                      TMDB
                    </a>
                    {' · '}
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Rechercher ${googleSearchQuery} sur Google`}
                    >
                      Google
                    </a>
                  </p>
                )}
              </div>
              {tmdbScore !== undefined && (
                <div className="tmdb-score" aria-label={`Note TMDB ${tmdbScore} sur 10`}>
                  <div className="tmdb-score-value">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9L12 2.8Z" />
                    </svg>
                    <strong>{tmdbScore}</strong>
                    <span>/ 10</span>
                  </div>
                  <span className="tmdb-score-caption">
                    Note TMDB
                    {metadata?.voteCount != null &&
                      ` · ${new Intl.NumberFormat('fr-FR').format(metadata.voteCount)} votes`}
                  </span>
                </div>
              )}
            </div>
            <p className={`description ${displayedDescription ? '' : 'muted'}`}>
              {displayedDescription || 'Aucun résumé disponible.'}
            </p>
            {previewMetadata?.overview && previewMetadata.overview !== displayedDescription && (
              <>
                <h3>Résumé TMDB</h3>
                <p className="description">{previewMetadata.overview}</p>
              </>
            )}
            {isLoading && (
              <p className="enrichment-status" role="status">
                <span className="mini-spinner" /> Recherche d’un complément…
              </p>
            )}
            {(currentResult?.status === 'ambiguous' ||
              (currentResult?.status === 'not-found' && suggestions.length > 0) ||
              (matchedAutomatically && showMatchedSuggestions)) && (
              <div className="enrichment-status ambiguity-results" role="status">
                <p>
                  {currentResult.status === 'matched'
                    ? 'La fiche affichée a été retenue automatiquement. Consultez les scores pour voir les critères qui ont justifié ce choix.'
                    : currentResult.status === 'ambiguous'
                      ? 'Plusieurs fiches sont plausibles.'
                      : 'Aucune fiche n’a été identifiée automatiquement, mais voici des propositions.'}{' '}
                  {currentResult.status !== 'matched' &&
                    'Comparez les dates et résumés, puis ouvrez une fiche TMDB pour examiner ses informations.'}
                </p>
                {currentResult.status === 'matched' && (
                  <button
                    type="button"
                    className="alternative-back"
                    onClick={() => {
                      clearAlternative()
                      setShowMatchedSuggestions(false)
                    }}
                  >
                    Masquer les propositions
                  </button>
                )}
                {currentResult.status === 'ambiguous' && currentResult.response?.evidence && (
                  <p>
                    Indices : titre de série{' '}
                    {currentResult.response.evidence.seriesTitleExact ? 'identique' : 'différent'}
                    {currentResult.response.evidence.seriesYearMatch === null
                      ? ', année non disponible'
                      : currentResult.response.evidence.seriesYearMatch
                        ? ', année concordante'
                        : ', année différente'}
                    {currentResult.response.evidence.episodeNumberOffset !== null &&
                      `, épisode TMDB décalé de ${currentResult.response.evidence.episodeNumberOffset}`}
                    .
                  </p>
                )}
                {previewKey && (
                  <button className="alternative-back" onClick={clearAlternative}>
                    Retour aux propositions
                  </button>
                )}
                {previewLoading && <p>Chargement de la fiche TMDB…</p>}
                {previewError && <p className="enrichment-error">{previewError}</p>}
                {!previewKey &&
                  suggestions.map((item) => (
                    <div
                      className={`match-alternative-wrap ${
                        currentResult.status === 'matched' &&
                        currentResult.response?.match?.providerId === item.providerId &&
                        currentResult.response.match.mediaType === item.mediaType
                          ? 'selected'
                          : ''
                      }`}
                      key={`${item.mediaType}:${item.providerId}`}
                    >
                      <button
                        type="button"
                        className="match-score-trigger"
                        onPointerDown={(event) => event.stopPropagation()}
                        onTouchStart={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          openScoreDetails(item)
                        }}
                        aria-label={`Comprendre le taux de matching de ${item.title} : ${scoreLabel(item.confidence)} %`}
                        aria-haspopup="dialog"
                      >
                        {scoreLabel(item.confidence)} %
                      </button>
                      <button
                        type="button"
                        className={`match-alternative ${
                          currentResult.status === 'matched' &&
                          currentResult.response?.match?.providerId === item.providerId &&
                          currentResult.response.match.mediaType === item.mediaType
                            ? 'selected'
                            : ''
                        }`}
                        onClick={() => void selectAlternative(item)}
                      >
                        {item.posterUrl && <img src={item.posterUrl} alt="" loading="lazy" />}
                        <span>
                          <strong>{item.title}</strong>
                          {currentResult.status === 'matched' &&
                            currentResult.response?.match?.providerId === item.providerId &&
                            currentResult.response.match.mediaType === item.mediaType && (
                              <span className="match-alternative-selected">
                                Retenue automatiquement
                              </span>
                            )}
                          <span>
                            {item.year ?? (item.date ? localizedDate(item.date) : 'Date inconnue')}
                            {' · '}
                            {item.mediaType === 'tv' ? 'Série' : 'Film'}
                          </span>
                          {item.genres && item.genres.length > 0 && (
                            <span>{item.genres.join(', ')}</span>
                          )}
                          {item.overview && <span>{item.overview}</span>}
                        </span>
                      </button>
                    </div>
                  ))}
              </div>
            )}
            {matchedAutomatically && !showMatchedSuggestions && (
              <div className="enrichment-status matched-proposals">
                <p>
                  Correspondance automatique : {matchedMetadata?.title ?? 'fiche TMDB'} (
                  {scoreLabel(currentResult.response?.match?.confidence ?? 0)} %).
                </p>
                <button type="button" onClick={() => setShowMatchedSuggestions(true)}>
                  Voir les propositions TMDB ({suggestions.length})
                </button>
              </div>
            )}
            {currentResult?.status === 'error' && (
              <p className="enrichment-status enrichment-error" role="status">
                {currentResult.message || 'Complément indisponible.'}{' '}
                <button onClick={() => setRetry((value) => value + 1)}>Réessayer</button>
              </p>
            )}
            {currentResult?.status === 'not-found' && (
              <div className="enrichment-status">
                <p>Aucun complément identifié avec certitude.</p>
                {suggestions.length === 0 && <p>Aucune proposition disponible.</p>}
              </div>
            )}
            {previewMetadata &&
              (currentResult?.status === 'ambiguous' || currentResult?.status === 'not-found') && (
                <p className="enrichment-status">
                  Fiche consultée : {previewMetadata.title}. Cette sélection reste une proposition
                  et ne modifie pas automatiquement la correspondance.
                </p>
              )}
            {currentResult?.status === 'matched' &&
              currentResult.response?.cache.source === 'stale' && (
                <p className="enrichment-status">
                  Complément en cache, actualisation momentanément indisponible.
                </p>
              )}
            {facts.some((entry) => entry[1]) && (
              <dl className="programme-facts">
                {facts
                  .filter((entry) => !!entry[1])
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {metadata && (
              <>
                {metadata.cast.length > 0 && (
                  <MediaCast cast={metadata.cast} title="Distribution" />
                )}
                {metadata.guestCast.length > 0 && (
                  <MediaCast cast={metadata.guestCast} title="Invités de l’épisode" />
                )}
                {metadata.episodeTitle && <h3>Épisode : {metadata.episodeTitle}</h3>}
                {metadata.episodeOriginalTitle &&
                  metadata.episodeOriginalTitle !== metadata.episodeTitle && (
                    <p className="media-original-title">
                      Titre original : {metadata.episodeOriginalTitle}
                    </p>
                  )}
                {metadata.episodeOverview && (
                  <p className="description">{metadata.episodeOverview}</p>
                )}
                {metadata.episodeAirDate && (
                  <p className="media-release-year">
                    Diffusion de l’épisode : {localizedDate(metadata.episodeAirDate)}
                  </p>
                )}
                <p className="tmdb-attribution">
                  <a href={metadata.tmdbUrl} target="_blank" rel="noreferrer">
                    TMDB
                  </a>
                  <span>
                    Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.
                  </span>
                </p>
              </>
            )}
          </div>
        </section>
        {scheduleOpen && (
          <aside className="channel-schedule" id="channel-schedule">
            <h2>Programmes de {channel?.name || 'la chaîne'}</h2>
            <p className="schedule-date">
              {scheduleDayFormatter.format(new Date(programme.start))}
            </p>
            <div
              className="channel-schedule-list"
              ref={scheduleScroller}
              onScroll={loadScheduleWindow}
              onWheel={() => {
                scheduleSelectionPinned.current = false
                scheduleLoadEnabled.current = true
              }}
              onTouchStart={() => {
                scheduleSelectionPinned.current = false
                scheduleLoadEnabled.current = true
              }}
              onPointerDown={() => {
                scheduleSelectionPinned.current = false
                scheduleLoadEnabled.current = true
              }}
              onKeyDown={() => {
                scheduleSelectionPinned.current = false
                scheduleLoadEnabled.current = true
              }}
              role="region"
              aria-label={`Programmes de ${channel?.name || 'la chaîne'}`}
              tabIndex={0}
            >
              {visibleSchedule.map((item, index) => {
                const scheduleIndex = visibleScheduleRange.start + index
                const itemDate = dateKey(new Date(item.start))
                const previousDate =
                  scheduleIndex > 0 ? dateKey(new Date(schedule[scheduleIndex - 1].start)) : null
                const duration =
                  item.durationMinutes ??
                  (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000
                const showImage = Boolean(item.imageUrl) && duration >= 45
                const itemProgress = programmeProgress(item, clock)
                const startedYesterday = programmeStartedYesterday(item, clock)
                return (
                  <Fragment key={item.id}>
                    {itemDate !== previousDate && (
                      <div className="schedule-day-label">
                        {scheduleDayFormatter.format(new Date(item.start))}
                      </div>
                    )}
                    <button
                      className={`channel-schedule-programme ${item.id === programme.id ? 'current' : ''} ${itemProgress.status === 'ended' ? 'ended' : ''}`}
                      onClick={() => onSelect(item)}
                      aria-current={item.id === programme.id ? 'true' : undefined}
                      data-current-programme={item.id === programme.id}
                      data-schedule-index={scheduleIndex}
                    >
                      <span>
                        {timeLabel(item.start)}
                        {startedYesterday && (
                          <span className="programme-time-yesterday"> (hier)</span>
                        )}
                      </span>
                      <strong>{item.title}</strong>
                      {showImage && item.imageUrl && (
                        <img
                          className="channel-schedule-image"
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          onLoad={keepScheduleSelectionAtTop}
                          onError={(event) => {
                            event.currentTarget.hidden = true
                            keepScheduleSelectionAtTop()
                          }}
                        />
                      )}
                      {item.subtitle && <span className="schedule-subtitle">{item.subtitle}</span>}
                      <span className="schedule-meta">
                        {[duration && `${duration} min`, item.category].filter(Boolean).join(' · ')}
                      </span>
                      {itemProgress.status === 'current' && (
                        <span className="schedule-progress" aria-label="Émission en cours">
                          <span style={{ width: `${itemProgress.progress}%` }} />
                        </span>
                      )}
                    </button>
                  </Fragment>
                )
              })}
            </div>
          </aside>
        )}
        {!scheduleOpen && (
          <button
            type="button"
            className="schedule-edge-hit-area"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => onScheduleOpenChange(true)}
          />
        )}
        <button
          className={`schedule-edge-handle ${scheduleOpen ? 'open' : ''}`}
          onClick={() => onScheduleOpenChange(!scheduleOpen)}
          aria-label={
            scheduleOpen
              ? 'Masquer les programmes de la chaîne'
              : 'Afficher les programmes de la chaîne'
          }
          aria-expanded={scheduleOpen}
          aria-controls={scheduleOpen ? 'channel-schedule' : undefined}
          title={
            scheduleOpen
              ? 'Masquer les programmes de la chaîne'
              : 'Afficher les programmes de la chaîne'
          }
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={scheduleOpen ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} />
          </svg>
        </button>
      </div>
      {scoreAlternative && (
        <div
          className="matching-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setScoreAlternative(null)
          }}
        >
          <section
            ref={scoreDialogRef}
            className="matching-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="matching-dialog-title"
            tabIndex={-1}
          >
            <button
              type="button"
              className="matching-dialog-close"
              onClick={() => setScoreAlternative(null)}
              aria-label="Fermer le détail du matching"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
            <h2 id="matching-dialog-title">Pourquoi ce taux de matching ?</h2>
            <p className="matching-dialog-candidate">
              {scoreAlternative.title}
              {scoreAlternative.year ? ` · ${scoreAlternative.year}` : ''}
              {' — '}
              <strong>{scoreLabel(scoreAlternative.confidence)} %</strong>
            </p>
            {scoreAlternative.scoring ? (
              <>
                <p className="matching-dialog-score-note">
                  {scoreAlternative.scoring.method === 'standard'
                    ? `${scoreLabel(scoreAlternative.scoring.points)} points bruts. Le taux est plafonné à 100 %; le barème maximal est de 160 points.`
                    : `${scoreLabel(scoreAlternative.scoring.points)} points sur ${scoreLabel(scoreAlternative.scoring.maximumPoints)} disponibles; le taux est normalisé sur les critères renseignés.`}
                </p>
                <div className="matching-table-scroll">
                  <table className="matching-table">
                    <thead>
                      <tr>
                        <th>Critère</th>
                        <th>XMLTV</th>
                        <th>TMDB</th>
                        <th>Points / résultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreAlternative.scoring.criteria.map((criterion) => (
                        <tr key={criterion.id}>
                          <th scope="row">{criterion.label}</th>
                          <td>{criterion.xmltvValue || 'Non renseigné'}</td>
                          <td>{criterion.tmdbValue || 'Non renseigné'}</td>
                          <td>
                            {criterion.status === 'unavailable'
                              ? `${criterionStatusLabel(criterion.status)}${criterion.maximumPoints === null ? '' : ` · barème max. ${scoreLabel(criterion.maximumPoints)} pts`}`
                              : criterion.maximumPoints === null
                                ? typeof criterion.similarity !== 'number'
                                  ? criterionStatusLabel(criterion.status)
                                  : `${criterionStatusLabel(criterion.status)} · similarité ${scoreLabel(criterion.similarity * 100)} %`
                                : `${scoreLabel(criterion.points)} / ${scoreLabel(criterion.maximumPoints)} pts · ${criterionStatusLabel(criterion.status)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {scoreAlternative.scoring.selectionChecks &&
                  scoreAlternative.scoring.selectionChecks.length > 0 && (
                    <section
                      className="matching-selection-checks"
                      aria-label="Règles de sélection automatique"
                    >
                      <h3>
                        {currentResult?.status === 'matched'
                          ? 'Pourquoi cette fiche a été sélectionnée automatiquement'
                          : 'Pourquoi la sélection automatique a été refusée'}
                      </h3>
                      <p>
                        Les conditions sont cumulatives : un score minimal atteint ne suffit pas à
                        lui seul. La proposition n’est retenue automatiquement que si toutes les
                        conditions sont remplies.
                      </p>
                      <ul>
                        {scoreAlternative.scoring.selectionChecks.map((check) => (
                          <li key={check.label} className={check.passed ? 'passed' : 'failed'}>
                            <strong>
                              {check.passed ? 'Condition remplie' : 'Condition bloquante'} —{' '}
                              {check.label}.
                            </strong>{' '}
                            {check.detail}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
              </>
            ) : isLoading ? (
              <p className="matching-dialog-score-note" role="status">
                <span className="mini-spinner" /> Actualisation du détail du matching…
              </p>
            ) : currentResult?.status === 'error' ? (
              <p className="matching-dialog-score-note enrichment-error" role="alert">
                La recherche relancée a échoué :{' '}
                {currentResult.message || 'Complément momentanément indisponible.'}
              </p>
            ) : (
              <p className="matching-dialog-score-note">
                Le détail du calcul n’est pas disponible pour cette réponse. La recherche a été
                relancée automatiquement à l’ouverture.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
