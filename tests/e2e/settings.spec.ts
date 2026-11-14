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

test('les paramètres filtrent toutes les chaînes et replient leurs sections', async ({ page }) => {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const xml = `<tv><channel id="TF1.fr"><display-name>TF1</display-name></channel><channel id="France2.fr"><display-name>France 2</display-name></channel><channel id="France24.fr"><display-name>France 24</display-name></channel><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="TF1.fr"><title>Journal TF1</title></programme><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="France2.fr"><title>Journal France 2</title></programme><programme start="${xmltvDate(start)}" stop="${xmltvDate(end)}" channel="France24.fr"><title>Journal France 24</title></programme></tv>`

  await page.route('https://xmltvfr.fr/xmltv/xmltv.xml.gz', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/gzip' },
      body: gzipSync(xml),
    }),
  )
  await page.goto('/tv/')
  await page.getByLabel('Ouvrir les paramètres').click()
  await expect(page.locator('.channel-list label')).toHaveCount(3)

  const channelLabels = page.locator('.channel-list label')
  await expect(channelLabels.filter({ hasText: 'TF1' }).getByRole('checkbox')).toBeChecked()
  await expect(channelLabels.filter({ hasText: /France 2$/ }).getByRole('checkbox')).toBeChecked()
  await expect(
    channelLabels.filter({ hasText: /France 24$/ }).getByRole('checkbox'),
  ).not.toBeChecked()

  const filter = page.getByRole('textbox', { name: 'Filtrer les chaînes' })
  await filter.fill('france 24')
  await expect(page.locator('.channel-list label')).toHaveCount(1)
  await expect(page.locator('.channel-list label')).toContainText('France 24')
  await page.getByRole('button', { name: 'Effacer le filtre des chaînes' }).click()
  await expect(filter).toHaveValue('')
  await expect(page.locator('.channel-list label')).toHaveCount(3)

  const sections = page.locator('.settings-section')
  await expect(sections.nth(0)).toHaveAttribute('open', '')
  await expect(sections.nth(1)).not.toHaveAttribute('open')
  await expect(sections.nth(2)).not.toHaveAttribute('open')
  await page.getByRole('heading', { name: 'Réglages' }).click()
  await expect(sections.nth(1)).toHaveAttribute('open', '')
  await page.getByRole('heading', { name: 'Choisir mes chaînes' }).click()
  await expect(sections.nth(0)).not.toHaveAttribute('open')
  await page.getByRole('heading', { name: 'À propos' }).click()
  await expect(sections.nth(2)).toHaveAttribute('open', '')
})
