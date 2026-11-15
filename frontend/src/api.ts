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

export interface GroceryListInfo { id: number; name: string }
export interface GroceryLists { lists: GroceryListInfo[]; default_list_id: number | null }
export interface ProductOption { id: number; name: string; unit_id: number | null; unit_name: string | null }
export interface GroceryItem {
  id: number; list_id: number; product_id: number | null; name: string
  note: string | null; amount: number | null; done: boolean
  unit_id: number | null; unit_name: string | null; display_unit_id: number | null
}
export interface GroceryEntries {
  id: number; name: string; remaining_items: number; total_items: number; items: GroceryItem[]
}
export interface GroceryCreate { product_id: number | null; amount: number; note: string }
export interface GroceryUpdate { amount?: number; note?: string; done?: boolean }

async function groceryRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!response.ok) {
    if (response.status === 422) throw new Error('Check the quantity, selected product, and note. Quantities must be greater than zero.')
    if (response.status === 404) throw new Error('That list or item is no longer available. Refresh and try again.')
    throw new Error('Unable to confirm the request. Refresh the list before trying again.')
  }
  return response.json()
}
const listPath = (listId: number) => `/shopping-lists/${listId}/items`
export const getGroceryLists = (signal?: AbortSignal) => groceryRequest<GroceryLists>('/shopping-lists', { signal })
export const getGroceryEntries = (listId: number, signal?: AbortSignal) => groceryRequest<GroceryEntries>(listPath(listId), { signal })
export const searchProducts = (query: string, signal?: AbortSignal) => groceryRequest<ProductOption[]>(`/products?q=${encodeURIComponent(query)}`, { signal })
export const addGroceryItem = (listId: number, entry: GroceryCreate) => groceryRequest<{ ok: boolean }>(listPath(listId), { method: 'POST', body: JSON.stringify(entry) })
export const updateGroceryItem = (listId: number, entryId: number, changes: GroceryUpdate) => groceryRequest<{ ok: boolean }>(`${listPath(listId)}/${entryId}`, { method: 'PATCH', body: JSON.stringify(changes) })
export const removeGroceryItem = (listId: number, entryId: number) => groceryRequest<{ ok: boolean }>(`${listPath(listId)}/${entryId}`, { method: 'DELETE' })
