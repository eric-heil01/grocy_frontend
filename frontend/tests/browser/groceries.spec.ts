import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const count = (page: Page) => page.locator('.grocery-list .count')
const row = (page: Page, name: string) => page.locator('.grocery-row').filter({ hasText: name })

async function openGroceries(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'View grocery list' }).click()
  await expect(page.getByRole('heading', { name: 'Your grocery list.' })).toBeVisible()
  await expect(count(page)).toContainText('1items remaining / 1 total')
}

async function state(page: Page) {
  return (await page.request.get('/_test/state')).json()
}

test.beforeEach(async ({ request }) => {
  const reset = await request.post('/_test/reset')
  expect(reset.ok()).toBeTruthy()
})

test('opens from dashboard, switches lists, shows units and completed items without horizontal overflow', async ({ page }) => {
  await openGroceries(page)
  await expect(row(page, 'Milk')).toContainText('2 bottle')
  await expect(row(page, 'Milk')).toContainText('Whole milk')
  await page.getByRole('combobox', { name: 'Shopping list', exact: true }).selectOption('3')
  await expect(count(page)).toContainText('0items remaining / 1 total')
  await expect(page.getByRole('checkbox', { name: 'Mark Paper bags incomplete' })).toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.getByRole('combobox', { name: 'Shopping list', exact: true }).selectOption('2')
  await expect(count(page)).toContainText('1items remaining / 1 total')
  await expect(row(page, 'Paper bags')).toHaveCount(0)
})

test('searches and adds a product with quantity/note, persists after reload and refreshes dashboard count', async ({ page }) => {
  await openGroceries(page)
  const add = page.getByRole('region', { name: 'Add an item' })
  await add.getByLabel('Find a product').fill('tea')
  await add.getByRole('button', { name: 'Tea bottle', exact: true }).click()
  await add.getByLabel('Quantity').fill('3')
  await add.getByLabel('Note (optional)').fill('Decaf')
  await add.getByRole('button', { name: 'Add to list' }).click()
  await expect(row(page, 'Tea')).toContainText('3 bottle')
  await expect(row(page, 'Tea')).toContainText('Decaf')
  await expect(count(page)).toContainText('2items remaining / 2 total')
  await expect(add.getByLabel('Find a product')).toBeFocused()
  await page.reload()
  await expect(row(page, 'Tea')).toContainText('3 bottle')
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.locator('.groceries .count')).toContainText('2items remaining')
  const upstream = await state(page)
  expect(upstream.items.find((item: { product_id: number }) => item.product_id === 11)).toMatchObject({ amount: 3, note: 'Decaf', shopping_list_id: 2, qu_id: 5 })
  expect(upstream.requests.filter(([method, path]: string[]) => method !== 'GET' && !path.startsWith('objects/shopping_list'))).toEqual([])
})

test('adds a free-text item to the selected list and edits its quantity and name', async ({ page }) => {
  await openGroceries(page)
  await page.getByRole('combobox', { name: 'Shopping list', exact: true }).selectOption('3')
  await expect(count(page)).toContainText('0items remaining / 1 total')
  const add = page.getByRole('region', { name: 'Add an item' })
  await add.getByRole('button', { name: 'Free-text item' }).click()
  await add.getByLabel('Item name / note').fill('Sponges')
  await add.getByLabel('Quantity').fill('2')
  await add.getByRole('button', { name: 'Add to list' }).click()
  await expect(count(page)).toContainText('1items remaining / 2 total')
  const sponges = row(page, 'Sponges')
  await sponges.getByRole('button', { name: 'Edit Sponges' }).click()
  await sponges.getByLabel('Quantity').fill('4')
  await sponges.getByLabel('Item name / note').fill('Soft sponges')
  await sponges.getByRole('button', { name: 'Save changes' }).click()
  await expect(row(page, 'Soft sponges')).toContainText('4')
  const upstream = await state(page)
  expect(upstream.items.find((item: { note: string }) => item.note === 'Soft sponges')).toMatchObject({ amount: 4, shopping_list_id: 3, product_id: null })
  expect(upstream.items.find((item: { id: number }) => item.id === 101)).toMatchObject({ shopping_list_id: 2, amount: 2 })
})

test('completes and undoes, edits only requested fields, confirms removal and displays an empty list', async ({ page }) => {
  await openGroceries(page)
  await page.getByRole('checkbox', { name: 'Mark Milk complete', exact: true }).click()
  await expect(count(page)).toContainText('0items remaining / 1 total')
  await expect(page.getByRole('checkbox', { name: 'Mark Milk incomplete', exact: true })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Mark Milk incomplete', exact: true }).click()
  await expect(count(page)).toContainText('1items remaining / 1 total')
  const milk = row(page, 'Milk')
  await milk.getByRole('button', { name: 'Edit Milk' }).click()
  await milk.getByLabel('Quantity').fill('4.5')
  await milk.getByLabel('Note', { exact: true }).fill('Semi-skimmed')
  await milk.getByRole('button', { name: 'Save changes' }).click()
  await expect(milk).toContainText('4.5 bottle')
  const upstream = await state(page)
  expect(upstream.items.find((item: { id: number }) => item.id === 101)).toMatchObject({ product_id: 10, qu_id: 6, userfields: { keep: 'value' }, amount: 4.5, note: 'Semi-skimmed', done: 0 })
  await milk.getByRole('button', { name: 'Edit Milk' }).click()
  await milk.getByRole('button', { name: 'Remove item', exact: true }).click()
  await milk.getByRole('button', { name: 'Keep item' }).click()
  await expect(milk).toBeVisible()
  await milk.getByRole('button', { name: 'Remove item', exact: true }).click()
  await milk.getByRole('button', { name: 'Yes, remove' }).click()
  await expect(page.getByText('Your list is empty. Add your first item.')).toBeVisible()
  await expect(count(page)).toContainText('0items remaining / 0 total')
  await page.reload()
  await expect(count(page)).toContainText('0items remaining / 0 total')
})

test('disables controls during a pending add and sends only one write', async ({ page }) => {
  await openGroceries(page)
  const add = page.getByRole('region', { name: 'Add an item' })
  await add.getByRole('button', { name: 'Free-text item' }).click()
  await add.getByLabel('Item name / note').fill('Pending item')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/shopping-lists/2/items', async route => {
    if (route.request().method() === 'POST') await gate
    await route.continue()
  })
  try {
    await add.getByRole('button', { name: 'Add to list' }).click()
    await expect(add.getByRole('button', { name: 'Add to list' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: 'Shopping list', exact: true })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Mark Milk complete', exact: true })).toBeDisabled()
    await expect(page.getByText('Saving and refreshing your list...')).toBeVisible()
  } finally { release() }
  await expect(count(page)).toContainText('2items remaining / 2 total')
  const upstream = await state(page)
  expect(upstream.requests.filter(([method]: string[]) => method === 'POST')).toHaveLength(1)
})

for (const mode of ['write', 'reload']) {
  test(`handles ${mode === 'write' ? 'a rejected write' : 'a saved write followed by reload failure'} without false success or duplicates`, async ({ page, request }) => {
    await openGroceries(page)
    const add = page.getByRole('region', { name: 'Add an item' })
    await add.getByRole('button', { name: 'Free-text item' }).click()
    await add.getByLabel('Item name / note').fill('Recovery item')
    expect((await request.post(`/_test/failure/${mode}`)).ok()).toBeTruthy()
    await add.getByRole('button', { name: 'Add to list' }).click()
    await expect(page.getByRole('alert')).toContainText(mode === 'write' ? 'Unable to confirm the request' : 'Your change was saved, but the list could not be reloaded')
    await expect(page.getByRole('alert')).not.toContainText('SECRET')
    await expect(add.getByRole('button', { name: 'Add to list' })).toBeDisabled()
    await expect(page.getByText('Item added.', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Refresh lists', exact: true }).click()
    await expect(count(page)).toContainText(mode === 'write' ? '1items remaining / 1 total' : '2items remaining / 2 total')
    const upstream = await state(page)
    expect(upstream.items.filter((item: { note: string }) => item.note === 'Recovery item')).toHaveLength(mode === 'write' ? 0 : 1)
  })
}
