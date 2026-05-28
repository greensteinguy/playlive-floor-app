// Convenience hook for accessing the toast context.
//
// Usage:
//   const toast = useToast()
//   toast.success('Deposit recorded')
//   toast.error('Insufficient balance')
//   toast.info('Mock mode active')

import { useContext } from 'react'
import { ToastContext } from './ToastContext'

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be called inside <ToastProvider>')
  }
  return ctx
}
