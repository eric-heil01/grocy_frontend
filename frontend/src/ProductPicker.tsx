import { useEffect, useId, useRef, useState } from 'react'
import type { Ref } from 'react'
import { searchProducts } from './api'
import type { ProductOption } from './api'
import { ProductCreationDialog } from './ProductCreationDialog'
import Icon from './Icon'
import './ProductPicker.css'

type Props = {
  query: string; product: ProductOption | null; onChange: (query: string, product: ProductOption | null) => void
  disabled: boolean; revision: number; onCreated: () => void; onBusy?: (busy: boolean) => void
  onAfterCreate?: () => void; inputRef?: Ref<HTMLInputElement>
}

export default function ProductPicker({ query, product, onChange, disabled, revision, onCreated, onBusy, onAfterCreate, inputRef }: Props) {
  const id = useId()
  const [creating, setCreating] = useState(false)
  const [results, setResults] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(Boolean(query && !product))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const afterCreate = useRef(false)
  useEffect(() => {
    if (!creating && afterCreate.current) { onAfterCreate?.(); afterCreate.current = false }
  }, [creating, onAfterCreate])
  useEffect(() => {
    if (product || !query.trim()) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true); setError('')
      searchProducts(query.trim(), controller.signal).then(setResults).catch(() => {
        if (!controller.signal.aborted) setError('Product search is unavailable. Change the search to try again.')
      }).finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, product, revision])
  return <div className="product-search shared-product-picker">
    <label htmlFor={id}>Find a product</label>
    <input ref={inputRef} id={id} type="search" value={query} disabled={disabled} maxLength={100} autoComplete="off" aria-describedby={`${id}-help`} onChange={event => {
      onChange(event.target.value, null); setResults([]); setError(''); setNotice(''); setSearching(Boolean(event.target.value.trim()))
    }} />
    <small id={`${id}-help`}>Search by name, then select a result.</small>
    {query.trim() && !product && searching && <p role="status">Searching products...</p>}
    {error && <p role="alert">{error}</p>}
    {!product && results.length > 0 && <ul className="search-results" aria-label="Product results">{results.map(result => <li key={result.id}><button disabled={disabled} type="button" onClick={() => { onChange(result.name, result); setResults([]); setSearching(false) }}>{result.name}<small>{result.unit_name ?? 'Unit unavailable'}</small></button></li>)}</ul>}
    {!product && query.trim() && !searching && !error && results.length === 0 && <p className="muted">No matching products. Create a new product below or try another name.</p>}
    <button className="create-product-link" disabled={disabled} type="button" onClick={() => { setNotice(''); setCreating(true) }}><Icon name="plus" />Create new product</button>
    {product && <p className="selected-product">Selected: <strong>{product.name}</strong></p>}
    {notice && <p className="product-created" role="status">{notice}</p>}
    {creating && <ProductCreationDialog initialName={query.trim()} onBusy={onBusy} onCancel={() => setCreating(false)} onChoose={(selected, saved) => {
      onChange(selected.name, { id: selected.id, name: selected.name, unit_id: selected.unit_id, unit_name: selected.unit_name })
      setResults([]); setSearching(false); setError(''); setCreating(false)
      setNotice(saved ? `Product saved: ${selected.name}. Ready to use.` : `${selected.name} selected.`)
      afterCreate.current = true
      if (saved) onCreated()
    }} />}
  </div>
}
