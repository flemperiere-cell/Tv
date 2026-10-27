import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('https://xmltvfr.fr/**', (r) => r.abort())
  await page.goto('/tv/')
})
test('aucun débordement horizontal et contrôles accessibles', async ({ page }) => {
  await expect(page.locator('.brand-icon')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mon Guide', exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  const days = page.getByLabel('Choisir le jour')
  await expect(days).toBeVisible()
  await expect(page.getByRole('button', { name: /Revenir à aujourd’hui/ })).toHaveCount(0)
  await expect(page.locator('.return-to-today-slot')).toBeVisible()
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
  const mainHeaderLayout = await page.locator('.app > header').evaluate((header) => {
    const actions = header.querySelector('.header-actions')
    if (!actions) return null
    const headerRect = header.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    const style = getComputedStyle(header)
    return {
      left: headerRect.left + Number.parseFloat(style.paddingLeft),
      right: headerRect.right - Number.parseFloat(style.paddingRight),
      actionsRight: actionsRect.right,
    }
  })
  await page.getByLabel('Ouvrir les paramètres').click()
  await expect(page.getByRole('heading', { name: 'Choisir mes chaînes' })).toBeVisible()
  await expect(page.locator('.app > header')).toBeVisible()
  const settingsHeaderLayout = await page.locator('.app > header').evaluate((header) => {
    const actions = header.querySelector('.header-actions')
    if (!actions) return null
    const headerRect = header.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    const style = getComputedStyle(header)
    return {
      left: headerRect.left + Number.parseFloat(style.paddingLeft),
      right: headerRect.right - Number.parseFloat(style.paddingRight),
      actionsRight: actionsRect.right,
    }
  })
  expect(settingsHeaderLayout).toEqual(mainHeaderLayout)
})

test('revient à aujourd’hui et au créneau correspondant à l’heure', async ({ page }) => {
  const day = page.getByLabel('Choisir le jour')
  const todayOption = day.getByRole('option', { name: 'Aujourd’hui' })
  await day.selectOption({ index: 0 })
  const returnButton = page.getByRole('button', { name: /Revenir à aujourd’hui/ })
  await expect(returnButton).toBeVisible()
  const beforeLayout = await page.evaluate(() => ({
    slotWidth: document.querySelector('.return-to-today-slot')?.getBoundingClientRect().width,
    dateLeft: document.querySelector('.header-day')?.getBoundingClientRect().left,
  }))
  const isBeforeDateSelect = await returnButton.evaluate((button) => {
    const dateSelect = button.closest('header')?.querySelector('select')
    return dateSelect
      ? Boolean(button.compareDocumentPosition(dateSelect) & Node.DOCUMENT_POSITION_FOLLOWING)
      : false
  })
  expect(isBeforeDateSelect).toBe(true)
  await returnButton.click()
  await expect(day).toHaveValue(await todayOption.getAttribute('value') || '')
  await expect(returnButton).toHaveCount(0)
  const afterLayout = await page.evaluate(() => ({
    slotWidth: document.querySelector('.return-to-today-slot')?.getBoundingClientRect().width,
    dateLeft: document.querySelector('.header-day')?.getBoundingClientRect().left,
  }))
  expect(afterLayout).toEqual(beforeLayout)

  const { hour, minute } = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    return {
      hour: Number(parts.find((part) => part.type === 'hour')?.value),
      minute: Number(parts.find((part) => part.type === 'minute')?.value),
    }
  })
  const expectedMode = hour > 19 || (hour === 19 && minute >= 30) ? 'Ce soir' : 'Maintenant'
  await expect(page.locator('.segmented .selected')).toHaveText(expectedMode)
})
