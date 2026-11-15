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
