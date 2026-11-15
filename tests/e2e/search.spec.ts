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

test('la recherche est temporisée, limitée aux chaînes cochées et affiche les résultats par lots', async ({
  page,
}) => {
  await page.clock.install({ time: new Date() })
  await page.addInitScript(() => {
    localStorage.setItem(
      'mon-guide-tv-preferences',
      JSON.stringify({
        schemaVersion: 1,
        favoriteChannels: ['TF1.fr'],
        selectedChannels: ['TF1.fr'],
        favoriteOrder: ['TF1.fr'],
        defaultView: 'all',
        primeTime: '21:10',
        theme: 'dark',
        cacheEnabled: false,
      }),
    )
  })

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const programmes = Array.from({ length: 60 }, (_, index) => {
    const programmeStart = new Date(start.getTime() + index * 30 * 60_000)
    const programmeEnd = new Date(programmeStart.getTime() + 30 * 60_000)
    return `<programme start="${xmltvDate(programmeStart)}" stop="${xmltvDate(programmeEnd)}" channel="TF1.fr"><title>Recherche programme ${index}</title></programme>`
  }).join('')
  const hiddenProgramme = `<programme start="${xmltvDate(start)}" stop="${xmltvDate(new Date(start.getTime() + 30 * 60_000))}" channel="France2.fr"><title>Recherche chaîne décochée</title></programme>`
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><channel id="France2.fr"><display-name>France 2</display-name></channel>${programmes}${hiddenProgramme}</tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.goto('/tv/')
  await page.getByRole('button', { name: 'Rechercher un programme' }).click()
  const searchInput = page.getByRole('textbox', { name: 'Rechercher un programme' })
  const closeButtonPosition = await page
    .getByRole('button', { name: 'Fermer la recherche' })
    .evaluate((button) => {
      const input = button.parentElement?.querySelector('input')
      const glyph = button.querySelector('span')
      return input && glyph
        ? {
            buttonOffset: button.getBoundingClientRect().top - input.getBoundingClientRect().top,
            glyphTransform: getComputedStyle(glyph).transform,
          }
        : null
    })
  expect(closeButtonPosition?.buttonOffset).toBe(1)
  expect(closeButtonPosition?.glyphTransform).toBe('matrix(1, 0, 0, 1, 0, -2)')
  const closeButton = page.getByRole('button', { name: 'Fermer la recherche' })
  await closeButton.hover()
  await expect(closeButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  await searchInput.fill('re')
  const clearButtonOffset = await page
    .getByRole('button', { name: 'Effacer la recherche' })
    .evaluate((button) => {
      const input = button.parentElement?.querySelector('input')
      return input ? button.getBoundingClientRect().top - input.getBoundingClientRect().top : null
    })
  expect(clearButtonOffset).toBe(-2)
  await expect(
    page.getByText('Saisissez au moins 3 caractères pour lancer la recherche.'),
  ).toBeVisible()
  await page.clock.fastForward(300)
  await expect(page.locator('.search-results .row-wrap')).toHaveCount(0)

  await searchInput.fill('recherche')
  const clearSearchButton = page.getByRole('button', { name: 'Effacer la recherche' })
  await clearSearchButton.hover()
  await expect(clearSearchButton).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(clearSearchButton).toHaveCSS('color', 'rgb(255, 255, 255)')

  await expect(page.getByText('Recherche en cours…')).toBeVisible()
  await expect(page.locator('.search-results .row-wrap')).toHaveCount(0)
  await page.clock.fastForward(300)

  await expect(page.locator('.search-results .row-wrap')).toHaveCount(50)
  await expect(page.locator('.search-results')).toContainText('60 résultats')
  await page.getByRole('button', { name: 'Afficher les 10 résultats suivants' }).click()
  await expect(page.locator('.search-results .row-wrap')).toHaveCount(60)
  await expect(page.getByText('Recherche chaîne décochée')).toHaveCount(0)
})
