import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { addGroceryItem, getGroceryEntries, getGroceryLists, removeGroceryItem, searchProducts, updateGroceryItem } from './api'
import type { GroceryCreate, GroceryEntries, GroceryItem, GroceryLists, ProductOption } from './api'
import './Groceries.css'
import { ProductCreationDialog } from './ProductCreationDialog'
import useUnsavedChanges from './useUnsavedChanges'
import Icon from './Icon'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the request. Please refresh the list.'
}

type Mutation = (operation: () => Promise<unknown>, message: string, afterSave?: () => void) => Promise<void>
type GroceryDraft = { mode: 'product' | 'text'; query: string; product: ProductOption | null; amount: string; note: string }
type AddItemProps = {
  productRevision: number
  onProductCreated: () => void
  initialDraft?: GroceryDraft
  onDraftChange: (draft: GroceryDraft) => void
  onProductBusy: (busy: boolean) => void
  disabled: boolean
  onAdd: (entry: GroceryCreate, reset: () => void) => Promise<void>
}

function AddItem({ disabled, onAdd, onProductBusy, initialDraft, onDraftChange, productRevision, onProductCreated }: AddItemProps) {
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<'product' | 'text'>(initialDraft?.mode ?? 'product')
  const [query, setQuery] = useState(initialDraft?.query ?? '')
  const [product, setProduct] = useState<ProductOption | null>(initialDraft?.product ?? null)
  const [results, setResults] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(Boolean(initialDraft?.query && !initialDraft.product))
  const [searchError, setSearchError] = useState('')
  const [amount, setAmount] = useState(initialDraft?.amount ?? '1')
  const [note, setNote] = useState(initialDraft?.note ?? '')
  useEffect(() => { onDraftChange({ mode, query, product, amount, note }) }, [mode, query, product, amount, note, onDraftChange])
  const [creationNotice, setCreationNotice] = useState('')
  const addButton = useRef<HTMLButtonElement>(null)
  const focusAfterCreation = useRef(false)
  useUnsavedChanges(Boolean(query || note || amount !== '1'))
  useEffect(() => {
    if (!creating && focusAfterCreation.current) { addButton.current?.focus(); focusAfterCreation.current = false }
  }, [creating])
  const searchInput = useRef<HTMLInputElement>(null)
  const focusAfterSave = useRef(false)
  useEffect(() => {
    if (!disabled && focusAfterSave.current) {
      searchInput.current?.focus()
      focusAfterSave.current = false
    }
  }, [disabled])

  useEffect(() => {
    if (mode !== 'product' || product || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true); setSearchError('')
      searchProducts(query.trim(), controller.signal).then(setResults).catch(error => {
        if (!controller.signal.aborted) setSearchError(errorMessage(error))
      }).finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, product, mode, productRevision])

  function reset() {
    setQuery(''); setProduct(null); setResults([]); setNote(''); setAmount('1'); setSearchError(''); setCreationNotice('')
    focusAfterSave.current = true
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || (mode === 'product' && !product)) return
    await onAdd({ product_id: mode === 'product' ? product!.id : null, amount: Number(amount), note: note.trim() }, reset)
  }

  return <section className="card add-item" aria-labelledby="add-heading">
    <h2 id="add-heading">Add an item</h2>
    <p className="product-created" role="status">{creationNotice}</p>
    {creating && <ProductCreationDialog initialName={query.trim()} onBusy={onProductBusy} onCancel={() => setCreating(false)} onChoose={(created, saved) => {
      setProduct({ id: created.id, name: created.name, unit_id: created.unit_id, unit_name: created.unit_name }); setQuery(created.name); setResults([]); setSearching(false); setSearchError(''); setCreating(false)
      setCreationNotice(saved ? `Product saved: ${created.name}. Choose Add to list when you’re ready.` : `${created.name} selected. Choose Add to list when you’re ready.`)
      focusAfterCreation.current = true
      if (saved) onProductCreated()
    }} />}<form onSubmit={submit}>
      <fieldset disabled={disabled}>
        <legend className="sr-only">New grocery item</legend>
        <div className="entry-mode" aria-label="Item type">
          <button type="button" aria-pressed={mode === 'product'} onClick={() => { setMode('product'); setSearching(!product && Boolean(query.trim())) }}>Existing product</button>
          <button type="button" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setSearching(false) }}>Free-text item</button>
        </div>
        {mode === 'product' && <div className="product-search">
          <label htmlFor="product-search">Find a product</label>
          <input ref={searchInput} id="product-search" type="search" value={query} maxLength={100} autoComplete="off"
            aria-describedby="search-help" onChange={event => {
              setQuery(event.target.value); setProduct(null); setResults([]); setSearchError(''); setSearching(Boolean(event.target.value.trim()))
            }} />
          <small id="search-help">Search by name, then select a result.</small>
          {searching && <p role="status">Searching products...</p>}
          {searchError && <p role="alert">{searchError} Change the search to try again.</p>}
          {!product && results.length > 0 && <ul className="search-results" aria-label="Product results">{results.map(result => <li key={result.id}>
            <button type="button" onClick={() => { setProduct(result); setQuery(result.name); setResults([]); setSearching(false) }}>{result.name}<small>{result.unit_name ?? 'Unit unavailable'}</small></button>
          </li>)}</ul>}
          {!product && query.trim() && !searching && !searchError && results.length === 0 && <div><p className="muted">No matching products. Create a new product below, try another name, or add a free-text item.</p></div>}
          <button className="create-product-link" type="button" onClick={() => { setCreationNotice(''); setCreating(true) }}><Icon name="plus" />Create new product</button>{product && <p className="selected-product">Selected: <strong>{product.name}</strong></p>}
        </div>}
        <div className="add-fields">
          <label>Quantity{product && mode === 'product' && <small>in {product.unit_name ?? 'stock units'}</small>}
            <input type="number" inputMode="decimal" min="0.000000001" max="1000000000" step="any" required value={amount} onChange={event => setAmount(event.target.value)} />
          </label>
          <label>{mode === 'text' ? 'Item name / note' : 'Note (optional)'}
            <input value={note} maxLength={2000} required={mode === 'text'} onChange={event => setNote(event.target.value)} />
          </label>
        </div>
        <button ref={addButton} className="primary" disabled={mode === 'product' ? !product || !product.unit_id : !note.trim()} type="submit">Add to list</button>
      </fieldset>
    </form>
  </section>
}

function ItemRow({ item, disabled, mutate }: { item: GroceryItem; disabled: boolean; mutate: Mutation }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(item.amount ?? 1))
  const [note, setNote] = useState(item.note ?? '')
  const [removing, setRemoving] = useState(false)
  useUnsavedChanges(editing && (amount !== String(item.amount ?? 1) || note !== (item.note ?? '')))
  return <li className={`grocery-row ${item.done ? 'is-complete' : ''}`}>
    <div className="grocery-row-main">
      <label className="completion"><input type="checkbox" checked={item.done} disabled={disabled} aria-label={`Mark ${item.name} ${item.done ? 'incomplete' : 'complete'}`}
        onChange={event => { const done = event.target.checked; void mutate(() => updateGroceryItem(item.list_id, item.id, { done }), done ? 'Item completed.' : 'Item marked outstanding.') }} /></label>
      <div className="grocery-description"><strong>{item.name}</strong><span>{item.amount ?? 'Quantity unavailable'} {item.unit_name ?? (item.product_id ? '(stock unit unavailable)' : '')}</span>
        {item.note && item.note !== item.name && <small>{item.note}</small>}
        {item.done && <small>Completed</small>}
      </div>
      <button type="button" disabled={disabled} aria-expanded={editing} aria-controls={`edit-${item.id}`} onClick={() => { setAmount(String(item.amount ?? 1)); setNote(item.note ?? ''); setEditing(!editing); setRemoving(false) }}>Edit<span className="sr-only"> {item.name}</span></button>
    </div>
    {editing && <form id={`edit-${item.id}`} className="edit-item" onSubmit={event => {
      event.preventDefault()
      const changes: { amount?: number; note?: string } = {}
      if (Number(amount) !== item.amount) changes.amount = Number(amount)
      if (note.trim() !== (item.note ?? '')) changes.note = note.trim()
      if (Object.keys(changes).length === 0) { setEditing(false); return }
      void mutate(() => updateGroceryItem(item.list_id, item.id, changes), 'Item updated.', () => setEditing(false))
    }}>
      <fieldset disabled={disabled}>
        <legend>Edit {item.name}</legend>
        <div className="add-fields"><label>Quantity {item.unit_name ? `(${item.unit_name})` : '(stock units)'}<input type="number" min="0.000000001" max="1000000000" step="any" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} /></label>
          <label>{item.product_id ? 'Note' : 'Item name / note'}<input maxLength={2000} required={!item.product_id} value={note} onChange={event => setNote(event.target.value)} /></label></div>
        <div className="edit-actions"><button className="primary" type="submit">Save changes</button><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="remove" type="button" onClick={() => setRemoving(true)}>Remove item</button></div>
        {removing && <div className="remove-confirm"><p>Remove {item.name} from this list?</p><button className="remove" type="button" onClick={() => { void mutate(() => removeGroceryItem(item.list_id, item.id), 'Item removed.') }}>Yes, remove</button><button type="button" onClick={() => setRemoving(false)}>Keep item</button></div>}
      </fieldset>
    </form>}
  </li>
}

export default function Groceries({ productRevision, onProductCreated }: { productRevision: number; onProductCreated: () => void }) {
  const [drafts, setDrafts] = useState<Record<number, GroceryDraft>>({})
  useUnsavedChanges(Object.values(drafts).some(draft => Boolean(draft.query || draft.note || draft.amount !== '1')))
  const [productBusy, setProductBusy] = useState(false)
  const [catalog, setCatalog] = useState<GroceryLists | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const cacheDraft = useCallback((draft: GroceryDraft) => {
    if (selected !== null) setDrafts(previous => ({ ...previous, [selected]: draft }))
  }, [selected])
  const [entries, setEntries] = useState<GroceryEntries | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const mutationLock = useRef(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [reload, setReload] = useState(0)
  const [catalogAttempt, setCatalogAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getGroceryLists(controller.signal).then(result => {
      setCatalog(result)
      setSelected(result.default_list_id ?? result.lists[0]?.id ?? null)
      if (result.lists.length === 0) setLoading(false)
    }).catch(error => {
      if (!controller.signal.aborted) { setError(errorMessage(error)); setLoading(false) }
    })
    return () => controller.abort()
  }, [catalogAttempt])

  useEffect(() => {
    if (selected === null) return
    const controller = new AbortController()
    getGroceryEntries(selected, controller.signal).then(result => {
      setEntries(result); setNeedsRefresh(false)
    }).catch(error => {
      if (!controller.signal.aborted) { setError(errorMessage(error)); setEntries(null); setNeedsRefresh(true) }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [selected, reload])

  function refresh() {
    if (mutationLock.current) return
    setLoading(true); setError(''); setEntries(null); setStatus('')
    if (!catalog || !entries) {
      setCatalog(null); setSelected(null); setCatalogAttempt(n => n + 1)
    } else setReload(n => n + 1)
  }

  const mutate: Mutation = async (operation, message, afterSave) => {
    if (mutationLock.current || selected === null || needsRefresh || loading || productBusy) return
    mutationLock.current = true
    setBusy(true); setError(''); setStatus('')
    let saved = false
    try {
      await operation()
      saved = true
      afterSave?.()
      const result = await getGroceryEntries(selected)
      setEntries(result)
      setStatus(message)
    } catch (error) {
      setNeedsRefresh(true)
      setEntries(null)
      setError(saved ? 'Your change was saved, but the list could not be reloaded. Refresh to see the current items.' : `${errorMessage(error)} Refresh before trying the change again.`)
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }

  return <main tabIndex={-1} className="grocery-page">
    <div className="page-toolbar"><span>Shop with a little less to remember</span><button disabled={loading || busy || productBusy} onClick={refresh}>Refresh</button></div>
    <div className="intro"><p className="eyebrow">ONE LESS THING TO REMEMBER</p><h1 tabIndex={-1}>Your grocery list.</h1><p>Add what you need. Check it off as you shop.</p></div>
    {catalog && catalog.lists.length > 0 && <label className="list-selector">Shopping list<select value={selected ?? ''} disabled={busy || productBusy} onChange={event => {
      setSelected(Number(event.target.value)); setEntries(null); setLoading(true); setError(''); setStatus(''); setNeedsRefresh(false)
    }}>{catalog.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>}
    {error && <div role="alert" className="message error"><p>{error}</p><button disabled={busy || loading} onClick={refresh}>Refresh lists</button></div>}
    <p className="grocery-status" role="status">{busy ? 'Saving and refreshing your list...' : loading ? 'Loading your groceries...' : status}</p>
    {catalog?.lists.length === 0 && <section className="card"><h2>No shopping lists yet</h2><p>Create a shopping list in Grocy to get started.</p></section>}
    {selected !== null && <div className="grocery-layout">
      <AddItem onProductBusy={setProductBusy} key={selected} productRevision={productRevision} onProductCreated={onProductCreated} initialDraft={drafts[selected]} onDraftChange={cacheDraft} disabled={busy || loading || needsRefresh || !entries} onAdd={(entry, reset) => mutate(() => addGroceryItem(selected, entry), 'Item added.', reset)} />
      <section className="card grocery-list" aria-labelledby="items-heading" aria-busy={busy || loading}>
        <h2 id="items-heading">{entries?.name ?? 'Grocery items'}</h2>
        {entries && <><p className="count">{entries.remaining_items}<span>items remaining / {entries.total_items} total</span></p><p className="muted unit-help">Product quantities are in stock units. Checking an item off does not add it to inventory.</p>
          {entries.items.length === 0 ? <p className="empty">Your list is empty. Add your first item.</p> : <ul className="grocery-entries">{[...entries.items].sort((a, b) => Number(a.done) - Number(b.done)).map(item => <ItemRow key={`${selected}-${item.id}`} item={item} disabled={busy || loading || needsRefresh || productBusy} mutate={mutate} />)}</ul>}</>}
      </section>
    </div>}
    <footer>A simpler rhythm for home.</footer>
  </main>
}
