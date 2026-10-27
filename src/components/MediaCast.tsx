import { useState } from 'react'
import type { MediaCastMember } from '../models/media'

function CastCard({ person }: { person: MediaCastMember }) {
  const [failed, setFailed] = useState(!person.profileUrl)
  return (
    <li className="media-cast-card">
      {person.profileUrl && !failed ? (
        <img
          src={person.profileUrl}
          alt={`Portrait de ${person.name}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="cast-avatar" aria-hidden="true">
          {person.name.trim().charAt(0).toLocaleUpperCase('fr-FR') || '?'}
        </span>
      )}
      <span className="cast-name">{person.name}</span>
      {person.character && <span className="cast-character">{person.character}</span>}
    </li>
  )
}

export function MediaCast({ cast, title }: { cast: MediaCastMember[]; title: string }) {
  if (!cast.length) return null
  return (
    <section className="media-cast" aria-label={`Distribution de ${title}`}>
      <h3>{title}</h3>
      <ul>
        {cast
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((person, index) => (
            <CastCard key={`${person.providerId ?? person.name}-${index}`} person={person} />
          ))}
      </ul>
    </section>
  )
}
