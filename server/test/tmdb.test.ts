import { afterEach, describe, expect, it, vi } from 'vitest'
import { TmdbProvider } from '../src/providers/tmdb'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TMDB provider', () => {
  it('traces TMDB GET requests without logging the access token', async () => {
    const traces: unknown[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      return new Response(
        JSON.stringify(
          url.pathname.endsWith('/configuration')
            ? {
                images: {
                  secure_base_url: 'https://image.tmdb.org/t/p/',
                  poster_sizes: ['w500'],
                  backdrop_sizes: ['w780'],
                  profile_sizes: ['w185'],
                },
              }
            : { results: [] },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('never-log-this-token')
    provider.setTraceLogger((trace) => traces.push(trace))

    await provider.search('9-1-1', 'tv', null, new AbortController().signal)

    expect(traces).toContainEqual({
      phase: 'request',
      method: 'GET',
      url: 'https://api.themoviedb.org/3/search/tv?query=9-1-1&language=fr-FR&include_adult=false',
      body: null,
      attempt: 1,
    })
    expect(traces).toContainEqual({
      phase: 'response',
      method: 'GET',
      url: 'https://api.themoviedb.org/3/search/tv?query=9-1-1&language=fr-FR&include_adult=false',
      body: null,
      attempt: 1,
      status: 200,
    })
    expect(JSON.stringify(traces)).not.toContain('never-log-this-token')
  })

  it('keeps title search results when also searching an episode subtitle', async () => {
    const queries: string[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/configuration'))
        return new Response(
          JSON.stringify({
            images: {
              secure_base_url: 'https://image.tmdb.org/t/p/',
              poster_sizes: ['w500'],
              backdrop_sizes: ['w780'],
              profile_sizes: ['w185'],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      if (url.pathname.endsWith('/search/tv')) {
        const query = url.searchParams.get('query') ?? ''
        queries.push(query)
        const result =
          query === '9-1-1'
            ? {
                id: 911,
                name: '9-1-1: Lone Star',
                original_name: '9-1-1: Lone Star',
                first_air_date: '2018-01-03',
              }
            : {
                id: 916,
                name: 'Pas de fumée sans feu',
                original_name: 'No Smoke Without Fire',
                first_air_date: '2025-01-01',
              }
        return new Response(JSON.stringify({ results: [result] }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected TMDB URL: ${url}`)
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('server-only-token')
    const result = await provider.searchCandidates(
      {
        title: '9-1-1',
        subtitle: 'Pas de fumée sans feu',
        description: null,
        category: 'Série dramatique',
        year: null,
        durationMinutes: 45,
        season: 9,
        episode: 16,
        directors: [],
        actors: [],
      },
      'tv',
      new AbortController().signal,
    )

    expect(queries).toEqual(['9-1-1', 'Pas de fumée sans feu'])
    expect(result.candidates.map((candidate) => candidate.providerId)).toEqual([911, 916])
    expect(result.candidates.every((candidate) => candidate.genres.length === 0)).toBe(true)
  })

  it('does not constrain telefilm searches by the XMLTV year', async () => {
    const searchUrls: URL[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/configuration'))
        return new Response(JSON.stringify({ images: {} }), {
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.pathname.endsWith('/search/movie')) {
        searchUrls.push(url)
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 123,
                title: 'Les Farouches',
                original_title: 'Les Farouches',
                release_date: '2021-01-01',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected TMDB URL: ${url}`)
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('server-only-token')
    const result = await provider.searchCandidates(
      {
        title: 'Les Farouches',
        subtitle: null,
        description: null,
        category: 'Téléfilm policier',
        year: '2026',
        durationMinutes: 90,
        season: null,
        episode: null,
        directors: [],
        actors: [],
      },
      'movie',
      new AbortController().signal,
    )

    expect(searchUrls).toHaveLength(1)
    expect(searchUrls[0].searchParams.get('query')).toBe('Les Farouches')
    expect(searchUrls[0].searchParams.get('language')).toBe('fr-FR')
    expect(searchUrls[0].searchParams.has('year')).toBe(false)
    expect(result.candidates.map((candidate) => candidate.providerId)).toEqual([123])
  })

  it('falls back to TMDB TV search when a telefilm is not indexed as a movie', async () => {
    const searchTypes: string[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/configuration'))
        return new Response(JSON.stringify({ images: {} }), {
          headers: { 'Content-Type': 'application/json' },
        })
      if (url.pathname.startsWith('/3/search/')) {
        const mediaType = url.pathname.endsWith('/movie') ? 'movie' : 'tv'
        searchTypes.push(mediaType)
        const result =
          mediaType === 'movie'
            ? []
            : [
                {
                  id: 291612,
                  name: 'Les Farouches',
                  original_name: 'Les Farouches',
                  first_air_date: '2026-10-19',
                },
              ]
        return new Response(JSON.stringify({ results: result }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected TMDB URL: ${url}`)
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('server-only-token')
    const result = await provider.searchCandidates(
      {
        title: 'Les Farouches',
        subtitle: null,
        description: null,
        category: 'Téléfilm policier',
        year: null,
        durationMinutes: 90,
        season: null,
        episode: null,
        directors: [],
        actors: [],
      },
      'movie',
      new AbortController().signal,
    )

    expect(searchTypes).toEqual(['movie', 'tv'])
    expect(result.candidates).toMatchObject([
      { providerId: 291612, mediaType: 'tv', title: 'Les Farouches' },
    ])
  })

  it('uses approved CDN paths and aggregate series credits', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    const fetchMock: typeof fetch = async (input, init) => {
      const requestUrl =
        typeof input === 'string' || input instanceof URL ? input.toString() : input.url
      const url = new URL(requestUrl)
      calls.push({ url, init })
      const body = url.pathname.endsWith('/configuration')
        ? {
            images: {
              secure_base_url: 'https://image.tmdb.org/t/p/',
              poster_sizes: ['w500', 'original'],
              backdrop_sizes: ['w780', 'original'],
              profile_sizes: ['w185', 'original'],
            },
          }
        : url.pathname.endsWith('/tv/42')
          ? {
              id: 42,
              name: 'Série',
              original_name: 'Series',
              first_air_date: '2019-10-10',
              overview: 'Résumé en français',
              episode_run_time: [45],
              origin_country: ['FR'],
              genres: [{ name: 'Drame' }],
              created_by: [{ id: 7, name: 'Créatrice' }],
              credits: {
                cast: [{ id: 1, name: 'Distribution de secours', character: 'Rôle secondaire' }],
              },
              aggregate_credits: {
                cast: [
                  {
                    id: 2,
                    name: 'Alice Actrice',
                    roles: [{ character: 'Alice' }],
                    order: 0,
                    profile_path: '/alice.jpg',
                  },
                ],
              },
            }
          : {
              name: 'Épisode pilote',
              overview: 'Résumé épisode',
              air_date: '2019-10-10',
              credits: {
                guest_stars: [
                  {
                    id: 3,
                    name: 'Invité',
                    character: 'Le témoin',
                    order: 0,
                    profile_path: '/guest.jpg',
                  },
                ],
              },
            }
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('server-only-token')
    const signal = new AbortController().signal

    const metadata = await provider.getDetails('tv', 42, signal)
    expect(metadata).toMatchObject({
      mediaType: 'tv',
      providerId: 42,
      year: 2019,
      runtimeMinutes: 45,
      genres: ['Drame'],
      creators: [{ providerId: 7, name: 'Créatrice' }],
      cast: [
        {
          name: 'Alice Actrice',
          character: 'Alice',
          profileUrl: 'https://image.tmdb.org/t/p/w185/alice.jpg',
        },
      ],
      posterUrl: null,
    })
    expect(metadata.tmdbUrl).toBe('https://www.themoviedb.org/tv/42')

    const episode = await provider.getEpisode(42, 0, 1, signal)
    expect(episode).toMatchObject({
      name: 'Épisode pilote',
      airDate: '2019-10-10',
      guestCast: [
        {
          name: 'Invité',
          character: 'Le témoin',
          profileUrl: 'https://image.tmdb.org/t/p/w185/guest.jpg',
        },
      ],
    })
    expect(
      calls.find(({ url }) => url.pathname.endsWith('/tv/42'))?.url.searchParams.get('language'),
    ).toBe('fr-FR')
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: 'Bearer server-only-token',
      Accept: 'application/json',
    })
  })

  it('fetches the English episode title when the localized title differs from XMLTV', async () => {
    const episodeLanguages: string[] = []
    const fetchMock: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      if (url.pathname.endsWith('/configuration'))
        return new Response(
          JSON.stringify({
            images: {
              secure_base_url: 'https://image.tmdb.org/t/p/',
              poster_sizes: ['w500'],
              backdrop_sizes: ['w780'],
              profile_sizes: ['w185'],
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      episodeLanguages.push(url.searchParams.get('language') ?? '')
      return new Response(
        JSON.stringify(
          url.searchParams.get('language') === 'en-US'
            ? {
                name: "Where There's Smoke",
                overview: 'The 118 investigates a recent intervention.',
              }
            : { name: 'Épisode en français', overview: 'Résumé en français.' },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TmdbProvider('server-only-token')

    const episode = await provider.getEpisode(
      75219,
      9,
      16,
      new AbortController().signal,
      'Pas de fumée sans feu',
    )

    expect(episodeLanguages).toEqual(['fr-FR', 'en-US'])
    expect(episode).toMatchObject({
      name: 'Épisode en français',
      originalName: "Where There's Smoke",
      overview: 'Résumé en français.',
    })
  })
})
