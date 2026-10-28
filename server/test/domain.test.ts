import { describe, expect, it } from 'vitest'
import { classifyProgramme } from '../src/domain/classify'
import {
  chooseCandidate,
  chooseTvMovieCandidate,
  rankCandidates,
  rankTvMovieCandidates,
  type SearchCandidate,
} from '../src/domain/match'
import {
  episodeFingerprint,
  fingerprint,
  normalizeTitle,
  parseReleaseYear,
} from '../src/domain/normalize'

const film = {
  title: 'Inception',
  subtitle: null,
  description: null,
  category: 'Film',
  year: '2010',
  durationMinutes: 148,
  season: null,
  episode: null,
  directors: ['Christopher Nolan'],
  actors: ['Leonardo DiCaprio'],
}

const candidate: SearchCandidate = {
  providerId: 27205,
  mediaType: 'movie',
  title: 'Inception',
  originalTitle: 'Inception',
  year: 2010,
  posterPath: '/poster.jpg',
  popularity: 30,
  runtimeMinutes: 148,
  genres: ['Science-Fiction'],
  creditedPeople: ['Christopher Nolan'],
}

describe('media matching', () => {
  it('normalizes search labels without removing articles', () => {
    expect(normalizeTitle('L’été inédit (VF)')).toBe('l ete')
    expect(normalizeTitle('Les douze coups de midi')).toBe('les 12 coups de midi')
  })

  it('uses matching broadcaster and annual season as independent TV evidence', () => {
    const programme = {
      ...film,
      title: 'Les douze coups de midi',
      category: 'Jeu',
      year: null,
      durationMinutes: 65,
      season: 1,
      episode: 59,
      directors: [],
      actors: [],
      channel: 'TF1.fr',
      broadcastDate: '2025-04-15T10:50:00+02:00',
    }
    const show: SearchCandidate = {
      ...candidate,
      mediaType: 'tv',
      title: 'Les 12 coups de midi',
      originalTitle: 'Les 12 coups de midi',
      year: 2010,
      runtimeMinutes: null,
      genres: [],
      creditedPeople: [],
      networks: ['TF1'],
      seasonYears: [2025],
    }
    const ranked = rankCandidates(programme, [show])
    expect(ranked[0].confidence).toBe(85)
    expect(chooseCandidate(programme, ranked).status).toBe('matched')
  })

  it('accepts one unique TV search result with an exact original title', () => {
    const programme = {
      ...film,
      title: 'Les douze coups de midi',
      category: 'Jeu',
      year: null,
      durationMinutes: 65,
      season: 1,
      episode: 59,
      directors: [],
      actors: [],
    }
    const show: SearchCandidate = {
      ...candidate,
      mediaType: 'tv',
      title: 'Les 12 coups de midi',
      originalTitle: 'Les Douze Coups de midi',
      year: 2010,
      runtimeMinutes: 40,
      genres: [],
      creditedPeople: [],
      searchResultCount: 1,
    }
    const ranked = rankCandidates(programme, [show])
    expect(ranked[0].confidence).toBe(80)
    expect(chooseCandidate(programme, ranked).status).toBe('matched')
  })

  it('extracts plausible years from XMLTV year and datetime formats', () => {
    expect(parseReleaseYear('2010')).toBe(2010)
    expect(parseReleaseYear('20100715')).toBe(2010)
    expect(parseReleaseYear('20100715123000 +0200')).toBe(2010)
    expect(parseReleaseYear('1800')).toBeNull()
    expect(parseReleaseYear('unknown')).toBeNull()
  })

  it('classifies by category or episode metadata, never title alone', () => {
    expect(classifyProgramme(film)).toEqual({
      status: 'classified',
      mediaType: 'movie',
      programmeKind: 'movie',
    })
    expect(classifyProgramme({ ...film, category: null, season: 0 })).toEqual({
      status: 'classified',
      mediaType: 'tv',
      programmeKind: 'tv_series',
    })
    expect(classifyProgramme({ ...film, title: 'Film d’action', category: null })).toEqual({
      status: 'unsupported',
    })
    expect(classifyProgramme({ ...film, category: 'Sport', season: 1 })).toEqual({
      status: 'unsupported',
    })
    expect(classifyProgramme({ ...film, season: 1 })).toEqual({ status: 'ambiguous' })
  })

  it('classifies accented telefilm categories as movie searches, not series', () => {
    for (const category of [
      'Téléfilm',
      'Téléfilm policier',
      'TÉLÉFILM DRAMATIQUE',
      'Telefilms',
      'Telefilm Drame',
    ]) {
      expect(classifyProgramme({ ...film, category, season: 9, episode: 16 })).toEqual({
        status: 'classified',
        mediaType: 'movie',
        programmeKind: 'tv_movie',
      })
    }
    expect(classifyProgramme({ ...film, category: 'Série policière' })).toMatchObject({
      status: 'classified',
      mediaType: 'tv',
      programmeKind: 'tv_series',
    })
  })

  it('classifies XMLTV film and series category variants', () => {
    for (const category of [
      'Cinema',
      'Cinéma',
      'Movie',
      'Film Comedie',
      'Film d’animation',
      'Filmreihe',
    ]) {
      expect(classifyProgramme({ ...film, category })).toMatchObject({
        status: 'classified',
        mediaType: 'movie',
        programmeKind: 'movie',
      })
    }
    for (const category of [
      'Series',
      'Série TV',
      'Série humoristique',
      'Serie Policiere',
      'Feuilleton sentimental',
    ]) {
      expect(classifyProgramme({ ...film, category })).toMatchObject({
        status: 'classified',
        mediaType: 'tv',
        programmeKind: 'tv_series',
      })
    }
  })

  it('does not classify cinema magazines and documentaries as movies', () => {
    for (const category of ['Doc Cinéma', 'Documentaire cinéma', 'Mag Cinéma']) {
      expect(classifyProgramme({ ...film, category })).toEqual({ status: 'unsupported' })
    }
  })

  it('classifies a standalone comedy category as a movie unless it is an explicit series', () => {
    for (const category of ['Comédie', 'Comedy', 'Comédie / Divertissement']) {
      expect(classifyProgramme({ ...film, category })).toEqual({
        status: 'classified',
        mediaType: 'movie',
        programmeKind: 'movie',
      })
    }
    expect(classifyProgramme({ ...film, category: 'Série comédie dramatique' })).toEqual({
      status: 'classified',
      mediaType: 'tv',
      programmeKind: 'tv_series',
    })
  })

  it('uses programme kind to keep telefilm fingerprints separate from movie fingerprints', () => {
    expect(fingerprint('movie', film, 'tv_movie')).not.toBe(fingerprint('movie', film, 'movie'))
  })

  it('requires a strong, unambiguous score and rejects identity without year proof', () => {
    const ranked = rankCandidates(film, [candidate])
    expect(ranked[0].confidence).toBe(100)
    expect(chooseCandidate(film, ranked).status).toBe('matched')

    const noYear = rankCandidates({ ...film, year: null }, [candidate])
    expect(noYear[0].confidence).toBe(85)
    expect(chooseCandidate({ ...film, year: null }, noYear).status).toBe('ambiguous')

    const remake = rankCandidates(film, [
      candidate,
      { ...candidate, providerId: 999, popularity: 2 },
    ])
    expect(chooseCandidate(film, remake).status).toBe('ambiguous')
  })

  it('accepts an exact TV title with a close runtime when no candidate is close', () => {
    const episode = {
      ...film,
      title: 'La terre et le sang',
      category: 'Série dramatique',
      year: null,
      durationMinutes: 50,
      season: 1,
      episode: 3,
      directors: [],
      actors: [],
    }
    const series: SearchCandidate = {
      ...candidate,
      providerId: 123,
      mediaType: 'tv',
      title: 'La terre et le sang',
      originalTitle: 'La terre et le sang',
      year: 2020,
      runtimeMinutes: 50,
      genres: ['Drame'],
      creditedPeople: [],
    }
    const ranked = rankCandidates(episode, [series])
    expect(ranked[0].confidence).toBe(85)
    expect(chooseCandidate(episode, ranked).status).toBe('matched')

    const competing = rankCandidates(episode, [
      series,
      { ...series, providerId: 456, runtimeMinutes: 50 },
    ])
    expect(chooseCandidate(episode, competing).status).toBe('ambiguous')

    const wrongRuntime = rankCandidates(episode, [{ ...series, runtimeMinutes: 80 }])
    expect(chooseCandidate(episode, wrongRuntime).status).toBe('ambiguous')
  })

  it('matches 9-1-1 with the exact series title and a close episode duration', () => {
    const programme = {
      ...film,
      title: '9-1-1',
      subtitle: 'Pas de fumée sans feu',
      category: 'Série dramatique',
      year: null,
      durationMinutes: 45,
      season: 9,
      episode: 16,
      directors: [],
      actors: [],
    }
    const series: SearchCandidate = {
      ...candidate,
      providerId: 61888,
      mediaType: 'tv',
      title: '9-1-1',
      originalTitle: '9-1-1',
      year: 2018,
      runtimeMinutes: 43,
      genres: ['Drame'],
      creditedPeople: [],
    }
    const ranked = rankCandidates(programme, [series])
    expect(ranked[0].confidence).toBe(85)
    expect(chooseCandidate(programme, ranked).status).toBe('matched')
  })

  it('matches an exact TV title by genre when TMDB has no runtime', () => {
    const programme = {
      ...film,
      title: '9-1-1',
      subtitle: 'Pas de fumée sans feu',
      category: 'Série dramatique',
      year: null,
      durationMinutes: 45,
      season: 9,
      episode: 16,
      directors: [],
      actors: [],
    }
    const series: SearchCandidate = {
      ...candidate,
      mediaType: 'tv',
      title: '9-1-1',
      originalTitle: '9-1-1',
      year: 2018,
      runtimeMinutes: null,
      genres: ['Drama'],
      creditedPeople: [],
    }
    const alternatives: SearchCandidate[] = [
      { ...series, providerId: 206145, title: 'Panic 9-1-1', originalTitle: 'Panic 9-1-1' },
      {
        ...series,
        providerId: 89393,
        title: '9-1-1: Lone Star',
        originalTitle: '9-1-1: Lone Star',
      },
    ]
    const ranked = rankCandidates(programme, [series, ...alternatives])

    expect(ranked[0].confidence).toBe(70)
    expect(chooseCandidate(programme, ranked)).toMatchObject({
      status: 'matched',
      candidate: { title: '9-1-1' },
    })
  })

  it('matches an XMLTV game show with the TMDB Reality genre', () => {
    const programme = {
      ...film,
      title: 'Une famille en or',
      category: 'Jeu',
      year: null,
      durationMinutes: 60,
      directors: [],
      actors: [],
    }
    const show: SearchCandidate = {
      ...candidate,
      mediaType: 'tv',
      title: 'Une Famille en Or',
      originalTitle: 'Une Famille en Or',
      year: 1986,
      runtimeMinutes: 90,
      genres: ['Reality', 'Family'],
      creditedPeople: [],
    }

    const ranked = rankCandidates(programme, [show])

    expect(ranked[0].confidence).toBe(75)
    expect(chooseCandidate(programme, ranked).status).toBe('ambiguous')
  })

  it('scores XMLTV duration bands and only adds genre points for known matching genres', () => {
    const crimeFilm = { ...film, category: 'Film policier', year: null }
    const crimeCandidate: SearchCandidate = {
      ...candidate,
      runtimeMinutes: 148,
      genres: ['Crime'],
      creditedPeople: [],
    }

    expect(rankCandidates(crimeFilm, [crimeCandidate])[0].confidence).toBe(85)
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: 153 }, [crimeCandidate])[0].confidence,
    ).toBe(85)
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: 158 }, [crimeCandidate])[0].confidence,
    ).toBe(85)
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: 168 }, [crimeCandidate])[0].confidence,
    ).toBe(85)
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: 178 }, [crimeCandidate])[0].confidence,
    ).toBe(75)
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: 179 }, [crimeCandidate])[0].confidence,
    ).toBe(70)
    expect(
      rankCandidates(crimeFilm, [{ ...crimeCandidate, genres: ['Comédie'] }])[0].confidence,
    ).toBe(75)
    expect(rankCandidates({ ...crimeFilm, category: 'Film' }, [crimeCandidate])[0].confidence).toBe(
      75,
    )
    expect(
      rankCandidates({ ...crimeFilm, durationMinutes: null }, [crimeCandidate])[0].confidence,
    ).toBe(70)
  })

  it('normalizes telefilm confidence over available evidence and requires non-title proof', () => {
    const telefilm = {
      ...film,
      title: 'Les farouches',
      subtitle: null,
      description:
        'Deux policiers aux caractères opposés, qui se détestent, apprennent que leurs enfants sont en couple.',
      category: 'Téléfilm policier',
      year: null,
      durationMinutes: 90,
      directors: [],
      actors: [],
    }
    const exact: SearchCandidate = {
      ...candidate,
      title: 'Les farouches',
      originalTitle: 'The Tough Ones',
      year: 2020,
      runtimeMinutes: 95,
      genres: ['Crime'],
      creditedPeople: [],
      overview:
        'Deux policiers aux caractères opposés se détestent, puis apprennent que leurs enfants sont en couple.',
    }
    const other: SearchCandidate = {
      ...exact,
      providerId: 456,
      title: 'Les farouches',
      originalTitle: 'Les farouches',
      runtimeMinutes: 130,
      overview: 'Une famille se retrouve après un long voyage.',
      popularity: 50,
    }
    const ranked = rankTvMovieCandidates(telefilm, [exact, other])

    expect(ranked[0].confidence).toBe(100)
    expect(chooseTvMovieCandidate(ranked)).toMatchObject({
      status: 'matched',
      candidate: { providerId: exact.providerId },
    })

    const titleOnly = rankTvMovieCandidates(
      { ...telefilm, description: null, durationMinutes: null },
      [{ ...exact, overview: null, runtimeMinutes: null }],
    )
    expect(titleOnly[0].confidence).toBe(100)
    expect(chooseTvMovieCandidate(titleOnly).status).toBe('ambiguous')
  })

  it('matches Mélodie en sous-sol using exact title, duration and crime genre', () => {
    const programme = {
      ...film,
      title: 'Mélodie en sous-sol',
      category: 'Film policier',
      year: null,
      durationMinutes: 120,
      directors: [],
      actors: [],
    }
    const tmdbMovie: SearchCandidate = {
      ...candidate,
      providerId: 12345,
      title: 'Mélodie en sous-sol',
      originalTitle: 'Any Number Can Win',
      year: 1963,
      runtimeMinutes: 118,
      genres: ['Crime'],
      creditedPeople: [],
    }
    const ranked = rankCandidates(programme, [tmdbMovie])

    expect(ranked[0].confidence).toBe(85)
    expect(chooseCandidate(programme, ranked)).toMatchObject({
      status: 'matched',
      candidate: { providerId: 12345 },
    })
  })

  it('matches exact movies when the longer broadcast slot fits the ad-time allowance', () => {
    const programme = {
      ...film,
      durationMinutes: 160,
      category: 'Film science-fiction',
      year: null,
      directors: [],
      actors: [],
    }
    const best = rankCandidates(programme, [
      { ...candidate, genres: ['Science-Fiction'], creditedPeople: [] },
    ])[0]
    expect(best.confidence).toBe(85)

    const ranked = [best, { ...best, providerId: 999, title: 'Autre film', confidence: 69 }]
    expect(chooseCandidate(programme, ranked)).toMatchObject({
      status: 'matched',
      candidate: { providerId: best.providerId },
    })
    expect(chooseCandidate(programme, [best, { ...ranked[1], confidence: 76 }]).status).toBe(
      'ambiguous',
    )

    const longerMovie = { ...best, runtimeMinutes: 170 }
    expect(rankCandidates(programme, [longerMovie])[0].confidence).toBe(83)
    expect(chooseCandidate(programme, rankCandidates(programme, [longerMovie])).status).toBe(
      'ambiguous',
    )
  })

  it('uses the 12-minute advertising cap for a 60-minute XMLTV slot', () => {
    const programme = {
      ...film,
      durationMinutes: 60,
      category: 'Film science-fiction',
      year: null,
      directors: [],
      actors: [],
    }
    const oneHourFilm = {
      ...candidate,
      runtimeMinutes: 48,
      genres: ['Science-Fiction'],
      creditedPeople: [],
    }
    expect(rankCandidates(programme, [oneHourFilm])[0].confidence).toBe(85)
  })

  it('calculates the advertising allowance from the XMLTV broadcast slot', () => {
    const programme = {
      ...film,
      durationMinutes: 141,
      category: 'Film science-fiction',
      year: null,
      directors: [],
      actors: [],
    }
    const movie: SearchCandidate = {
      ...candidate,
      runtimeMinutes: 120,
      genres: ['Science-Fiction'],
      creditedPeople: [],
    }
    const ranked = rankCandidates(programme, [movie])
    expect(ranked[0].confidence).toBe(85)
    expect(chooseCandidate(programme, ranked).status).toBe('matched')
  })

  it('fingerprints identity independently from broadcast occurrence', () => {
    expect(fingerprint('movie', film)).toBe(
      fingerprint('movie', { ...film, subtitle: 'Version TV' }),
    )
    expect(fingerprint('movie', film)).not.toBe(fingerprint('tv', film))
  })

  it('keeps negative TV match cache entries specific to one episode', () => {
    const episode = { ...film, season: 9, episode: 16 }
    const nextEpisode = { ...film, season: 9, episode: 17 }
    const seriesFingerprint = fingerprint('tv', episode)

    expect(episodeFingerprint(seriesFingerprint, episode)).not.toBe(
      episodeFingerprint(seriesFingerprint, nextEpisode),
    )
    expect(episodeFingerprint(seriesFingerprint, { ...episode, episode: null })).toBe(
      seriesFingerprint,
    )
  })
})
