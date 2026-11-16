import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addMeal, formatDay, getMeals, removeMeal, searchRecipes, shiftDate, updateMeal } from './api'
import type { MealChanges, MealWeek, PlannedMeal, RecipeOption } from './api'
import './Meals.css'

function DinnerForm({ initialDay, entry, disabled, save, cancel }: {
  initialDay: string; entry: PlannedMeal | null; disabled: boolean
  save: (changes: MealChanges) => void; cancel: () => void
}) {
  const [day, setDay] = useState(initialDay)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RecipeOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [recipe, setRecipe] = useState<RecipeOption | null>(entry?.recipe_id ? { id: entry.recipe_id, name: entry.name, base_servings: null } : null)
  const [servings, setServings] = useState(String(entry?.recipe_servings ?? 1))
  useEffect(() => {
    if (!query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      setSearchError('')
      searchRecipes(query, controller.signal).then(setResults).catch(() => {
        if (!controller.signal.aborted) setSearchError('Recipe search unavailable. Try again.')
      }).finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!recipe) return
    const changes: MealChanges = {}
    if (!entry || day !== initialDay) changes.day = day
    if (!entry || recipe.id !== entry.recipe_id) changes.recipe_id = recipe.id
    if (!entry || Number(servings) !== entry.recipe_servings) changes.recipe_servings = Number(servings)
    if (Object.keys(changes).length) save(changes)
    else cancel()
  }
  return <form className="dinner-form" onSubmit={submit} aria-label={entry ? 'Edit dinner' : 'Add dinner'}>
    <fieldset disabled={disabled}>
      <legend>{entry ? 'Edit dinner' : 'Add dinner'}</legend>
      <label>Dinner date<input autoFocus type="date" value={day} onChange={e => setDay(e.target.value)} required /></label>
      <label>Find a recipe<input type="search" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setResults([]); setRecipe(null); setSearching(Boolean(e.target.value.trim())) }} /></label>
      {query.trim() && !recipe && <div aria-live="polite">
        {searching ? <p role="status">Searching recipes...</p> : searchError ? <p role="alert">{searchError}</p> : results.length === 0 ? <p>No recipes found.</p> : <ul className="recipe-results">{results.map(r => <li key={r.id}><button type="button" onClick={() => { setRecipe(r); setServings(String(r.base_servings ?? 1)) }}>{r.name}</button></li>)}</ul>}
      </div>}
      {recipe && <p>Selected recipe: <strong>{recipe.name}</strong></p>}
      <label>Servings<input type="number" min="0.001" max="1000000000" step="any" value={servings} onChange={e => setServings(e.target.value)} required /></label>
      <div className="meal-actions"><button disabled={!recipe || searching} type="submit">Save dinner</button><button type="button" onClick={cancel}>Cancel</button></div>
    </fieldset>
  </form>
}

export default function Meals() {
  const [week, setWeek] = useState<MealWeek | null>(null)
  const [busy, setBusy] = useState(true)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<{ day: string; entry: PlannedMeal | null } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const active = useRef(true)
  const inFlight = useRef(false)
  async function load(start?: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const next = await getMeals(start)
      if (active.current) { setWeek(next); setLocked(false); setEditor(null); setDeleting(null) }
    } catch (e) {
      if (active.current) { setError((e as Error).message); setLocked(true) }
    } finally { inFlight.current = false; if (active.current) setBusy(false) }
  }
  useEffect(() => {
    active.current = true
    const timer = setTimeout(() => void load(), 0)
    return () => { clearTimeout(timer); active.current = false }
  }, [])
  async function mutate(operation: () => Promise<unknown>) {
    if (inFlight.current || locked) return
    inFlight.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      const next = await getMeals(week?.start)
      if (active.current) { setWeek(next); setEditor(null); setDeleting(null); setNotice('Dinners updated.') }
    } catch (e) {
      if (active.current) { setLocked(true); setEditor(null); setDeleting(null); setError((e as Error).message) }
    } finally { inFlight.current = false; if (active.current) setBusy(false) }
  }
  const disabled = busy || locked
  return <main className="meal-page">
    <div className="product-actions"><button disabled={busy} onClick={() => void load(week?.start)}>Refresh dinners</button></div>
    <nav><a href="#">Back to dashboard</a></nav>
    <div className="intro"><p className="eyebrow">AT THE TABLE</p><h1>Plan your dinners.</h1><p>Seven days, one less thing to think about.</p></div>
    {error && <p role="alert" className="message error">{error} Editing is paused until Refresh dinners succeeds.</p>}
    <div role="status" aria-live="polite">{busy ? 'Loading dinners...' : notice}</div>
    {week && <>
      <nav className="meal-actions" aria-label="Week navigation">
        <button disabled={disabled} onClick={() => void load(shiftDate(week.start, -7))}>Previous week</button>
        <button disabled={disabled} onClick={() => void load()}>Current week</button>
        <button disabled={disabled} onClick={() => void load(shiftDate(week.start, 7))}>Next week</button>
      </nav>
      <p className="date">{formatDay(week.start, { month: 'long', day: 'numeric', year: 'numeric' })} – {formatDay(week.days[6].date, { month: 'long', day: 'numeric', year: 'numeric' })} / {week.timezone}</p>
      <div className="meal-days">{week.days.map(day => <section className="card meal-day" key={day.date} aria-label={day.date}>
        <h2><time dateTime={day.date}>{formatDay(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}{day.date === week.today ? ' · Today' : ''}</time></h2>
        {day.meals.length === 0 && <p className="muted">Nothing planned.</p>}
        <ul>{day.meals.map(meal => <li className="planned-meal" key={meal.id}>
          <strong>{meal.name}</strong><p>{meal.type === 'recipe' ? `${meal.recipe_servings ?? 'Unspecified'} servings` : meal.type === 'product' ? 'Product · edit in Grocy' : 'Dinner note · edit in Grocy'}</p>
          <div className="meal-actions">{meal.type === 'recipe' && <button disabled={disabled} onClick={() => { setEditor({ day: day.date, entry: meal }); setDeleting(null) }} aria-label={`Edit ${meal.name}`}>Edit</button>}
          <button disabled={disabled} onClick={() => { setDeleting(meal.id); setEditor(null) }} aria-label={`Remove ${meal.name}`}>Remove</button></div>
          {deleting === meal.id && <div className="meal-confirm"><p>Remove {meal.name} from dinner on {day.date}?</p><div className="meal-actions"><button disabled={disabled} onClick={() => void mutate(() => removeMeal(meal.id))}>Confirm removal</button><button disabled={disabled} onClick={() => setDeleting(null)}>Cancel</button></div></div>}
        </li>)}</ul>
        <button disabled={disabled} onClick={() => { setEditor({ day: day.date, entry: null }); setDeleting(null) }}>Add dinner</button>
        {editor?.day === day.date && <DinnerForm key={editor.entry?.id ?? day.date} initialDay={day.date} entry={editor.entry} disabled={disabled} cancel={() => setEditor(null)} save={changes => void mutate(() => editor.entry ? updateMeal(editor.entry.id, changes) : addMeal(changes))} />}
      </section>)}</div>
    </>}
  </main>
}
