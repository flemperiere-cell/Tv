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

test('la grille charge progressivement les programmes des jours suivants et précédents', async ({
  page,
}) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const programmes = Array.from({ length: 100 }, (_, index) => {
    const programmeStart = new Date(start.getTime() + index * 30 * 60_000)
    const programmeEnd = new Date(programmeStart.getTime() + 30 * 60_000)
    return `<programme start="${xmltvDate(programmeStart)}" stop="${xmltvDate(programmeEnd)}" channel="TF1.fr"><title>Programme ${String(index).padStart(3, '0')}</title></programme>`
  }).join('')
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel>${programmes}</tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await page.getByRole('button', { name: 'Grille' }).click()

  const lane = page.getByRole('region', { name: 'Programmes de TF1' })
  await expect(lane).toBeVisible()
  const renderedInitially = await lane.locator('.grid-programme').count()
  expect(renderedInitially).toBeLessThanOrEqual(32)
  await expect(lane.getByRole('button', { name: /Programme 099/ })).toHaveCount(0)

  await lane.hover()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.mouse.wheel(0, 100_000)
    if (await lane.getByRole('button', { name: /Programme 099/ }).count()) break
  }
  await expect(lane.getByRole('button', { name: /Programme 099/ })).toBeVisible()
  await expect(lane.getByRole('button', { name: /Programme 000/ })).toHaveCount(0)
  expect(await lane.locator('.grid-programme').count()).toBeLessThanOrEqual(48)
  const tomorrow = new Date(start)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowLabel = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'full',
  }).format(tomorrow)
  await expect(lane.locator('.grid-lane-day').filter({ hasText: tomorrowLabel })).toBeVisible()

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.mouse.wheel(0, -100_000)
    if (await lane.getByRole('button', { name: /Programme 000/ }).count()) break
  }
  await expect(lane.getByRole('button', { name: /Programme 000/ })).toBeVisible()
})

test('Maintenant repère et centre une émission commencée la veille', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T00:05:00+01:00') })
  const start = new Date('2026-11-05T22:30:00+01:00')
  const end = new Date('2026-11-06T00:30:00+01:00')
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Émission à cheval</title></programme></tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()

  const programme = page.locator('.programme-main').filter({ hasText: 'Émission à cheval' })
  await expect(programme).toBeVisible()
  await expect(programme.locator('.programme-time-yesterday')).toHaveText('(hier)')

  await page.getByRole('button', { name: 'Grille' }).click()
  const gridProgramme = page.getByRole('button', { name: /22h30 \(hier\) Émission à cheval/ })
  await expect(gridProgramme).toBeVisible()
  await expect(gridProgramme).toHaveAttribute('data-scroll-target', 'true')
})
