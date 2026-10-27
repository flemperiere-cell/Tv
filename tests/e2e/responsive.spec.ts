import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('https://xmltvfr.fr/**', (r) => r.abort())
  await page.goto('/tv/')
})
test('aucun débordement horizontal et contrôles accessibles', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Mon Guide', exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  const days = page.getByLabel('Choisir le jour')
  await expect(days).toBeVisible()
  await days.selectOption({ index: 0 })
  await expect(page.getByRole('button', { name: 'Le soir' })).toBeVisible()
  const favoriteToggle = page.getByRole('button', { name: 'Afficher toutes les chaînes' })
  await expect(favoriteToggle).toContainText('★')
  await expect(favoriteToggle).toHaveAttribute('aria-pressed', 'true')
  await favoriteToggle.click()
  await expect(page.getByRole('button', { name: 'Afficher mes favoris' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.getByRole('button', { name: 'Choisir' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Grille' }).click()
  await expect(page.getByRole('main', { name: 'Grille des programmes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Grille' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByLabel('Ouvrir les paramètres').click()
  await expect(page.getByRole('heading', { name: 'Choisir mes chaînes' })).toBeVisible()
})
