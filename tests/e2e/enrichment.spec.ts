import { expect, test } from '@playwright/test'
import { gzipSync } from 'node:zlib'

function xmltvDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = pad(Math.floor(Math.abs(offset) / 60))
  const minutes = pad(Math.abs(offset) % 60)
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())} ${sign}${hours}${minutes}`
}

test('enrichit seulement à l’ouverture d’un film, sans remplacer XMLTV', async ({ page }) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const nextStart = new Date(start)
  nextStart.setHours(1)
  const nextEnd = new Date(nextStart)
  nextEnd.setHours(2)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name><icon src="https://example.com/tf1.png"/></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Inception</title><icon src="https://example.com/inception.jpg"/><category>Film</category><date>2010</date><desc>Résumé XMLTV d’origine</desc><credits><actor role="Alice">Jeanne Dupont</actor></credits></programme><programme start="${xmltvDate(nextStart)}" stop="${xmltvDate(nextEnd)}" channel="TF1.fr"><title>Le journal</title><category>Actualités</category></programme></tv>`
  let enrichRequests = 0
  let enrichmentBody: unknown

  await page.route('https://example.com/tf1.png', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }),
  )
  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.route('**/tv/api/v1/enrich', async (route) => {
    enrichRequests += 1
    enrichmentBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'matched',
        match: {
          provider: 'tmdb',
          mediaType: 'movie',
          providerId: 27205,
          confidence: 98,
          manual: false,
          method: 'title',
        },
        metadata: {
          mediaType: 'movie',
          providerId: 27205,
          title: 'Inception',
          originalTitle: 'Inception',
          releaseDate: '2010-07-15',
          firstAirDate: null,
          year: 2010,
          voteAverage: 7.8,
          voteCount: 2543,
          overview: 'Résumé TMDB',
          genres: ['Science-fiction'],
          countries: ['US'],
          runtimeMinutes: 148,
          posterUrl: null,
          backdropUrl: null,
          directors: [{ providerId: 525, name: 'Christopher Nolan' }],
          creators: [],
          cast: [],
          season: null,
          episode: null,
          episodeTitle: null,
          episodeOriginalTitle: null,
          episodeOverview: null,
          episodeAirDate: null,
          guestCast: [],
          tmdbUrl: 'https://www.themoviedb.org/movie/27205',
        },
        alternatives: [],
        cache: { source: 'fresh', expiresAt: '2026-11-26T12:00:00Z' },
        attribution: { provider: 'TMDB', required: true },
      }),
    })
  })

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await expect(page.getByRole('button', { name: 'Détails de Inception' })).toBeVisible()
  expect(enrichRequests).toBe(0)
  await page.getByRole('button', { name: 'Détails de Inception' }).click()
  await expect(page.locator('.detail-broadcast')).toContainText('TF1')
  await expect(page.locator('.detail-broadcast-logo img')).toHaveAttribute(
    'src',
    'https://example.com/tf1.png',
  )
  await expect(page.locator('.detail-broadcast')).toContainText('00:00 — 00:00')
  await expect(page.locator('.detail-broadcast')).toContainText(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full' }).format(start),
  )
  await expect(page.locator('.eyebrow, .broadcast-date')).toHaveCount(0)
  await expect(page.getByText('Résumé XMLTV d’origine')).toBeVisible()
  await expect(page.locator('.tmdb-score')).toContainText('7,8')
  await expect(page.locator('.tmdb-score')).toContainText('Note TMDB')
  await expect(page.locator('.tmdb-score')).toContainText('2 543 votes')
  await expect(page.getByText('Résumé TMDB')).toHaveCount(0)
  await expect(page.getByText('Jeanne Dupont (Alice)')).toBeVisible()
  await expect(page.getByText('Année XMLTV')).toBeVisible()
  await expect(page.getByText('Année de sortie : 2010')).toBeVisible()
  expect(enrichRequests).toBe(1)
  expect(enrichmentBody).toMatchObject({
    locale: 'fr-FR',
    programme: {
      title: 'Inception',
      category: 'Film',
      year: '2010',
      durationMinutes: null,
      description: 'Résumé XMLTV d’origine',
    },
  })
  await expect(page.getByText('15 juillet 2010')).toBeVisible()
  expect(enrichmentBody).not.toHaveProperty('programme.channelId')
  await page.getByRole('button', { name: 'Afficher les programmes de la chaîne' }).click()
  const schedule = page.getByRole('region', { name: 'Programmes de TF1' })
  await expect(schedule).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Masquer les programmes de la chaîne' }),
  ).toBeVisible()
  await expect(schedule.getByRole('button', { name: /Inception/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
  await expect(schedule.locator('.channel-schedule-image')).toHaveAttribute(
    'src',
    'https://example.com/inception.jpg',
  )
  await expect(schedule.locator('.schedule-progress > span')).toBeVisible()
  const nextProgramme = schedule.getByRole('button', { name: /Le journal/ })
  const nextProgrammeBox = await nextProgramme.boundingBox()
  if (!nextProgrammeBox) throw new Error('Programme de la sidebar introuvable')
  await nextProgramme.click({
    position: { x: nextProgrammeBox.width - 2, y: nextProgrammeBox.height / 2 },
  })
  await expect(page.getByRole('heading', { name: 'Le journal' })).toBeVisible()
  await expect(schedule).toHaveCount(0)
  await page.evaluate(() => {
    const main = document.querySelector('.detail-screen')
    if (!main) throw new Error('Fiche programme introuvable')
    const touch = (clientX: number) =>
      new Touch({ identifier: 1, target: main, clientX, clientY: window.innerHeight - 10 })
    const start = touch(window.innerWidth - 10)
    const end = touch(window.innerWidth - 100)
    main.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }),
    )
    main.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }),
    )
  })
  await expect(schedule).toBeVisible()
  await page.locator('.detail-broadcast-channel').click()
  await expect(schedule).toHaveCount(0)
})

test('signale un programme terminé dans l’entête du détail', async ({ page }) => {
  const start = new Date()
  start.setDate(start.getDate() - 1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setHours(23)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Le programme terminé</title><category>Actualités</category></programme></tv>`

  await page.clock.install({ now: new Date() })
  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByLabel('Choisir le jour').selectOption({ index: 0 })
  await page.getByRole('button', { name: 'Détails de Le programme terminé' }).click()
  await expect(page.locator('.detail-broadcast-status')).toHaveText('Terminé')
})

test('permet de comparer plusieurs séries ambiguës et de consulter leurs fiches TMDB', async ({
  page,
}) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>La petite maison</title><category>Série</category><desc>Résumé XMLTV original.</desc></programme></tv>`
  const detailsCalls: string[] = []

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.route('**/tv/api/v1/enrich', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ambiguous',
        match: null,
        metadata: null,
        alternatives: [
          {
            providerId: 321,
            mediaType: 'tv',
            title: 'La petite maison dans la prairie',
            year: 1974,
            posterUrl: null,
            confidence: 86,
            overview: 'Une famille s’installe dans le Minnesota.',
            genres: ['Drame'],
            date: '1974-09-11',
          },
          {
            providerId: 654,
            mediaType: 'tv',
            title: 'La petite maison : nouvelle génération',
            year: 2020,
            posterUrl: null,
            confidence: 84,
            overview: 'Une adaptation contemporaine.',
            genres: ['Drame'],
            date: '2020-01-01',
          },
        ],
        evidence: {
          seriesTitleExact: true,
          seriesYearMatch: null,
          episodeTitleSimilarity: null,
          episodeSynopsisSimilarity: null,
          episodeNumberMatch: null,
          episodeNumberOffset: null,
          contradictoryEvidence: [],
        },
        cache: { source: 'fresh', expiresAt: null },
        attribution: { provider: 'TMDB', required: true },
      }),
    }),
  )
  await page.route('**/tv/api/v1/details/tv/*', async (route) => {
    const url = new URL(route.request().url())
    const providerId = Number(url.pathname.split('/').at(-1))
    detailsCalls.push(url.pathname)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        metadata: {
          mediaType: 'tv',
          providerId,
          title:
            providerId === 321
              ? 'La petite maison dans la prairie'
              : 'La petite maison : nouvelle génération',
          originalTitle:
            providerId === 321 ? 'Little House on the Prairie' : 'Little House: Next Generation',
          releaseDate: null,
          firstAirDate: providerId === 321 ? '1974-09-11' : '2020-01-01',
          year: providerId === 321 ? 1974 : 2020,
          overview: providerId === 321 ? 'Fiche TMDB originale.' : 'Fiche TMDB du remake.',
          genres: ['Drame'],
          countries: ['US'],
          runtimeMinutes: 45,
          posterUrl: null,
          backdropUrl: null,
          directors: [],
          creators: [],
          cast: [],
          season: null,
          episode: null,
          episodeTitle: null,
          episodeOriginalTitle: null,
          episodeOverview: null,
          episodeAirDate: null,
          guestCast: [],
          tmdbUrl: `https://www.themoviedb.org/tv/${providerId}`,
        },
      }),
    })
  })

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Détails de La petite maison' }).click()
  await expect(page.getByText('Plusieurs fiches sont plausibles.')).toBeVisible()
  await expect(page.getByText('1974 · Série')).toBeVisible()
  await expect(page.getByText('2020 · Série')).toBeVisible()

  await page.locator('.match-alternative').first().click()
  await expect(page.getByText('Fiche TMDB originale.')).toBeVisible()
  await expect(page.getByText('Résumé XMLTV original.')).toBeVisible()
  await page.getByRole('button', { name: 'Retour à la fiche du programme' }).click()
  await expect(page.getByText('Fiche TMDB originale.')).toHaveCount(0)
  await expect(page.getByText('Plusieurs fiches sont plausibles.')).toBeVisible()
  await expect(page.locator('.detail-screen')).toBeVisible()
  await page.locator('.match-alternative').first().click()
  await expect(page.getByText('Fiche TMDB originale.')).toBeVisible()
  await page.getByRole('button', { name: 'Retour aux propositions' }).click()
  await page.locator('.match-alternative').nth(1).click()
  await expect(page.getByText('Fiche TMDB du remake.')).toBeVisible()
  expect(detailsCalls).toEqual([
    '/tv/api/v1/details/tv/321',
    '/tv/api/v1/details/tv/321',
    '/tv/api/v1/details/tv/654',
  ])
})

test('propose les alternatives d’un résultat not_found et permet de consulter leur fiche', async ({
  page,
}) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Gaston Lagaffe</title><category>Comédie</category><desc>Un stagiaire invente des objets farfelus.</desc></programme></tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.route('**/tv/api/v1/enrich', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'not_found',
        match: null,
        metadata: null,
        alternatives: [
          {
            providerId: 777,
            mediaType: 'movie',
            title: 'Gaston Lagaffe',
            year: 2018,
            posterUrl: null,
            confidence: 68,
            overview: 'Gaston découvre son nouveau bureau.',
            genres: ['Comédie'],
            date: '2018-03-04',
          },
        ],
        cache: { source: 'fresh', expiresAt: null },
        attribution: { provider: 'TMDB', required: true },
      }),
    }),
  )
  await page.route('**/tv/api/v1/details/movie/777', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        metadata: {
          mediaType: 'movie',
          providerId: 777,
          title: 'Gaston Lagaffe',
          originalTitle: 'Gaston Lagaffe',
          releaseDate: '2018-03-04',
          firstAirDate: null,
          year: 2018,
          overview: 'Fiche TMDB de Gaston.',
          genres: ['Comédie'],
          countries: ['France'],
          runtimeMinutes: 84,
          posterUrl: null,
          backdropUrl: null,
          directors: [],
          creators: [],
          cast: [],
          season: null,
          episode: null,
          episodeTitle: null,
          episodeOriginalTitle: null,
          episodeOverview: null,
          episodeAirDate: null,
          guestCast: [],
          tmdbUrl: 'https://www.themoviedb.org/movie/777',
        },
      }),
    }),
  )

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Détails de Gaston Lagaffe' }).click()
  await expect(page.getByText('Aucune fiche n’a été identifiée automatiquement')).toBeVisible()
  await expect(page.locator('.match-alternative')).toContainText('Gaston Lagaffe')
  await page.locator('.match-alternative').click()
  await expect(page.getByText('Fiche TMDB de Gaston.')).toBeVisible()
  await expect(page.getByText('Un stagiaire invente des objets farfelus.')).toBeVisible()
})
