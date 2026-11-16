import { useEffect, useRef } from 'react'
import type { ProductDetails } from './api'
import Products from './Products'

export function ProductCreationDialog({ initialName = '', onCancel, onChoose, onBusy }: {
  initialName?: string; onCancel: () => void; onChoose: (product: ProductDetails) => void; onBusy?: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)
  const saved = useRef<ProductDetails | null>(null)
  const close = () => saved.current ? onChoose(saved.current) : onCancel()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    return () => { element.close(); previous?.focus() }
  }, [])
  return <dialog ref={dialog} className="creation-dialog" aria-labelledby="creation-title" onCancel={event => { event.preventDefault(); if (!saving.current) close() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]')].filter(element => !element.matches(':disabled') && element.getClientRects().length > 0)
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus() }
  }}>
    <h2 id="creation-title">Add product</h2>
    <Products embedded initialName={initialName} onCancel={close} onChoose={onChoose} onSaved={product => { saved.current = product }} onBusy={busy => { saving.current = busy; onBusy?.(busy) }} />
  </dialog>
}

