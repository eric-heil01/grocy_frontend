import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addStock, consumeStock, formatDay, getInventory, getStockDetails, InventoryRequestError } from './api'
import type { InventoryOverview, ProductOption, StockAdd, StockConsume, StockDetails, StockEntry } from './api'
import ProductPicker from './ProductPicker'
import useUnsavedChanges from './useUnsavedChanges'
import './Inventory.css'

type Review = { action: 'add'; id: number; name: string; unit: string; location: string; entry: StockAdd; remaining: number }
  | { action: 'consume'; id: number; name: string; unit: string; location: string; entry: StockConsume; remaining: number; batch: StockEntry }

function expiry(entry: StockEntry, today: string, tracked: boolean) {
  if (!tracked) return 'Dates are not tracked'
  if (entry.never_expires) return 'No expiry date'
  if (!entry.due_date) return 'Date unavailable'
  const day = formatDay(entry.due_date, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${entry.due_date < today ? 'Past package date: ' : 'Package date: '}${day}`
}

export default function Inventory({ productRevision, onProductCreated }: { productRevision: number; onProductCreated: () => void }) {
  const [inventory, setInventory] = useState<InventoryOverview | null>(null)
  const [mode, setMode] = useState<'browse' | 'add' | 'consume'>('browse')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<ProductOption | null>(null)
  const [details, setDetails] = useState<StockDetails | null>(null)
  const [amount, setAmount] = useState('1')
  const [location, setLocation] = useState('')
  const [due, setDue] = useState('')
  const [never, setNever] = useState(false)
  const [note, setNote] = useState('')
  const [batch, setBatch] = useState('')
  const [busy, setBusy] = useState(true)
  const [productBusy, setProductBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [lastAttempt, setLastAttempt] = useState<Review | null>(null)
  const pending = useRef(false)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const reviewButton = useRef<HTMLButtonElement>(null)
  const formHeading = useRef<HTMLHeadingElement>(null)
  useUnsavedChanges(Boolean(product || query || amount !== '1' || due || never || note))

  useEffect(() => {
    const controller = new AbortController()
    getInventory(controller.signal).then(setInventory).catch(() => {
      if (!controller.signal.aborted) { setError('Inventory could not be loaded. Refresh inventory to try again.'); setLocked(true) }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!product) return
    const controller = new AbortController()
    getStockDetails(product.id, controller.signal).then(result => {
      setDetails(result)
      setLocation(previous => previous || String(result.product.default_location_id ?? ''))
    }).catch(() => {
      if (!controller.signal.aborted) { setError('Product stock could not be loaded. Refresh inventory before changing it.'); setLocked(true) }
    })
    return () => controller.abort()
  }, [product, productRevision])
  useEffect(() => { if (review) confirmButton.current?.focus() }, [review])

  function choose(nextQuery: string, next: ProductOption | null) {
    setQuery(nextQuery); setProduct(next); setDetails(null); setReview(null); setBatch('')
  }
  function open(action: 'browse' | 'add' | 'consume') {
    if (pending.current || productBusy) return
    setMode(action); setReview(null)
    if (action !== 'browse') requestAnimationFrame(() => formHeading.current?.focus())
  }
  async function refresh() {
    if (pending.current || productBusy) return
    pending.current = true; setBusy(true); setError(''); setReview(null)
    try {
      const next = await getInventory()
      const current = product ? await getStockDetails(product.id) : null
      setInventory(next); setDetails(current); setLocked(false)
      if (current && !current.product.entries.some(entry => String(entry.id) === batch)) setBatch('')
      setStatus(lastAttempt ? 'Inventory refreshed. Compare the quantities with your previous change before recording it again.' : 'Inventory refreshed.')
    } catch { setLocked(true); setError('Inventory could not be refreshed. Changes remain paused. Try Refresh inventory again.') }
    finally { pending.current = false; setBusy(false) }
  }
  function prepare(event: FormEvent) {
    event.preventDefault()
    if (busy || locked || pending.current || !details || !product || details.product.manage_reason) return
    const quantity = Number(amount)
    if (!Number.isFinite(quantity) || quantity <= 0 || !details.product.unit_id) return
    const base = { amount: quantity, unit_id: details.product.unit_id, expected_version: details.product.version }
    const common = { id: product.id, name: details.product.name, unit: details.product.unit_name ?? 'units' }
    if (mode === 'add') {
      const place = details.locations.find(option => String(option.id) === location)
      if (!place) { setError('Choose a storage location.'); return }
      setReview({ ...common, action: 'add', location: place.name, remaining: details.product.amount + quantity, entry: {
        ...base, location_id: place.id, note: note.trim(), ...(details.track_dates ? never ? { never_expires: true } : { best_before_date: due } : {}),
      } })
    } else {
      const entry = details.product.entries.find(entry => String(entry.id) === batch)
      if (!entry?.selectable || quantity > entry.amount) { setError('Choose an available batch and a quantity no greater than what is in that batch.'); return }
      setReview({ ...common, action: 'consume', location: entry.location_name ?? 'Location unavailable', batch: entry,
        entry: { ...base, entry_id: entry.id }, remaining: details.product.amount - quantity })
    }
    setError('')
  }
  async function confirm() {
    if (!review || pending.current || busy || locked) return
    pending.current = true; setBusy(true); setError(''); setStatus(''); setLastAttempt(review)
    let saved = false
    try {
      if (review.action === 'add') await addStock(review.id, review.entry)
      else await consumeStock(review.id, review.entry)
      saved = true
      const next = await getInventory()
      const current = await getStockDetails(review.id)
      setInventory(next); setDetails(current); setReview(null); setLastAttempt(null); setBatch('')
      setStatus(`${review.action === 'add' ? 'Added' : 'Used'} ${review.entry.amount} ${review.unit} of ${review.name}. You now have ${current.product.amount} ${current.product.unit_name ?? 'units'}.`)
      setAmount('1'); setNote(''); setDue(''); setNever(false)
      requestAnimationFrame(() => formHeading.current?.focus())
    } catch (failure) {
      const known = failure instanceof InventoryRequestError && ['validation', 'insufficient', 'unsupported', 'configuration'].includes(failure.code)
      setReview(null)
      setLocked(!known || saved)
      if (known && !saved) setLastAttempt(null)
      setError(saved ? 'Your change was saved, but inventory could not be reloaded. Refresh inventory and check the quantity before making another change.' : failure instanceof InventoryRequestError ? failure.message : 'This change may have been saved. Refresh inventory and check the quantities before recording another change.')
    } finally { pending.current = false; setBusy(false) }
  }
  const disabled = busy || locked || productBusy
  const selectedBatch = details?.product.entries.find(entry => String(entry.id) === batch)
  const products = inventory?.products.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []
  return <main className="inventory-page" tabIndex={-1}>
    <div className="page-toolbar"><span>A clear view of what is at home</span><button disabled={busy || productBusy} onClick={() => void refresh()}>Refresh inventory</button></div>
    <div className="intro"><p className="eyebrow">IN THE CUPBOARD</p><h1 tabIndex={-1}>Your inventory.</h1><p>Add what you bought. Record what you used.</p></div>
    <nav className="inventory-actions" aria-label="Inventory activities">
      <button aria-pressed={mode === 'browse'} onClick={() => open('browse')} disabled={busy || productBusy}>What do I have?</button>
      <button className="primary" aria-pressed={mode === 'add'} onClick={() => open('add')} disabled={busy || productBusy}>I bought some</button>
      <button aria-pressed={mode === 'consume'} onClick={() => open('consume')} disabled={busy || productBusy}>I used some</button>
    </nav>
    {error && <div role="alert" className="message error"><p>{error}</p>{locked && <p>Changes are paused until Refresh inventory succeeds. No change will be retried automatically.</p>}</div>}
    <p className="inventory-status" role="status">{busy ? 'Loading or saving inventory...' : status}</p>
    {lastAttempt && <aside className="message" aria-label="Previous change to check"><p>Check your previous change: {lastAttempt.action === 'add' ? 'adding' : 'using'} {lastAttempt.entry.amount} {lastAttempt.unit} of {lastAttempt.name}, {lastAttempt.location}.</p></aside>}
    {mode !== 'browse' && <section className="card inventory-form-panel" aria-label={mode === 'add' ? 'Add what you bought' : 'Record what you used'}>
      <h2 ref={formHeading} tabIndex={-1}>{mode === 'add' ? 'I bought some' : 'I used some'}</h2>
      {!review ? <form onSubmit={prepare}>
        <fieldset disabled={disabled}>
          <legend className="sr-only">{mode === 'add' ? 'New stock' : 'Used stock'}</legend>
          {mode === 'add' ? <ProductPicker query={query} product={product} onChange={choose} disabled={disabled} revision={productRevision} onCreated={onProductCreated} onBusy={setProductBusy} onAfterCreate={() => formHeading.current?.focus()} /> : <label>Which product did you use?<select value={product?.id ?? ''} required onChange={event => {
            const next = inventory?.products.find(p => String(p.id) === event.target.value)
            choose(next?.name ?? '', next ? { id: next.id, name: next.name, unit_id: next.unit_id, unit_name: next.unit_name } : null)
          }}><option value="">Choose a product</option>{inventory?.products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.amount} {p.unit_name})</option>)}</select></label>}
          {product && !details && <p role="status">Loading product quantities...</p>}
          {details && <>
            <p className="stock-current">Currently have: <strong>{details.product.amount} {details.product.unit_name ?? 'Unit unavailable'}</strong></p>
            {details.product.manage_reason ? <p className="message">{details.product.manage_reason}</p> : <>
              <label>{mode === 'add' ? 'Quantity bought' : 'Quantity used'}<small>in {details.product.unit_name}</small><input type="number" inputMode="decimal" required min="0.000000001" max={mode === 'consume' ? selectedBatch?.amount ?? 1000000000 : 1000000000} step="any" value={amount} onChange={event => setAmount(event.target.value)} /></label>
              {mode === 'add' ? <>
                {details.track_locations ? <label>Where will you keep it?<select value={location} required onChange={event => setLocation(event.target.value)}><option value="">Choose a place</option>{details.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : <p>Usual location: {details.locations.find(l => String(l.id) === location)?.name ?? 'Set up a location in Grocy'}</p>}
                {details.track_dates && <>
                  <label className="inventory-check"><input type="checkbox" checked={never} onChange={event => setNever(event.target.checked)} />This has no expiry date</label>
                  {!never && <label>Package date (best before or use by)<input type="date" required max="2998-12-31" value={due} onChange={event => setDue(event.target.value)} /><small>Use the date on the package. No date is guessed.</small></label>}
                </>}
                <label>Note (optional)<input value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
              </> : <label>Which batch did you use?<select required value={batch} onChange={event => setBatch(event.target.value)}><option value="">Choose a place and package date</option>{details.product.entries.map(entry => <option key={entry.id} value={entry.id} disabled={!entry.selectable}>{entry.location_name ?? 'Location unavailable'} - {entry.amount} {details.product.unit_name} - {expiry(entry, inventory?.today ?? '', details.track_dates)}{entry.opened ? ' - opened' : ''}{entry.note ? ` - ${entry.note}` : ''}</option>)}</select><small>Choose the batch you actually used. Other batches stay unchanged.</small></label>}
            </>}
          </>}
          <div className="inventory-form-actions"><button ref={reviewButton} className="primary" type="submit" disabled={!details || Boolean(details.product.manage_reason)}>Review {mode === 'add' ? 'addition' : 'use'}</button><button type="button" onClick={() => open('browse')}>Back to inventory</button></div>
        </fieldset>
      </form> : <section className="inventory-review" aria-label="Review inventory change">
        <h3>{review.action === 'add' ? 'Add' : 'Use'} {review.entry.amount} {review.unit} of {review.name}?</h3>
        <p>Location: {review.location}</p>
        <p>{review.action === 'consume' ? expiry(review.batch, inventory?.today ?? '', details?.track_dates ?? true) : review.entry.never_expires ? 'No expiry date' : review.entry.best_before_date ? `Package date: ${formatDay(review.entry.best_before_date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Dates are not tracked in Grocy.'}</p>
        {review.action === 'add' && review.entry.note && <p>Note: {review.entry.note}</p>}
        <p>You will have {Number(review.remaining.toFixed(9))} {review.unit} in total.</p>
        <p className="muted">This changes only your inventory. Your grocery lists stay unchanged.</p>
        <div className="inventory-form-actions"><button ref={confirmButton} className="primary" disabled={disabled} onClick={() => void confirm()}>Confirm {review.action === 'add' ? 'addition' : 'use'}</button><button disabled={busy} onClick={() => setReview(null)}>Go back</button></div>
      </section>}
    </section>}
    <section className="inventory-overview" aria-label="What you have">
      <label>Search inventory<input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="Find something at home" /></label>
      {!busy && inventory && !inventory.products.length ? <section className="card empty"><h2>Your pantry is empty.</h2><p>Add something you have at home.</p><button onClick={() => open('add')}>I bought some</button></section> : inventory && !products.length ? <p>No matching products in your inventory.</p> : <ul className="inventory-cards">{products.map(item => <li className="card" key={item.id}>
        <div className="stock-card-heading"><h2>{item.name}</h2>{item.running_low && <span className="stock-low">Running low</span>}</div>
        <p className="stock-total">{item.amount} <span>{item.unit_name ?? 'Unit unavailable'}</span></p>
        <ul className="stock-batches">{item.entries.map(entry => <li key={entry.id}><strong>{entry.amount} {item.unit_name}</strong> in {entry.location_name ?? 'Location unavailable'}<small>{expiry(entry, inventory?.today ?? '', inventory?.track_dates ?? true)}{entry.opened ? ' - opened' : ''}</small>{entry.note && <small>{entry.note}</small>}</li>)}</ul>
        {item.manage_reason && <p className="muted">{item.manage_reason}</p>}
        <button disabled={busy || productBusy || Boolean(item.manage_reason)} onClick={() => { choose(item.name, { id: item.id, name: item.name, unit_id: item.unit_id, unit_name: item.unit_name }); open('consume') }} aria-label={`Use some ${item.name}`}>I used some</button>
      </li>)}</ul>}
    </section>
  </main>
}
