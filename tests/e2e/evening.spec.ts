import { expect, test, type Locator } from '@playwright/test'
import { gzipSync } from 'node:zlib'

function programmeXml(
  channelId: string,
  start: string,
  end: string,
  title: string,
  imageUrl?: string,
) {
  const icon = imageUrl ? `<icon src="${imageUrl}"/>` : ''
  return `<programme start="${start} +0100" stop="${end} +0100" channel="${channelId}"><title>${title}</title>${icon}</programme>`
}

async function swipe(row: Locator, direction: 'next' | 'previous') {
  await row.evaluate((element, swipeDirection) => {
    const startX = swipeDirection === 'next' ? 300 : 220
    const endX = swipeDirection === 'next' ? 220 : 300
    const makeTouch = (clientX: number) =>
      new Touch({ identifier: 1, target: element, clientX, clientY: 400 })
    const start = makeTouch(startX)
    const end = makeTouch(endX)
    element.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }),
    )
    element.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }),
    )
    element
      .querySelector('.programme-main')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  }, direction)
}

test('les balayages avancent indépendamment sur chaque chaîne', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-14T22:45:00+01:00') })
  const channels =
    '<channel id="TF1.fr"><display-name>TF1</display-name></channel><channel id="France2.fr"><display-name>France 2</display-name></channel><channel id="M6.fr"><display-name>M6</display-name></channel>'
  const programmes = [
    programmeXml('TF1.fr', '20261114050000', '20261114051500', 'TF1 première émission'),
    programmeXml('TF1.fr', '20261114204000', '20261114220000', 'TF1 prime'),
    programmeXml(
      'TF1.fr',
      '20261114220000',
      '20261114230000',
      'TF1 épisode 2',
      'https://images.test/portrait.svg',
    ),
    programmeXml('TF1.fr', '20261114230000', '20261114235000', 'TF1 épisode 3'),
    programmeXml('TF1.fr', '20261115000500', '20261115001500', 'TF1 émission de nuit'),
    programmeXml('TF1.fr', '20261115060000', '20261115063000', 'TF1 programme du matin'),
    programmeXml('France2.fr', '20261114211000', '20261114233000', 'France 2 prime'),
    programmeXml('France2.fr', '20261114233000', '20261114235000', 'France 2 courte'),
    programmeXml('M6.fr', '20261114210000', '20261114223000', 'M6 prime'),
    programmeXml(
      'M6.fr',
      '20261114223000',
      '20261114231500',
      'M6 suite',
      'https://images.test/landscape.svg',
    ),
    programmeXml('M6.fr', '20261114231500', '20261114235500', 'M6 fin'),
  ].join('')

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(`<tv>${channels}${programmes}</tv>`),
    }),
  )
  await page.route('https://images.test/**', (route) => {
    const portrait = route.request().url().includes('portrait')
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 100 : 180}" height="${portrait ? 180 : 100}"/>`,
    })
  })
  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Maintenant' }).click()

  const rows = page.locator('.programme-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.programme-main .time-range')).toHaveText('22h00 – 23h00')
  await expect(rows.nth(0).locator('.thumb img')).toBeVisible()
  await expect(rows.nth(2).locator('.thumb img')).toBeVisible()
  const rowHeights = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  )
  expect(new Set(rowHeights).size).toBe(1)
  await page.getByRole('button', { name: /Ce soir/ }).click()
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 prime')
  await expect(rows.nth(1).locator('.programme-main')).toContainText('France 2 prime')
  await expect(rows.nth(2).locator('.programme-main')).toContainText('M6 prime')
  await expect(page.getByRole('button', { name: 'Émissions suivantes' })).toHaveCount(0)

  await swipe(rows.nth(0), 'previous')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 première émission')
  await swipe(rows.nth(0), 'next')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 prime')

  await swipe(rows.nth(0), 'next')
  await expect
    .poll(() => rows.nth(0).evaluate((element) => element.getAnimations().length))
    .toBeGreaterThan(0)
  await expect(page.locator('.detail-screen')).toHaveCount(0)
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 épisode 2')
  await expect(rows.nth(1).locator('.programme-main')).toContainText('France 2 prime')
  await expect(rows.nth(2).locator('.programme-main')).toContainText('M6 prime')

  await swipe(rows.nth(0), 'next')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 épisode 3')
  await swipe(rows.nth(0), 'next')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 émission de nuit')
  await swipe(rows.nth(0), 'next')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 programme du matin')
  await swipe(rows.nth(0), 'next')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 programme du matin')
  await swipe(rows.nth(0), 'previous')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 émission de nuit')
  await swipe(rows.nth(0), 'previous')
  await swipe(rows.nth(0), 'previous')
  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 épisode 2')

  await swipe(rows.nth(1), 'next')
  await expect(rows.nth(1).locator('.programme-main')).toContainText('France 2 courte')
  await swipe(rows.nth(1), 'next')
  await expect(rows.nth(1).locator('.programme-main')).toContainText('France 2 courte')

  await swipe(rows.nth(2), 'next')
  await expect(rows.nth(2).locator('.programme-main')).toContainText('M6 suite')
  await swipe(rows.nth(2), 'next')
  await expect(rows.nth(2).locator('.programme-main')).toContainText('M6 fin')

  await expect(rows.nth(0).locator('.programme-main')).toContainText('TF1 épisode 2')

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
})

test('Maintenant permet de parcourir tout le guide et grise les émissions terminées', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-14T22:45:00+01:00') })
  const channels = '<channel id="TF1.fr"><display-name>TF1</display-name></channel>'
  const programmes = [
    programmeXml('TF1.fr', '20261113230000', '20261114010000', 'Hier soir'),
    programmeXml('TF1.fr', '20261114190000', '20261114200000', 'Passée'),
    programmeXml('TF1.fr', '20261114200000', '20261114200500', 'Courte'),
    programmeXml(
      'TF1.fr',
      '20261114200500',
      '20261114231000',
      'En cours : un titre très long qui doit tenir sur deux lignes puis finir avec des points de suspension',
    ),
    programmeXml('TF1.fr', '20261114231000', '20261114231500', 'Très courte'),
    programmeXml('TF1.fr', '20261114231500', '20261114232000', 'Courte tardive'),
    programmeXml('TF1.fr', '20261115000000', '20261115001000', 'Après minuit'),
  ].join('')

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(`<tv>${channels}${programmes}</tv>`),
    }),
  )
  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Maintenant' }).click()

  const row = page.locator('.programme-row')
  await expect(row.locator('.programme-main')).toContainText('En cours')
  const title = row.locator('.programme-main strong')
  const titleLayout = await title.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      lineClamp: style.webkitLineClamp,
      lineHeight: Number.parseFloat(style.lineHeight),
      height: element.clientHeight,
    }
  })
  expect(titleLayout.lineClamp).toBe('2')
  expect(titleLayout.height).toBeGreaterThanOrEqual(titleLayout.lineHeight * 2 - 1)
  await swipe(row, 'previous')
  await expect(row.locator('.programme-main')).toContainText('Courte')
  await expect(row).toHaveClass(/ended/)
  await expect(row.locator('.programme-main')).toHaveCSS('opacity', '0.58')
  await swipe(row, 'previous')
  await expect(row.locator('.programme-main')).toContainText('Passée')
  await swipe(row, 'previous')
  await expect(row.locator('.programme-main')).toContainText('Hier soir')

  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Passée')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Courte')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('En cours')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Très courte')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Courte tardive')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Après minuit')
  await swipe(row, 'next')
  await expect(row.locator('.programme-main')).toContainText('Après minuit')
})
