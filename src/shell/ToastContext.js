// Context object for the toast system. Kept in a plain .js file (no JSX)
// so React Fast Refresh doesn't reject the file for mixing component and
// non-component exports.

import { createContext } from 'react'

export const ToastContext = createContext(null)
