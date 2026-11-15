export interface MealDay {
  date: string
  available: boolean
  planned: boolean | null
  meals: { id: number; name: string; recipe_id: number | null }[]
}
export interface Dashboard {
  today: string
  timezone: string
  dinner_tonight: MealDay
  upcoming_meals: MealDay[]
  shopping_list: {
    available: boolean; id: number | null; name: string | null
    remaining_items: number | null; total_items: number | null
    items: { id: number; list_id: number | null; product_id: number | null; name: string; note: string | null; amount: number | null; done: boolean }[]
  }
  inventory: { available: boolean; low_stock: { id: number; name: string; amount_missing: number }[] }
  notices: string[]
}
export async function getDashboard(signal: AbortSignal): Promise<Dashboard> {
  const response = await fetch('/api/dashboard', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Unable to load your household. Please try again.')
  return response.json()
}
// Calendar dates stay calendar dates, independent of the browser timezone.
export function formatDay(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}
