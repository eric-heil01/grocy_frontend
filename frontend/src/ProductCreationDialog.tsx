import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ProductDetails } from './api'
import Products from './Products'

export function ProductCreationDialog({ initialName = '', onCancel, onChoose, onBusy }: {
  initialName?: string; onCancel: () => void; onChoose: (product: ProductDetails, created: boolean) => void; onBusy?: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    if (!element.open) element.showModal()
    return () => { element.close(); previous?.focus() }
  }, [])
  return createPortal(<dialog onSubmit={event => event.stopPropagation()} ref={dialog} className="creation-dialog" aria-labelledby="creation-title" aria-describedby="creation-description" onCancel={event => { event.preventDefault(); if (!saving.current) onCancel() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]')].filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus() }
  }}>
    <div className="dialog-heading"><h2 id="creation-title">Add product</h2></div>
    <p className="dialog-description" id="creation-description">Save something your household uses. You can add it to a shopping list separately.</p>
    <Products embedded initialName={initialName} onCancel={onCancel} onChoose={product => onChoose(product, false)} onSaved={product => onChoose(product, true)} onBusy={busy => { saving.current = busy; onBusy?.(busy) }} />
  </dialog>, document.body)
}

