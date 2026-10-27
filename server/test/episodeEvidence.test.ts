import { describe, expect, it } from 'vitest'
import { scoreEpisodeEvidence } from '../src/domain/episodeEvidence'

const programme = {
  title: '9-1-1',
  subtitle: 'Pas de fumée sans feu',
  description:
    "La 118 doit justifier chaque décision prise lors d'une récente intervention, alors qu'une enquête pour déterminer d'éventuelles erreurs est en cours.",
  category: 'Série dramatique',
  year: null,
  durationMinutes: 45,
  season: 9,
  episode: 16,
  directors: [],
  actors: [],
}

describe('episode matching evidence', () => {
  it('confirms a localized episode title and a paraphrased English synopsis', () => {
    expect(
      scoreEpisodeEvidence(programme, {
        name: 'Pas de fumée sans feu',
        originalName: "Where There's Smoke",
        overview:
          'The 118 must justify every decision made during a recent intervention as an investigation into possible errors is underway.',
        airDate: '2026-04-02',
        guestCast: [],
      }),
    ).toMatchObject({
      score: 25,
      confirmed: true,
      contradictory: false,
      evidence: {
        episodeTitleSimilarity: 1,
        episodeSynopsisSimilarity: expect.any(Number),
        episodeNumberMatch: true,
        episodeNumberOffset: 0,
        contradictoryEvidence: [],
      },
    })
  })

  it('does not use episode availability alone as identity evidence', () => {
    expect(
      scoreEpisodeEvidence(programme, {
        name: null,
        overview: null,
        airDate: null,
        guestCast: [],
      }),
    ).toMatchObject({
      score: 0,
      confirmed: false,
      contradictory: false,
      evidence: {
        episodeTitleSimilarity: null,
        episodeSynopsisSimilarity: null,
        episodeNumberMatch: false,
        episodeNumberOffset: null,
      },
    })
  })

  it('flags episode details that contradict both XMLTV title and synopsis', () => {
    expect(
      scoreEpisodeEvidence(programme, {
        name: 'Une nouvelle vie',
        overview: 'Une famille déménage dans une autre ville pour un nouveau travail.',
        airDate: '2026-04-02',
        guestCast: [],
      }),
    ).toMatchObject({
      score: 0,
      confirmed: false,
      contradictory: true,
      evidence: {
        contradictoryEvidence: ['episode_title', 'episode_synopsis'],
      },
    })
  })

  it('does not confirm an exact episode title when its available synopsis contradicts XMLTV', () => {
    const result = scoreEpisodeEvidence(programme, {
      name: programme.subtitle,
      overview: 'Des astronautes découvrent une planète lointaine.',
      airDate: '2026-04-02',
      guestCast: [],
    })
    expect(result.confirmed).toBe(false)
    expect(result.contradictory).toBe(true)
    expect(result.evidence.contradictoryEvidence).toContain('episode_synopsis')
  })

  it('keeps Koh-Lanta episode evidence separate from exact series-title evidence', () => {
    const result = scoreEpisodeEvidence(
      {
        ...programme,
        title: 'Koh-Lanta',
        subtitle: 'Le conseil',
        description: 'Les aventuriers votent pour éliminer un membre de leur équipe.',
        season: 12,
        episode: 3,
      },
      {
        name: 'Le conseil',
        originalName: 'The Tribal Council',
        overview: 'Les aventuriers votent pour éliminer un membre de leur équipe.',
        airDate: '2013-05-24',
        guestCast: [],
      },
      {
        titleExact: true,
        yearMatch: null,
        season: 12,
        episodeNumber: 3,
      },
    )
    expect(result.confirmed).toBe(true)
    expect(result.evidence).toMatchObject({
      seriesTitleExact: true,
      seriesYearMatch: null,
      episodeTitleSimilarity: 1,
      episodeSynopsisSimilarity: 1,
      episodeNumberMatch: true,
      episodeNumberOffset: 0,
    })
  })
})
