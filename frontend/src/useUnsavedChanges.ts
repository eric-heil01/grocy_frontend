import { useEffect } from 'react'

// In-app navigation keeps drafts mounted. A browser reload or close needs a warning.
export default function useUnsavedChanges(dirty: boolean | (() => boolean)) {
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (typeof dirty === 'function' && !dirty()) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
