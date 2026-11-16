import { useCallback, useEffect, useRef, useState } from 'react'
import ProductForm from './ProductForm'
import { key } from './productNames'
import { createProduct, editProduct, getProductCatalog, getProductDetails, getProductSetup, ProductRequestError } from './api'
import type { NewProduct, ProductDetails, ProductFields, ProductSetup } from './api'
import './Products.css'



export default function Products({ embedded = false, initialName = '', onChoose, onCancel, onBusy, onSaved, revision = 0 }: {
  embedded?: boolean; initialName?: string; onChoose?: (product: ProductDetails) => void; onCancel?: () => void; onBusy?: (busy: boolean) => void; onSaved?: (product: ProductDetails) => void; revision?: number
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
  const confirmation = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (confirmed) confirmation.current?.focus() }, [confirmed])
  const pending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    if (!revision) return
    const controller = new AbortController()
    getProductCatalog(controller.signal).then(setCatalog).catch(() => {
      if (!controller.signal.aborted) setError('Products could not be refreshed. Refresh products to try again.')
    })
    return () => controller.abort()
  }, [revision])
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
      if (active.current) { setCatalog(products); setDetail(saved); setEditor(null); setConfirmed(saved); onSaved?.(saved); setStatus('Product saved. Nothing was added to your cupboards or shopping list.') }
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
    {(!embedded || locked || !setup || detail) && <div className="product-actions">{!busy && (!embedded || locked) && <button onClick={() => void load(embedded)}>Refresh products</button>}{embedded && <button disabled={busy && Boolean(setup)} onClick={onCancel}>Return to previous screen</button>}</div>}
    <p role="status" className="product-status">{busy ? 'Loading or saving products...' : status}</p>
    {error && <div role="alert" className="message error">{error}{locked && <p>Saving is paused until Refresh products succeeds. Review the current list before trying again.</p>}</div>}
    {conflict?.matches.length ? <aside aria-label="Products to review"><p>Review these existing products:</p><ul>{conflict.matches.map(match => <li key={match.id}><button disabled={disabled} onClick={() => { const p = catalog.find(p => p.id === match.id); if (p) choose(p) }}>Open {match.name}</button></li>)}</ul>{conflict.code === 'similar' && <p>If yours is different, confirm below that yours is a different product.</p>}</aside> : null}
    {setup && editor && <ProductForm key={editor === 'new' ? 'new' : editor.id} product={editor === 'new' ? null : editor} initialName={initialName} setup={setup} catalog={catalog} disabled={disabled} similarRequired={conflict?.code === 'similar'} onSave={fields => void save(fields)} onCancel={() => { if (embedded) onCancel?.(); else setEditor(null); setError(''); setConflict(null) }} onChoose={choose} />}
    {detail && !editor && <section className="card product-detail" aria-label="Product details"><h2 ref={confirmation} tabIndex={-1}>{detail.name}</h2><p>Usually kept in: {detail.location_name ?? 'Place unavailable'}</p><p>Count or measure in: {detail.unit_name ?? 'Unit unavailable'}</p><p>Usually bought in: {detail.purchase_unit_name ?? 'Unit unavailable'}</p><p>Low-supply reminder: {detail.min_stock_amount} {detail.unit_name}</p><p>Suggested best-before days: {detail.default_best_before_days}</p>{!detail.active && <p>This product is inactive. It can be reviewed here but cannot be selected for groceries.</p>}<div className="product-actions"><button hidden={embedded} disabled={disabled} onClick={() => { setEditor(detail); setConfirmed(null); setError(''); setConflict(null) }}>Edit product</button>{embedded && detail.active && <button disabled={disabled} onClick={() => onChoose?.(detail)}>{confirmed ? 'Continue with this product' : 'Use this product'}</button>}</div></section>}
    {!embedded && <section className="card product-browser" aria-label="Browse products"><h2>Find a product</h2><label>Search products<input type="search" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} /></label>
      <ul>{catalog.filter(p => key(p.name).includes(key(query))).map(p => <li key={p.id}><button disabled={disabled} onClick={() => choose(p)}><strong>{p.name}</strong><span>{p.location_name ?? 'Place unavailable'} / {p.unit_name ?? 'Unit unavailable'}{!p.active ? ' / inactive' : ''}</span></button></li>)}</ul>
      {!busy && !locked && !catalog.some(p => key(p.name).includes(key(query))) && <p>No products found. Choose Add product to save a new one.</p>}
    </section>}
  </>
  if (embedded) return <section className="product-page embedded-products" aria-label="Create or choose a product">{content}</section>
  return <main tabIndex={-1} className="product-page"><div className="intro"><p className="eyebrow">MAKE IT FAMILIAR</p><h1 tabIndex={-1}>Your products.</h1><p>Save the things your household uses, and where you keep them.</p></div>{content}</main>
}
