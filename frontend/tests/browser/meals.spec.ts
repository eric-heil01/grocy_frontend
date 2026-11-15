import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Plan dinners', exact: true }).click()
  await expect(page.locator('.meal-day')).toHaveCount(7)
  await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeEnabled()
}
async function choose(page: Page, name = 'Pasta') {
  await page.getByLabel('Find a recipe').fill(name.slice(0, 3))
  await page.getByRole('button', { name, exact: true }).click()
}
async function add(page: Page) {
  await page.getByRole('button', { name: 'Add dinner' }).first().click()
  await choose(page)
  await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
  await expect(page.locator('.planned-meal')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeEnabled()
}

test.beforeEach(async ({ request }) => { expect((await request.post('/_test/reset')).ok()).toBeTruthy() })

test('navigates seven-day periods, adds multiple dinners, edits date recipe servings, refreshes dashboard and removes one', async ({ page }) => {
  await open(page)
  const firstDate = await page.locator('.meal-day time').first().getAttribute('datetime')
  await page.getByRole('button', { name: 'Next week' }).click()
  await expect(page.locator('.meal-day time').first()).not.toHaveAttribute('datetime', firstDate!)
  await page.getByRole('button', { name: 'Previous week' }).click()
  await expect(page.locator('.meal-day time').first()).toHaveAttribute('datetime', firstDate!)
  await page.getByRole('button', { name: 'Next week' }).click()
  await page.getByRole('button', { name: 'Current week' }).click()
  await expect(page.locator('.meal-day time').first()).toHaveAttribute('datetime', firstDate!)
  await add(page)
  await page.getByRole('button', { name: 'Add dinner' }).first().click()
  await choose(page)
  await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
  await expect(page.locator('.planned-meal')).toHaveCount(2)
  await page.getByRole('button', { name: 'Edit Pasta' }).first().click()
  const nextDate = await page.locator('.meal-day time').nth(1).getAttribute('datetime')
  await page.getByLabel('Dinner date').fill(nextDate!)
  await choose(page, 'Curry')
  await page.getByLabel('Servings', { exact: true }).fill('3.5')
  await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
  await expect(page.locator('.meal-day').nth(1)).toContainText('Curry')
  await expect(page.locator('.meal-day').nth(1)).toContainText('3.5 servings')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: `test-results/meal-planner-${page.viewportSize()!.width}.png`, fullPage: true })
  await page.reload()
  await expect(page.locator('.planned-meal')).toHaveCount(2)
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(page.locator('.dinner-name')).toContainText('Pasta')
  await expect(page.locator('.week')).toContainText('Curry')
  await page.getByRole('link', { name: 'Open meal planner' }).click()
  await page.getByRole('button', { name: 'Remove Pasta' }).click()
  await expect(page.getByText('Remove Pasta from dinner on', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.planned-meal')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove Pasta' }).click()
  await page.getByRole('button', { name: 'Confirm removal' }).click()
  await expect(page.locator('.planned-meal')).toHaveCount(1)
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(page.locator('.dinner-name')).toContainText('Nothing planned')
  const state = await (await page.request.get('/_test/state')).json()
  expect(state.meals).toHaveLength(1)
  expect(state.meals[0]).toMatchObject({ recipe_id: 21, day: nextDate, recipe_servings: 3.5 })
})

for (const mode of ['write', 'reload']) {
  test(`locks after ${mode} failure until refresh, never retries a write`, async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Add dinner' }).first().click()
    await page.getByLabel('Find a recipe').fill('zzzzz')
    await expect(page.getByText('No recipes found.')).toBeVisible()
    await choose(page)
    await page.request.post(`/_test/failure/${mode}`)
    await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Editing is paused')
    await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled()
    await page.getByRole('button', { name: 'Refresh dinners' }).click()
    await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeEnabled()
    await expect(page.locator('.planned-meal')).toHaveCount(mode === 'reload' ? 1 : 0)
    const state = await (await page.request.get('/_test/state')).json()
    expect(state.requests.filter(([method]: string[]) => method === 'POST')).toHaveLength(mode === 'reload' ? 1 : 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  })
}

test('pending saves disable editing and duplicate submissions', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add dinner' }).first().click()
  await choose(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/meals', async route => {
    if (route.request().method() === 'POST') await gate
    await route.continue()
  })
  await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save dinner', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeDisabled()
  release()
  await expect(page.locator('.planned-meal')).toHaveCount(1)
})

for (const action of ['edit', 'delete']) {
  test(`requires refresh after uncertain ${action} outcome`, async ({ page }) => {
    await open(page)
    await add(page)
    await page.route('**/api/meals/*', async route => {
      if (route.request().method() === 'GET') return route.continue()
      const response = await route.fetch()
      expect(response.ok()).toBeTruthy()
      await route.fulfill({ status: 502, body: 'SECRET timeout after upstream save' })
    })
    if (action === 'edit') {
      await page.getByRole('button', { name: 'Edit Pasta' }).click()
      await page.getByLabel('Servings', { exact: true }).fill('5')
      await page.getByRole('button', { name: 'Save dinner', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Remove Pasta' }).click()
      await page.getByRole('button', { name: 'Confirm removal' }).click()
    }
    await expect(page.getByRole('alert')).toContainText('Editing is paused')
    await expect(page.getByRole('alert')).not.toContainText('SECRET')
    await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeDisabled()
    await page.getByRole('button', { name: 'Refresh dinners' }).click()
    await expect(page.getByRole('button', { name: 'Add dinner' }).first()).toBeEnabled()
    if (action === 'edit') await expect(page.locator('.planned-meal')).toContainText('5 servings')
    else await expect(page.locator('.planned-meal')).toHaveCount(0)
    const state = await (await page.request.get('/_test/state')).json()
    expect(state.requests.filter(([method]: string[]) => method === (action === 'edit' ? 'PUT' : 'DELETE'))).toHaveLength(1)
  })
}
