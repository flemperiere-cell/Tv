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

test('la loupe ouvre et referme la recherche', async ({ page }) => {
  const searchToggle = page.locator('.search-toggle')
  await searchToggle.click()
  await expect(page.locator('.search-panel input')).toBeVisible()

  await page.locator('.search-panel input').fill('cinéma')
  await searchToggle.click()
  await expect(page.locator('.search-panel')).toHaveCount(0)

  await searchToggle.click()
  await expect(page.locator('.search-panel input')).toHaveValue('')
})

test('les boutons fournissent un retour visuel lorsqu’on les presse', async ({ page }) => {
  const gridToggle = page.getByRole('button', { name: 'Grille' })
  const bounds = await gridToggle.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(gridToggle).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)')
  await page.mouse.up()
})

test('la recherche reste visible au défilement et le double-clic sélectionne le texte', async ({
  page,
}) => {
  await page.locator('.search-toggle').click()
  const searchInput = page.locator('.search-panel input')
  await searchInput.fill('programme de test')
  await searchInput.dblclick()
  await expect(searchInput).toHaveJSProperty('selectionStart', 0)
  await expect(searchInput).toHaveJSProperty('selectionEnd', 'programme de test'.length)

  await page.evaluate(() => {
    document.body.style.minHeight = '2000px'
    window.scrollTo(0, 500)
  })
  const positions = await page.evaluate(() => ({
    toolbarBottom: document.querySelector('.toolbar')?.getBoundingClientRect().bottom,
    panelTop: document.querySelector('.search-panel')?.getBoundingClientRect().top,
  }))
  expect(positions.panelTop).toBeGreaterThanOrEqual(positions.toolbarBottom ?? 0)
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

test('la liste utilise toute la largeur sur tablette avec une police agrandie', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })

  const layout = await page.evaluate(() => {
    const programmeCard = document.createElement('article')
    programmeCard.className = 'programme-row'
    const programmeMain = document.createElement('button')
    programmeMain.className = 'programme-main'
    programmeMain.innerHTML = '<strong>Programme de test</strong>'
    programmeCard.append(programmeMain)
    document.body.append(programmeCard)
    const programmeTitleFontSize = Number.parseFloat(
      getComputedStyle(programmeMain.querySelector('strong')!).fontSize,
    )
    const programmeCardMinHeight = getComputedStyle(programmeCard).minHeight
    programmeCard.remove()

    return {
      appWidth: document.querySelector('.app')?.getBoundingClientRect().width,
      guideWidth: document.querySelector('.guide')?.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      favoriteWidth: document.querySelector('.favorite-toggle')?.getBoundingClientRect().width,
      searchWidth: document.querySelector('.search-toggle')?.getBoundingClientRect().width,
      gridWidth: document.querySelector('.grid-toggle')?.getBoundingClientRect().width,
      programmeTitleFontSize,
      programmeCardMinHeight,
    }
  })

  expect(layout.appWidth).toBe(layout.viewportWidth)
  expect(layout.guideWidth).toBe(layout.viewportWidth)
  expect(layout.rootFontSize).toBe('21.76px')
  expect(layout.programmeTitleFontSize).toBeGreaterThan(19)
  expect(layout.programmeCardMinHeight).toBe('116px')
  expect(layout.favoriteWidth).toBe(42)
  expect(layout.searchWidth).toBe(42)
  expect(layout.gridWidth).toBeLessThan(100)

  const tabletFontSizes = []
  for (const width of [600, 899]) {
    await page.setViewportSize({ width, height: 1024 })
    tabletFontSizes.push(
      await page.evaluate(() => ({
        fontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      })),
    )
  }
  expect(tabletFontSizes[0].fontSize).toBeGreaterThan(20)
  expect(tabletFontSizes[1].fontSize).toBeGreaterThan(tabletFontSizes[0].fontSize)
  expect(tabletFontSizes.every(({ overflows }) => !overflows)).toBe(true)
})

test('les icônes et libellés de la barre sont centrés verticalement sur tablette', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })

  const controlCenters = await page.evaluate(() => {
    const toolbar = document.querySelector('.toolbar')
    if (!toolbar) return null
    return [...toolbar.querySelectorAll('.favorite-toggle, .segmented, .grid-toggle')].map(
      (control) => {
        const { top, height } = control.getBoundingClientRect()
        return top + height / 2
      },
    )
  })

  expect(controlCenters).not.toBeNull()
  if (!controlCenters) return
  expect(Math.max(...controlCenters) - Math.min(...controlCenters)).toBeLessThanOrEqual(1)

  const opticalOffsets = await page.evaluate(() => {
    return ['.favorite-toggle-icon', '.grid-toggle-label'].map((selector) => {
      const content = document.querySelector(selector)
      const button = content?.closest('button')
      if (!content || !button) return null
      const contentBox = content.getBoundingClientRect()
      const buttonBox = button.getBoundingClientRect()
      return contentBox.top + contentBox.height / 2 - (buttonBox.top + buttonBox.height / 2)
    })
  })
  opticalOffsets.forEach((offset) => {
    expect(offset).toBeCloseTo(-1, 1)
  })
})
