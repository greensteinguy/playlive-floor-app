// Lightweight toast system. No library dep.
//
// Usage:
//   const toast = useToast()      // from './useToast'
//   toast.success('Deposit recorded')
//   toast.error('Insufficient balance')
//   toast.info('Mock mode active')
//
// Each toast auto-dismisses after `duration` ms (default 4000). Multiple toasts
// stack bottom-right. Manual dismiss via the × on each.
//
// Why DIY: only success / error / info, no animation budget needed yet, and we
// avoid pulling in another transitive dep on top of firebase + zod + react-router.
// Swap for sonner / react-hot-toast later if requirements grow.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ToastContext } from './ToastContext'

let nextId = 1
const newId = () => `toast-${nextId++}`

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((curr) => curr.filter((t) => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (variant, message, { duration = 4000 } = {}) => {
      const id = newId()
      setToasts((curr) => [...curr, { id, variant, message }])
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, handle)
      }
      return id
    },
    [dismiss]
  )

  // Cleanup any pending timers on unmount.
  useEffect(() => {
    const timersMap = timers.current
    return () => {
      for (const handle of timersMap.values()) clearTimeout(handle)
      timersMap.clear()
    }
  }, [])

  const value = {
    success: (msg, opts) => push('success', msg, opts),
    error:   (msg, opts) => push('error',   msg, opts),
    info:    (msg, opts) => push('info',    msg, opts),
    dismiss,
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

const VARIANT_CLASSES = {
  success: 'glass border-l-2 border-l-emerald-400 text-emerald-100',
  error:   'glass border-l-2 border-l-brand-500 text-brand-100',
  info:    'glass border-l-2 border-l-white/50 text-white/90',
}

function ToastViewport({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl text-sm ${
            VARIANT_CLASSES[t.variant] ?? VARIANT_CLASSES.info
          }`}
        >
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="text-white/40 hover:text-white text-base leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
