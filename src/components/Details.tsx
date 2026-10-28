import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { Channel, TVProgramme } from '../models/tv'
import type { MatchAlternative, MatchResponse, MediaMetadata } from '../models/media'
import { classifyProgramme } from '../services/media/classify'
import { enrichProgramme, fetchMediaDetails } from '../services/media/client'
import { dateKey, programmeProgress, timeLabel } from '../utils/dates'
import { googlePersonSearchUrl } from '../utils/links'
import { MediaCast } from './MediaCast'

const broadcastTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  timeStyle: 'short',
})

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
  const [brokenChannelIcon, setBrokenChannelIcon] = useState(false)
  const [activeImage, setActiveImage] = useState(0)
  const [clock, setClock] = useState(() => new Date())
  const scheduleScroller = useRef<HTMLDivElement>(null)
  const previewController = useRef<AbortController | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const imageSwipeStart = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const mediaType = classifyProgramme(programme)
  useEffect(() => {
    setBrokenChannelIcon(false)
  }, [channel?.icon])
  useEffect(() => {
    setActiveImage(0)
  }, [programme.id])
  const clearAlternative = () => {
    previewController.current?.abort()
    setPreviewKey(null)
    setPreviewMetadata(null)
    setPreviewLoading(false)
    setPreviewError(null)
  }
  const handleBack = () => {
    if (previewKey) clearAlternative()
    else onClose()
  }
  const schedule = useMemo(
    () =>
      channelProgrammes
        .filter((item) => dateKey(new Date(item.start)) === dateKey(new Date(programme.start)))
        .sort((a, b) => a.start.localeCompare(b.start)),
    [channelProgrammes, programme.start],
  )
  const progress = programmeProgress(programme, clock)

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
    if (!scheduleOpen) return
    const active = scheduleScroller.current?.querySelector<HTMLElement>(
      '[data-current-programme="true"]',
    )
    if (active && scheduleScroller.current) {
      scheduleScroller.current.scrollTop +=
        active.getBoundingClientRect().top - scheduleScroller.current.getBoundingClientRect().top
    }
  }, [scheduleOpen])

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
  const suggestions =
    currentResult?.status === 'not-found' || currentResult?.status === 'ambiguous'
      ? (currentResult.response?.alternatives ?? [])
      : []
  const isLoading = Boolean(mediaType && !currentResult)
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
  const googleSearchQuery = [
    programme.title,
    programme.category,
    metadata?.year ?? programme.year,
  ]
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
    if (images.length < 2) return
    const timer = window.setTimeout(
      () => setActiveImage((current) => (current + 1) % images.length),
      3000,
    )
    return () => window.clearTimeout(timer)
  }, [programme.id, images.length, activeImage])

  const startImageSwipe = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return
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

  const startEdgeGesture = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    const rightEdge = event.currentTarget.getBoundingClientRect().right
    touchStart.current =
      touch && touch.clientX >= rightEdge - 40
        ? { x: touch.clientX, y: touch.clientY }
        : null
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
                className="hero-slide"
                aria-roledescription="carrousel"
                aria-label="Images du programme"
                onPointerDown={startImageSwipe}
                onPointerUp={finishImageSwipe}
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
              (currentResult?.status === 'not-found' && suggestions.length > 0)) && (
              <div className="enrichment-status ambiguity-results" role="status">
                <p>
                  {currentResult.status === 'ambiguous'
                    ? 'Plusieurs fiches sont plausibles.'
                    : 'Aucune fiche n’a été identifiée automatiquement, mais voici des propositions.'}{' '}
                  Comparez les dates et résumés, puis ouvrez une fiche TMDB pour examiner ses
                  informations.
                </p>
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
                    <button
                      className="match-alternative"
                      key={`${item.mediaType}:${item.providerId}`}
                      onClick={() => void selectAlternative(item)}
                    >
                      {item.posterUrl && <img src={item.posterUrl} alt="" loading="lazy" />}
                      <span>
                        <strong>{item.title}</strong>
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
                  ))}
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
              {new Intl.DateTimeFormat('fr-FR', {
                timeZone: 'Europe/Paris',
                dateStyle: 'full',
              }).format(new Date(programme.start))}
            </p>
            <div
              className="channel-schedule-list"
              ref={scheduleScroller}
              role="region"
              aria-label={`Programmes de ${channel?.name || 'la chaîne'}`}
              tabIndex={0}
            >
              {schedule.map((item) => {
                const duration =
                  item.durationMinutes ??
                  (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000
                const showImage = Boolean(item.imageUrl) && duration >= 45
                const itemProgress = programmeProgress(item, clock)
                return (
                  <button
                    className={`channel-schedule-programme ${item.id === programme.id ? 'current' : ''} ${itemProgress.status === 'ended' ? 'ended' : ''}`}
                    key={item.id}
                    onClick={() => onSelect(item)}
                    aria-current={item.id === programme.id ? 'true' : undefined}
                    data-current-programme={item.id === programme.id}
                  >
                    <span>{timeLabel(item.start)}</span>
                    <strong>{item.title}</strong>
                    {showImage && item.imageUrl && (
                      <img
                        className="channel-schedule-image"
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true
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
    </main>
  )
}
