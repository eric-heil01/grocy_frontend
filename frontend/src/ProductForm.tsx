import { useState } from 'react'
import type { FormEvent } from 'react'
import type { NewProduct, ProductDetails, ProductFields, ProductSetup } from './api'

import { key } from './productNames'

export default function ProductForm({ product, initialName, setup, catalog, disabled, similarRequired, onSave, onCancel, onChoose }: {
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

