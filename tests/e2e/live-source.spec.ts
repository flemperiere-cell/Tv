import { expect, test } from '@playwright/test'

test('la source réelle est lisible et décompressable depuis Chromium', async ({ page }) => {
  test.skip(process.env.LIVE_EPG !== '1', 'Activer explicitement avec LIVE_EPG=1')
  await page.goto('/tv/')
  await expect(page.getByText(/Mis à jour/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Afficher toutes les chaînes' }).click()
  await expect(page.locator('.programme-row').first()).toBeVisible()
  const available = page
    .locator('.programme-main')
    .filter({ hasNotText: 'Programme indisponible' })
    .first()
  await available.click()
  await expect(page.locator('.detail-page')).toBeVisible()
  const box = await page.locator('.detail-screen').boundingBox()
  expect(box?.width).toBe(390)
  expect(box?.height).toBe(800)
})

test('fusionne les crédits du guide complet avec le programme TNT', async ({ page }) => {
  test.skip(process.env.LIVE_EPG !== '1', 'Activer explicitement avec LIVE_EPG=1')
  await page.goto('/tv/')
  await expect(page.getByText(/Mis à jour/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Ce soir' }).click()
  await page.getByRole('button', { name: /Détails de Cat's Eyes/ }).click()
  await expect(page.getByText('Alexandre Laurent', { exact: true })).toBeVisible()
  await expect(page.locator('.programme-facts dd').filter({ hasText: 'Camille Lou' })).toBeVisible()
})
