import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDashboard, formatDay } from '../src/api.ts'

test('uses the relative API and forwards cancellation', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/api/dashboard')
      assert.equal(options.signal, controller.signal)
      return new Response(JSON.stringify({ today: '2026-11-15' }))
    }
    assert.equal((await getDashboard(controller.signal)).today, '2026-11-15')
  } finally { globalThis.fetch = original }
})

test('upstream errors do not reveal response bodies', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('sensitive upstream error', { status: 502 })
    await assert.rejects(getDashboard(new AbortController().signal), { message: 'Unable to load your household. Please try again.' })
  } finally { globalThis.fetch = original }
})

test('calendar date formatting does not drift across timezones', () => {
  for (const tz of ['America/Denver', 'Pacific/Auckland', 'UTC']) {
    process.env.TZ = tz
    assert.equal(formatDay('2026-11-15', { day: 'numeric' }), '15')
  }
})

import { getGroceryLists, getGroceryEntries, searchProducts, addGroceryItem, updateGroceryItem, removeGroceryItem } from '../src/api.ts'

test('grocery reads select lists and safely encode product queries', async () => {
  const original = globalThis.fetch
  const requests = []
  try {
    globalThis.fetch = async (url, options) => {
      requests.push([url, options.signal])
      return new Response(JSON.stringify({ lists: [] }))
    }
    const controller = new AbortController()
    await getGroceryLists(controller.signal)
    await getGroceryEntries(3, controller.signal)
    await searchProducts('milk & tea?', controller.signal)
    assert.deepEqual(requests.map(r => r[0]), ['/api/shopping-lists', '/api/shopping-lists/3/items', '/api/products?q=milk%20%26%20tea%3F'])
    assert.ok(requests.every(r => r[1] === controller.signal))
  } finally { globalThis.fetch = original }
})

test('grocery writes use entry IDs, explicit fields, and no stock purchase path', async () => {
  const original = globalThis.fetch
  const requests = []
  try {
    globalThis.fetch = async (url, options) => {
      requests.push([url, options.method, options.body ? JSON.parse(options.body) : null])
      assert.equal(options.headers.Accept, 'application/json')
      if (options.body) assert.equal(options.headers['Content-Type'], 'application/json')
      return new Response(JSON.stringify({ ok: true }))
    }
    await addGroceryItem(2, { product_id: 10, amount: 2, note: 'Whole milk' })
    await updateGroceryItem(2, 101, { done: true })
    await updateGroceryItem(2, 101, { done: false })
    await updateGroceryItem(2, 101, { amount: 3, note: '' })
    await removeGroceryItem(2, 101)
    assert.deepEqual(requests, [
      ['/api/shopping-lists/2/items', 'POST', { product_id: 10, amount: 2, note: 'Whole milk' }],
      ['/api/shopping-lists/2/items/101', 'PATCH', { done: true }],
      ['/api/shopping-lists/2/items/101', 'PATCH', { done: false }],
      ['/api/shopping-lists/2/items/101', 'PATCH', { amount: 3, note: '' }],
      ['/api/shopping-lists/2/items/101', 'DELETE', null],
    ])
  } finally { globalThis.fetch = original }
})

test('failed grocery writes reject without revealing bodies or retrying', async () => {
  const original = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; return new Response('SECRET', { status: 502 }) }
    await assert.rejects(addGroceryItem(2, { product_id: null, amount: 1, note: 'Sponges' }), { message: 'Unable to confirm the request. Refresh the list before trying again.' })
    assert.equal(calls, 1)
    globalThis.fetch = async () => new Response('SECRET', { status: 422 })
    await assert.rejects(updateGroceryItem(2, 101, { amount: -1 }), /greater than zero/)
    globalThis.fetch = async () => new Response('SECRET', { status: 404 })
    await assert.rejects(removeGroceryItem(2, 101), /no longer available/)
  } finally { globalThis.fetch = original }
})
