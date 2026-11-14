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

test('agrandit l’image de la fiche en double-clic puis la restaure', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-14T20:30:00+01:00') })
  const start = new Date('2026-11-14T00:00:00+01:00')
  const end = new Date('2026-11-15T00:00:00+01:00')
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Image de test</title><icon src="https://example.com/image.jpg"/></programme></tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.route('https://example.com/image.jpg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350"/>',
    }),
  )
  await page.route('**/tv/api/v1/enrich', (route) => route.abort())

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Maintenant' }).click()
  await page.getByRole('button', { name: 'Détails de Image de test' }).click()

  const hero = page.locator('.hero')
  await expect(hero).toBeVisible()
  await expect
    .poll(() => hero.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(900)
  const initialImageBox = await hero.boundingBox()
  const initialTitleBox = await page.locator('#detail-title').boundingBox()
  if (!initialImageBox || !initialTitleBox) throw new Error('Disposition de la fiche introuvable')

  const tapHero = () =>
    hero.evaluate((image) => {
      const bounds = image.getBoundingClientRect()
      const touch = new Touch({
        identifier: 1,
        target: image,
        clientX: bounds.x + bounds.width / 2,
        clientY: bounds.y + bounds.height / 2,
      })
      image.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }),
      )
      image.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }),
      )
    })

  await tapHero()
  await tapHero()
  await expect(hero.locator('..')).toHaveClass(/image-expanded/)
  const expandedImageBox = await hero.boundingBox()
  const expandedTitleBox = await page.locator('#detail-title').boundingBox()
  if (!expandedImageBox || !expandedTitleBox) throw new Error('Image agrandie introuvable')
  expect(expandedImageBox.width).toBeCloseTo(initialImageBox.width, 0)
  expect(expandedImageBox.height).toBeGreaterThan(initialImageBox.height)
  expect(expandedTitleBox.y).toBeGreaterThan(initialTitleBox.y)

  await tapHero()
  await tapHero()
  await expect(hero.locator('..')).not.toHaveClass(/image-expanded/)
  await expect(hero).toHaveJSProperty('naturalWidth', 900)

  await hero.dblclick()
  await expect(hero.locator('..')).toHaveClass(/image-expanded/)
  await hero.dblclick()
  await expect(hero.locator('..')).not.toHaveClass(/image-expanded/)

  await page.setViewportSize({ width: 1280, height: 720 })
  await hero.dblclick()
  await expect(hero.locator('..')).toHaveClass(/image-expanded/)
  const landscapeImageBox = await hero.boundingBox()
  if (!landscapeImageBox) throw new Error('Image de paysage introuvable')
  expect(landscapeImageBox.height).toBeLessThanOrEqual(720)
  expect(landscapeImageBox.width).toBeLessThan(1280)
})

test('enrichit seulement à l’ouverture d’un film, sans remplacer XMLTV', async ({ page }) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const nextStart = new Date(end)
  nextStart.setHours(1)
  const nextEnd = new Date(nextStart)
  nextEnd.setHours(2)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name><icon src="https://example.com/tf1.png"/></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Inception</title><icon src="https://example.com/inception.jpg"/><category>Film</category><date>2010</date><desc>Résumé XMLTV d’origine</desc><credits><director>Réalisateur XMLTV</director><actor role="Alice">Jeanne Dupont</actor></credits></programme><programme start="${xmltvDate(nextStart)}" stop="${xmltvDate(nextEnd)}" channel="TF1.fr"><title>Le journal</title><category>Actualités</category></programme></tv>`
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
          posterUrl: 'https://example.com/inception-poster.jpg',
          backdropUrl: 'https://example.com/inception-backdrop.jpg',
          directors: [{ providerId: 525, name: 'Christopher Nolan' }],
          creators: [],
          cast: [
            {
              providerId: 6193,
              name: 'Leonardo DiCaprio',
              character: 'Cobb',
              order: 0,
              profileUrl: null,
            },
          ],
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
  expect(
    Number.parseFloat(
      await page
        .locator('.detail-title-row h2')
        .evaluate((element) => getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThan(30)
  expect(
    Number.parseFloat(
      await page
        .locator('.description')
        .first()
        .evaluate((element) => getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(18)
  await expect(page.locator('.detail-broadcast')).toContainText('TF1')
  await expect(page.locator('.detail-broadcast-logo img')).toHaveAttribute(
    'src',
    'https://example.com/tf1.png',
  )
  await expect(page.locator('.detail-broadcast')).toContainText('00:00 — 00:00')
  await expect(page.locator('.detail-broadcast')).toContainText(
    new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full' }).format(start),
  )
  expect(
    await page
      .locator('.detail-broadcast-channel')
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe('16.875px')
  expect(
    await page
      .locator('.detail-broadcast-time')
      .evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe('13.5px')
  await expect(page.locator('.eyebrow, .broadcast-date')).toHaveCount(0)
  await expect(page.getByText('Résumé XMLTV d’origine')).toBeVisible()
  await expect(page.locator('.tmdb-score')).toContainText('7,8')
  await expect(page.locator('.tmdb-score')).toContainText('Note TMDB')
  await expect(page.locator('.tmdb-score')).toContainText('2 543 votes')
  const titleBox = await page.getByRole('heading', { name: 'Inception', exact: true }).boundingBox()
  const infoBox = await page.locator('.detail-info-row').boundingBox()
  const scoreBox = await page.locator('.tmdb-score').boundingBox()
  if (!titleBox || !infoBox || !scoreBox) throw new Error('Disposition de la note introuvable')
  expect(titleBox.width).toBeGreaterThan(infoBox.width - scoreBox.width)
  expect(scoreBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height)
  expect(scoreBox.x + scoreBox.width).toBeCloseTo(infoBox.x + infoBox.width, 0)
  const hero = page.locator('.hero')
  const imageDots = page.locator('.hero-pagination-dot')
  await expect(imageDots).toHaveCount(3)
  await expect(hero).toHaveAttribute('src', 'https://example.com/inception.jpg')
  await imageDots.nth(1).click()
  await expect(hero).toHaveAttribute('src', 'https://example.com/inception-backdrop.jpg')
  await expect(imageDots.nth(1)).toHaveAttribute('aria-pressed', 'true')
  const heroBox = await hero.boundingBox()
  if (!heroBox) throw new Error('Image de la fiche introuvable')
  await page.mouse.move(heroBox.x + heroBox.width * 0.75, heroBox.y + heroBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(heroBox.x + heroBox.width * 0.25, heroBox.y + heroBox.height / 2, {
    steps: 5,
  })
  await page.mouse.up()
  await expect(hero).toHaveAttribute('src', 'https://example.com/inception-poster.jpg')
  await expect(imageDots.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(2500)
  await expect(hero).toHaveAttribute('src', 'https://example.com/inception-poster.jpg')
  await expect(imageDots.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(imageDots.nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
  await expect(hero).toHaveAttribute('src', 'https://example.com/inception.jpg')
  await expect(page.getByText('Résumé TMDB')).toHaveCount(0)
  await expect(page.getByText('Jeanne Dupont (Alice)')).toBeVisible()
  await expect(page.getByText('Année XMLTV')).toBeVisible()
  await expect(page.locator('.media-release-year')).toHaveText('2010 · TMDB · Google')
  await expect(page.locator('.media-release-year a').first()).toHaveAttribute(
    'href',
    'https://www.themoviedb.org/movie/27205',
  )
  const googleLink = page.getByRole('link', {
    name: 'Rechercher Inception Film 2010 sur Google',
  })
  await expect(googleLink).toHaveAttribute(
    'href',
    `https://www.google.com/search?q=${encodeURIComponent('Inception Film 2010')}`,
  )
  await expect(page.getByRole('link', { name: 'Christopher Nolan' })).toHaveAttribute(
    'href',
    `https://www.google.com/search?q=${encodeURIComponent('Christopher Nolan')}`,
  )
  await expect(page.getByRole('link', { name: 'Réalisateur XMLTV' })).toHaveAttribute(
    'href',
    `https://www.google.com/search?q=${encodeURIComponent('Réalisateur XMLTV')}`,
  )
  await expect(page.getByRole('link', { name: 'Jeanne Dupont' })).toHaveAttribute(
    'href',
    `https://www.google.com/search?q=${encodeURIComponent('Jeanne Dupont')}`,
  )
  await expect(page.getByRole('link', { name: 'Leonardo DiCaprio' })).toHaveAttribute(
    'href',
    `https://www.google.com/search?q=${encodeURIComponent('Leonardo DiCaprio')}`,
  )
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
  await expect(schedule.locator('.schedule-day-label')).toHaveCount(2)
  await expect(schedule.locator('.schedule-day-label').nth(1)).toHaveText(
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      dateStyle: 'full',
    }).format(nextStart),
  )
  const scheduleWidth = await schedule.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    layoutWidth: element.closest('.detail-layout')?.getBoundingClientRect().width ?? 0,
  }))
  expect(scheduleWidth.width).toBeCloseTo(Math.min(scheduleWidth.layoutWidth * 0.3, 300), 0)
  expect(
    Number.parseFloat(
      await schedule
        .locator('.channel-schedule-programme strong')
        .first()
        .evaluate((element) => getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThan(16)
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
  await page.getByRole('button', { name: 'Masquer les programmes de la chaîne' }).click()
  await expect(schedule).toHaveCount(0)
  const edgeArea = page.locator('.schedule-edge-hit-area')
  const edgeAreaBox = await edgeArea.boundingBox()
  const viewport = page.viewportSize()
  if (!edgeAreaBox || !viewport) throw new Error('Zone de dépliage introuvable')
  expect(edgeAreaBox.x + edgeAreaBox.width).toBe(viewport.width)
  expect(edgeAreaBox.y).toBe(0)
  expect(edgeAreaBox.height).toBe(viewport.height)
  await page.mouse.click(viewport.width - 10, 10)
  await expect(
    page.getByRole('button', { name: 'Masquer les programmes de la chaîne' }),
  ).toBeVisible()
  await expect(schedule).toBeVisible()
  await page.getByRole('button', { name: 'Masquer les programmes de la chaîne' }).click()
  await expect(schedule).toHaveCount(0)
  await page.mouse.click(viewport.width - 10, viewport.height - 10)
  await expect(
    page.getByRole('button', { name: 'Masquer les programmes de la chaîne' }),
  ).toBeVisible()
  await expect(schedule).toBeVisible()
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

test('permet de consulter les propositions après un matching automatique', async ({ page }) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Inception</title><category>Film</category><date>2010</date></programme></tv>`

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
          overview: 'Résumé TMDB',
          genres: [],
          countries: [],
          runtimeMinutes: 148,
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
          tmdbUrl: 'https://www.themoviedb.org/movie/27205',
        },
        alternatives: [
          {
            providerId: 27205,
            mediaType: 'movie',
            title: 'Inception',
            year: 2010,
            posterUrl: null,
            confidence: 98,
            scoring: {
              method: 'standard',
              points: 156,
              maximumPoints: 160,
              criteria: [],
              selectionChecks: [
                {
                  label: 'Score de correspondance',
                  passed: true,
                  detail: '98 % obtenu, 90 % requis.',
                },
              ],
            },
          },
          {
            providerId: 123,
            mediaType: 'movie',
            title: 'Autre proposition',
            year: 2010,
            posterUrl: null,
            confidence: 72,
          },
        ],
        cache: { source: 'fresh', expiresAt: null },
        attribution: { provider: 'TMDB', required: true },
      }),
    }),
  )

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Détails de Inception' }).click()
  await page.getByRole('button', { name: 'Voir les propositions TMDB (2)' }).click()
  await expect(page.locator('.match-alternative')).toHaveCount(2)
  await expect(page.locator('.match-alternative-selected')).toHaveText('Retenue automatiquement')
  await page.getByRole('button', { name: /Comprendre le taux de matching de Inception/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Pourquoi cette fiche a été sélectionnée automatiquement' }),
  ).toBeVisible()
  await expect(page.getByText('Condition remplie — Score de correspondance.')).toBeVisible()
  await page.getByRole('button', { name: 'Fermer le détail du matching' }).click()
  await page.getByRole('button', { name: 'Masquer les propositions' }).click()
  await expect(page.locator('.match-alternative')).toHaveCount(0)
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
            scoring: {
              method: 'standard',
              points: 86,
              maximumPoints: 160,
              criteria: [
                {
                  id: 'title',
                  label: 'Titre',
                  xmltvValue: 'La petite maison',
                  tmdbValue: 'La petite maison dans la prairie',
                  points: 42,
                  maximumPoints: 65,
                  status: 'partial',
                },
                {
                  id: 'media_type',
                  label: 'Type de programme',
                  xmltvValue: 'Série',
                  tmdbValue: 'Série TV',
                  points: 0,
                  maximumPoints: null,
                  status: 'match',
                },
                {
                  id: 'year',
                  label: 'Année',
                  xmltvValue: null,
                  tmdbValue: '1974',
                  points: 0,
                  maximumPoints: 20,
                  status: 'unavailable',
                },
                {
                  id: 'genre',
                  label: 'Genre',
                  xmltvValue: 'Série',
                  tmdbValue: 'Drame',
                  points: 0,
                  maximumPoints: null,
                  status: 'not_applicable',
                },
                {
                  id: 'unique_search',
                  label: 'Recherche TMDB unique (titre original exact)',
                  xmltvValue: 'La petite maison',
                  tmdbValue: '2 résultats · titre original : La petite maison dans la prairie',
                  points: 0,
                  maximumPoints: 15,
                  status: 'mismatch',
                },
              ],
              selectionChecks: [
                {
                  label: 'Titre exact',
                  passed: false,
                  detail: 'Le titre TMDB ne correspond pas exactement.',
                },
                {
                  label: 'Score minimal',
                  passed: true,
                  detail: '86 % obtenu, 70 % minimum.',
                },
                {
                  label: 'Confirmation indépendante',
                  passed: true,
                  detail: 'Indices concordants : type de programme.',
                },
              ],
            },
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

  const scoreBadge = await page.locator('.match-score-trigger').first().boundingBox()
  const proposalCard = await page.locator('.match-alternative-wrap').first().boundingBox()
  if (!scoreBadge || !proposalCard) throw new Error('Badge de matching introuvable')
  expect(proposalCard.x + proposalCard.width - scoreBadge.x - scoreBadge.width).toBeCloseTo(9, 0)
  expect(scoreBadge.y - proposalCard.y).toBeCloseTo(9, 0)

  await page
    .getByRole('button', {
      name: /Comprendre le taux de matching de La petite maison dans la prairie/,
    })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.channel-schedule')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toContainText('La petite maison')
  await expect(page.getByRole('dialog')).toContainText('La petite maison dans la prairie')
  await expect(page.getByRole('dialog')).toContainText('42 / 65 pts')
  await expect(page.getByRole('dialog')).toContainText('Non applicable')
  await expect(page.getByRole('dialog')).toContainText('2 résultats')
  await expect(page.getByRole('dialog')).toContainText('Type de programme')
  await expect(page.getByRole('dialog')).toContainText('Série TV')
  await expect(page.getByRole('dialog')).toContainText(
    'Recherche TMDB unique (titre original exact)',
  )
  await expect(page.getByRole('dialog')).toContainText(
    'un score minimal atteint ne suffit pas à lui seul',
  )
  await expect(page.getByRole('dialog')).toContainText('Condition remplie — Score minimal.')
  await expect(page.getByRole('dialog')).toContainText('Condition bloquante — Titre exact.')
  await expect(page.getByRole('dialog')).toContainText(
    'Condition remplie — Confirmation indépendante.',
  )
  const closeScoreDialog = page.getByRole('button', { name: 'Fermer le détail du matching' })
  await expect(closeScoreDialog).toHaveCSS('display', 'grid')
  await expect(closeScoreDialog).toHaveCSS('place-items', 'center')
  await expect(closeScoreDialog).toHaveCSS('padding', '0px')
  const closeButtonBox = await closeScoreDialog.boundingBox()
  const closeIconBox = await closeScoreDialog.locator('svg').boundingBox()
  if (!closeButtonBox || !closeIconBox) throw new Error('Icône de fermeture introuvable')
  expect(
    Math.abs(
      closeButtonBox.y + closeButtonBox.height / 2 - closeIconBox.y - closeIconBox.height / 2,
    ),
  ).toBeLessThan(0.5)
  await closeScoreDialog.click()

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

test('relance la recherche à l’ouverture du détail si les critères de matching manquent', async ({
  page,
}) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Le film proposé</title><category>Film</category></programme></tv>`
  let enrichRequests = 0

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.route('**/tv/api/v1/enrich', async (route) => {
    enrichRequests += 1
    const alternative = {
      providerId: 988,
      mediaType: 'movie',
      title: 'Le film proposé',
      year: 2020,
      posterUrl: null,
      confidence: 80,
      ...(enrichRequests > 1
        ? {
            scoring: {
              method: 'standard',
              points: 80,
              maximumPoints: 160,
              criteria: [
                {
                  id: 'title',
                  label: 'Titre',
                  xmltvValue: 'Le film proposé',
                  tmdbValue: 'Le film proposé',
                  points: 65,
                  maximumPoints: 65,
                  status: 'match',
                },
                {
                  id: 'duration',
                  label: 'Durée',
                  xmltvValue: '90 min',
                  tmdbValue: '90 min',
                  points: 15,
                  maximumPoints: 15,
                  status: 'match',
                },
              ],
              selectionChecks: [
                {
                  label: 'Score requis',
                  passed: true,
                  detail: '80 % obtenu, 80 % requis.',
                },
              ],
            },
          }
        : {}),
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ambiguous',
        match: null,
        metadata: null,
        alternatives: [alternative],
        cache: { source: 'fresh', expiresAt: null },
        attribution: { provider: 'TMDB', required: true },
      }),
    })
  })

  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Détails de Le film proposé' }).click()
  await expect(page.getByText('Plusieurs fiches sont plausibles.')).toBeVisible()
  await page
    .getByRole('button', { name: /Comprendre le taux de matching de Le film proposé/ })
    .click()
  await expect.poll(() => enrichRequests).toBe(2)
  await expect(page.getByRole('dialog')).toContainText('65 / 65 pts')
  await expect(page.getByRole('dialog')).toContainText('80 % requis')
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
