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

export interface PlannedMeal { id: number; name: string; recipe_id: number | null; type: string; recipe_servings: number | null }
export interface MealWeek { today: string; timezone: string; start: string; days: (Omit<MealDay, 'meals'> & { meals: PlannedMeal[] })[] }
export interface RecipeOption { id: number; name: string; base_servings: number | null }
export interface MealChanges { day?: string; recipe_id?: number; recipe_servings?: number }
async function mealRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  if (!response.ok) {
    if (response.status === 422) throw new Error('Check the date, recipe selection, and servings. Refresh before trying again.')
    if (response.status === 503) throw new Error('Dinner configuration is unavailable. Check the household timezone and dinner section.')
    if (response.status === 404) throw new Error('This dinner is no longer available. Refresh before trying again.')
    throw new Error('Unable to confirm the meal request. Refresh dinners before trying again.')
  }
  return response.json()
}
export const getMeals = (start?: string, signal?: AbortSignal) => mealRequest<MealWeek>(`/meals${start ? `?start=${encodeURIComponent(start)}` : ''}`, { signal })
export const searchRecipes = (q: string, signal?: AbortSignal) => mealRequest<RecipeOption[]>(`/recipes?q=${encodeURIComponent(q)}`, { signal })
export const addMeal = (entry: MealChanges) => mealRequest<{ ok: boolean }>('/meals', { method: 'POST', body: JSON.stringify(entry) })
export const updateMeal = (id: number, changes: MealChanges) => mealRequest<{ ok: boolean }>(`/meals/${id}`, { method: 'PATCH', body: JSON.stringify(changes) })
export const removeMeal = (id: number) => mealRequest<{ ok: boolean }>(`/meals/${id}`, { method: 'DELETE' })
export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export interface ProductDetails {
  id: number; name: string; location_id: number | null; location_name: string | null
  unit_id: number | null; unit_name: string | null; purchase_unit_name: string | null
  min_stock_amount: number; default_best_before_days: number; active: boolean; version: string
}
export interface ProductSetup { units: { id: number; name: string }[]; locations: { id: number; name: string }[] }
export interface ProductFields { name?: string; location_id?: number; min_stock_amount?: number; default_best_before_days?: number; allow_similar_name?: boolean }
export interface NewProduct extends ProductFields { name: string; unit_id: number; location_id: number }
export class ProductRequestError extends Error {
  code: string
  matches: { id: number; name: string }[]
  constructor(message: string, code = 'uncertain', matches: { id: number; name: string }[] = []) {
    super(message); this.code = code; this.matches = matches
  }
}
async function productRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/product-catalog${path}`, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  if (!response.ok) {
    if (response.status === 409) {
      const body = await response.json().catch(() => null)
      const code = body?.detail?.code
      // Only recognize application-owned contracts; never display arbitrary upstream text.
      if (code === 'duplicate' || code === 'similar') throw new ProductRequestError(code === 'duplicate' ? 'A product with this name already exists. Use it or choose a different name.' : 'A similar product already exists. Review it before creating another.', code, Array.isArray(body.detail.matches) ? body.detail.matches : [])
      if (code === 'stale') throw new ProductRequestError('This product changed since you opened it. Refresh products and review its latest details.', 'stale')
      if (code === 'automatic_shopping') throw new ProductRequestError('Product saving is paused because automatic shopping additions are enabled in Grocy. Ask your household administrator to turn that setting off before saving here.', 'configuration')
    }
    if (response.status === 422) throw new ProductRequestError('Check the name, measurement unit, storage place, and optional numbers.', 'validation')
    if (response.status === 404) throw new ProductRequestError('This product is no longer available. Refresh products.', 'stale')
    throw new ProductRequestError('Unable to confirm your change. Refresh products before saving again.')
  }
  return response.json()
}
export const getProductCatalog = (signal?: AbortSignal) => productRequest<ProductDetails[]>('', { signal })
export const getProductSetup = (signal?: AbortSignal) => productRequest<ProductSetup>('/options', { signal })
export const getProductDetails = (id: number, signal?: AbortSignal) => productRequest<ProductDetails>(`/${id}`, { signal })
export const createProduct = (entry: NewProduct) => productRequest<ProductDetails>('', { method: 'POST', body: JSON.stringify(entry) })
export const editProduct = (id: number, version: string, changes: ProductFields) => productRequest<ProductDetails>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ ...changes, expected_version: version }) })

export interface StockEntry {
  id: number; amount: number; location_id: number | null; location_name: string | null
  due_date: string | null; never_expires: boolean; opened: boolean; purchased_date: string | null
  note: string | null; selectable: boolean
}
export interface StockProduct {
  id: number; name: string; amount: number; unit_id: number | null; unit_name: string | null
  default_location_id: number | null; running_low: boolean; due_type: number | null
  entries: StockEntry[]; version: string; manage_reason: string | null
}
export interface InventoryOverview { today: string; products: StockProduct[]; track_dates: boolean; track_locations: boolean }
export interface StockDetails { product: StockProduct; locations: { id: number; name: string }[]; track_dates: boolean; track_locations: boolean }
export interface StockChange { amount: number; unit_id: number; expected_version: string }
export interface StockAdd extends StockChange { location_id: number; best_before_date?: string; never_expires?: boolean; note: string }
export interface StockConsume extends StockChange { entry_id: number }
export class InventoryRequestError extends Error {
  code: string
  constructor(message: string, code = 'uncertain') { super(message); this.code = code }
}
async function inventoryRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/inventory${path}`, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const code = body?.detail?.code
    const messages: Record<string, string> = {
      stale: 'This product or its stock changed. Refresh inventory and review your change again.',
      unsupported: 'This product or batch needs special handling. Use Grocy to change it.',
      configuration: 'Inventory is disabled, or automatic shopping additions are enabled for the connected Grocy user. Check Grocy settings before changing stock.',
      insufficient: 'There is not enough in the selected batch. Choose a smaller quantity.',
      validation: 'Check the quantity, measurement unit, location, and package date.',
      uncertain: 'This change may have been saved. Refresh inventory and check the quantities before recording another change.',
    }
    if (Object.hasOwn(messages, code)) throw new InventoryRequestError(messages[code], code)
    if (response.status === 422) throw new InventoryRequestError(messages.validation, 'validation')
    throw new InventoryRequestError(messages.uncertain)
  }
  return response.json()
}
export const getInventory = (signal?: AbortSignal) => inventoryRequest<InventoryOverview>('', { signal })
export const getStockDetails = (id: number, signal?: AbortSignal) => inventoryRequest<StockDetails>(`/products/${id}`, { signal })
export const addStock = (id: number, entry: StockAdd) => inventoryRequest<{ ok: boolean }>(`/products/${id}/add`, { method: 'POST', body: JSON.stringify(entry) })
export const consumeStock = (id: number, entry: StockConsume) => inventoryRequest<{ ok: boolean }>(`/products/${id}/consume`, { method: 'POST', body: JSON.stringify(entry) })
