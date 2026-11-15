import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createProduct, editProduct, getProductCatalog, getProductDetails, getProductSetup, ProductRequestError } from './api'
import type { NewProduct, ProductDetails, ProductFields, ProductSetup } from './api'
import './Products.css'

const key = (name: string) => name.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ')

function ProductForm({ product, initialName, setup, catalog, disabled, similarRequired, onSave, onCancel, onChoose }: {
  product: ProductDetails | null; initialName: string; setup: ProductSetup; catalog: ProductDetails[]; disabled: boolean; similarRequired: boolean
  onSave: (entry: NewProduct | ProductFields) => void; onCancel: () => void; onChoose: (product: ProductDetails) => void
}) {
  const [name, setName] = useState(product?.name ?? initialName)
  const [unit, setUnit] = useState('')
  const [location, setLocation] = useState(String(product?.location_id ?? ''))
  const [minimum, setMinimum] = useState(String(product?.min_stock_amount ?? 0))
  const [days, setDays] = useState(String(product?.default_best_before_days ?? 0))
  const [allowSimilar, setAllowSimilar] = useState(false)
  const matches = name.trim() && (!product || key(name) !== key(product.name)) ? catalog.filter(p => p.id !== product?.id && (key(p.name).includes(key(name)) || key(name).includes(key(p.name)))) : []
  const exact = matches.some(p => key(p.name) === key(name))
  const missingSetup = !setup.units.length || !setup.locations.length
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled || exact || ((matches.length > 0 || similarRequired) && !allowSimilar)) return
    if (!product) onSave({ name: name.trim(), unit_id: Number(unit), location_id: Number(location), min_stock_amount: Number(minimum), default_best_before_days: Number(days), allow_similar_name: allowSimilar })
    else {
      const changes: ProductFields = {}
      if (name.trim() !== product.name) changes.name = name.trim()
      if (Number(location) !== product.location_id) changes.location_id = Number(location)
      if (Number(minimum) !== product.min_stock_amount) changes.min_stock_amount = Number(minimum)
      if (Number(days) !== product.default_best_before_days) changes.default_best_before_days = Number(days)
      if (!Object.keys(changes).length) { onCancel(); return }
      onSave({ ...changes, allow_similar_name: allowSimilar })
    }
  }
  return <form className="product-form" aria-label={product ? 'Edit product' : 'Create product'} onSubmit={submit}>
    <fieldset disabled={disabled}>
      <legend>{product ? `Edit ${product.name}` : 'Add a product'}</legend>
      <p className="product-help">This saves a product for future use. It does not add anything to your cupboards or shopping list.</p>
      <label>What is it called?<input autoFocus value={name} maxLength={200} required onChange={e => { setName(e.target.value); setAllowSimilar(false) }} placeholder="For example, whole milk" /></label>
      {(matches.length > 0 || similarRequired) && <aside className="duplicate-products" aria-label="Possible existing products">
        <p>{exact ? 'This product already exists.' : 'Could one of these be the product you need?'}</p>
        <ul>{matches.slice(0, 10).map(p => <li key={p.id}><button type="button" onClick={() => onChoose(p)}>Use {p.name}{!p.active ? ' (inactive)' : ''}</button></li>)}</ul>
        {!exact && <label className="product-check"><input type="checkbox" checked={allowSimilar} onChange={e => setAllowSimilar(e.target.checked)} />This is a different product.</label>}
      </aside>}
      {product ? <div className="fixed-unit"><p>Count or measure in: <strong>{product.unit_name ?? 'Unit unavailable'}</strong></p><p>Usually bought in: {product.purchase_unit_name ?? 'Unit unavailable'}</p><small>Units stay unchanged here because changing them can affect quantities already used in cupboards, recipes, and shopping lists.</small></div> : <>
        <label>How do you count or measure it?<select required value={unit} onChange={e => setUnit(e.target.value)} aria-describedby="unit-explanation"><option value="">Choose a unit</option>{setup.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <p id="unit-explanation" className="product-help">Choose the unit you will use each time, such as a bottle, item, or gram. One bottle means one bottle; no package sizes or conversions are assumed.</p>
      </>}
      <label>Where do you normally keep it?<select required value={location} onChange={e => setLocation(e.target.value)} aria-describedby="location-explanation"><option value="">Choose a place</option>{setup.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <p id="location-explanation" className="product-help">This is its usual place. Changing it does not move anything you already have.</p>
      {!product && missingSetup && <p role="alert">A household administrator needs to add at least one measurement unit and storage place in Grocy before you can create products.</p>}
      <details><summary>More options</summary>
        <label>Remind me when below<input type="number" min="0" max="1000000000" step="any" required value={minimum} onChange={e => setMinimum(e.target.value)} aria-describedby="minimum-help" /></label>
        <p id="minimum-help" className="product-help">Amount in {product?.unit_name ?? setup.units.find(u => String(u.id) === unit)?.name ?? 'the selected unit'}. Zero means no low-supply reminder. This does not place an order.</p>
        <label className="product-check"><input type="checkbox" checked={Number(days) === -1} onChange={e => setDays(e.target.checked ? '-1' : '0')} />This product never becomes overdue</label>
        {Number(days) !== -1 && <label>Suggested days until due<input type="number" min="0" max="36500" step="1" required value={days} onChange={e => setDays(e.target.value)} aria-describedby="days-help" /></label>}
        <p id="days-help" className="product-help">For future additions only. Zero suggests the day it is added. Existing dates stay unchanged. Always follow the date on the package.</p>
      </details>
      {product && <p className="product-help">A name change also appears wherever this product is used, including recipes and shopping lists.</p>}
      <div className="product-actions"><button type="submit" disabled={exact || (!product && missingSetup) || ((matches.length > 0 || similarRequired) && !allowSimilar)}>Save product</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </fieldset>
  </form>
}

export default function Products({ embedded = false, initialName = '', onChoose, onCancel, onBusy }: {
  embedded?: boolean; initialName?: string; onChoose?: (product: ProductDetails) => void; onCancel?: () => void; onBusy?: (busy: boolean) => void
}) {
  const [catalog, setCatalog] = useState<ProductDetails[]>([])
  const [setup, setSetup] = useState<ProductSetup | null>(null)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<ProductDetails | null>(null)
  const [editor, setEditor] = useState<ProductDetails | 'new' | null>(embedded ? 'new' : null)
  const [busy, setBusy] = useState(true)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [conflict, setConflict] = useState<ProductRequestError | null>(null)
  const [confirmed, setConfirmed] = useState<ProductDetails | null>(null)
  const pending = useRef(false)
  const active = useRef(true)
  const load = useCallback(async (keepEditor = false) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      const [products, options] = await Promise.all([getProductCatalog(), getProductSetup()])
      if (active.current) { setCatalog(products); setSetup(options); setLocked(false); setConflict(null); setDetail(null); setConfirmed(null); if (!keepEditor) setEditor(null) }
    } catch {
      if (active.current) { setError('Products could not be loaded. Refresh products to try again.'); setLocked(true) }
    } finally { pending.current = false; if (active.current) setBusy(false) }
  }, [])
  useEffect(() => {
    active.current = true
    const timer = setTimeout(() => void load(true), 0)
    return () => { clearTimeout(timer); active.current = false }
  }, [load])
  async function choose(product: ProductDetails) {
    if (pending.current || locked) return
    pending.current = true; setBusy(true); onBusy?.(true); setError('')
    try {
      const current = await getProductDetails(product.id)
      if (active.current) {
        if (embedded && current.active && onChoose) onChoose(current)
        else { setDetail(current); setEditor(null); setConflict(null) }
      }
    } catch {
      if (active.current) { setError('This product could not be loaded. Refresh products to try again.'); setLocked(true) }
    } finally { pending.current = false; if (active.current) { setBusy(false); onBusy?.(false) } }
  }
  async function save(fields: NewProduct | ProductFields) {
    if (pending.current || locked || !editor) return
    pending.current = true; setBusy(true); onBusy?.(true); setError(''); setStatus(''); setConflict(null)
    try {
      const saved = editor === 'new' ? await createProduct(fields as NewProduct) : await editProduct(editor.id, editor.version, fields)
      // Both the write response and catalog reload must succeed before offering another write.
      const products = await getProductCatalog()
      if (active.current) { setCatalog(products); setDetail(saved); setEditor(null); setConfirmed(saved); setStatus('Product saved. Nothing was added to your cupboards or shopping list.') }
    } catch (e) {
      if (active.current) {
        const failure = e instanceof ProductRequestError ? e : new ProductRequestError('Unable to confirm your change. Refresh products before saving again.')
        setError(failure.message); setConflict(failure)
        if (!['duplicate', 'similar', 'validation', 'configuration'].includes(failure.code)) setLocked(true)
      }
    } finally { pending.current = false; if (active.current) { setBusy(false); onBusy?.(false) } }
  }
  const disabled = busy || locked
  const content = <>
    <div className="product-actions">{!busy && <button disabled={busy} onClick={() => void load()}>Refresh products</button>}{(!embedded || (!editor && !detail)) && <button disabled={disabled} onClick={() => { setEditor('new'); setDetail(null); setConfirmed(null); setError(''); setConflict(null) }}>Add a product</button>}{embedded && <button disabled={busy} onClick={onCancel}>Back to grocery list</button>}</div>
    <p role="status" className="product-status">{busy ? 'Loading or saving products...' : status}</p>
    {error && <div role="alert" className="message error">{error}{locked && <p>Saving is paused until Refresh products succeeds. Review the current list before trying again.</p>}</div>}
    {conflict?.matches.length ? <aside aria-label="Products to review"><p>Review these existing products:</p><ul>{conflict.matches.map(match => <li key={match.id}><button disabled={disabled} onClick={() => { const p = catalog.find(p => p.id === match.id); if (p) choose(p) }}>Open {match.name}</button></li>)}</ul>{conflict.code === 'similar' && <p>If yours is different, confirm below that yours is a different product.</p>}</aside> : null}
    {setup && editor && <ProductForm key={editor === 'new' ? 'new' : editor.id} product={editor === 'new' ? null : editor} initialName={initialName} setup={setup} catalog={catalog} disabled={disabled} similarRequired={conflict?.code === 'similar'} onSave={fields => void save(fields)} onCancel={() => { setEditor(null); setError(''); setConflict(null) }} onChoose={choose} />}
    {detail && !editor && <section className="card product-detail" aria-label="Product details"><h2>{detail.name}</h2><p>Usually kept in: {detail.location_name ?? 'Place unavailable'}</p><p>Count or measure in: {detail.unit_name ?? 'Unit unavailable'}</p><p>Usually bought in: {detail.purchase_unit_name ?? 'Unit unavailable'}</p><p>Low-supply reminder: {detail.min_stock_amount} {detail.unit_name}</p><p>Suggested best-before days: {detail.default_best_before_days}</p>{!detail.active && <p>This product is inactive. It can be reviewed here but cannot be selected for groceries.</p>}<div className="product-actions"><button disabled={disabled} onClick={() => { setEditor(detail); setConfirmed(null); setError(''); setConflict(null) }}>Edit product</button>{embedded && detail.active && <button disabled={disabled} onClick={() => onChoose?.(detail)}>{confirmed ? 'Continue with this product' : 'Use this product'}</button>}</div></section>}
    <section className="card product-browser" aria-label="Browse products"><h2>Find a product</h2><label>Search products<input type="search" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} /></label>
      <ul>{catalog.filter(p => key(p.name).includes(key(query))).map(p => <li key={p.id}><button disabled={disabled} onClick={() => choose(p)}><strong>{p.name}</strong><span>{p.location_name ?? 'Place unavailable'} / {p.unit_name ?? 'Unit unavailable'}{!p.active ? ' / inactive' : ''}</span></button></li>)}</ul>
      {!busy && !locked && !catalog.some(p => key(p.name).includes(key(query))) && <p>No products found. Choose Add a product to save a new one.</p>}
    </section>
  </>
  if (embedded) return <section className="product-page embedded-products" aria-label="Create or choose a product">{content}</section>
  return <main className="product-page"><header><a className="brand" href="#">grocy<span> / products</span></a></header><nav>{busy ? <span>Loading or saving...</span> : <a href="#">Back to dashboard</a>}</nav><div className="intro"><p className="eyebrow">MAKE IT FAMILIAR</p><h1>Your products.</h1><p>Save the things your household uses, and where you keep them.</p></div>{content}</main>
}
