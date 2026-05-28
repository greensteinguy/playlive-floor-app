// Just the context object + constants. Kept in a plain .js file (no JSX)
// so React Fast Refresh doesn't reject it for mixing component and
// non-component exports. The AuthProvider component lives in AuthProvider.jsx;
// the useAuth() hook lives in useAuth.js.

import { createContext } from 'react'

export const VALID_ROLES = ['manager', 'td', 'cashier', 'readonly']

export const AuthContext = createContext(null)
