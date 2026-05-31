// Pure form helpers shared by the player quick-create form (task 3.3) and the
// profile-edit tab on the player detail page (task 3.1). The fields component
// itself lives in src/components/PlayerProfileFields.jsx; the data + mapping live
// here so the .jsx file stays Fast-Refresh-clean (a .jsx exporting non-component
// values trips react-refresh/only-export-components — same split as
// StatusBadge.jsx ↔ tournamentStatus.js).
//
// Form values are plain strings (matching FormFields). The domain ops
// (createPlayer / updatePlayer) trim required fields and collapse '' → null on
// the optionals, so these builders pass values straight through; validatePlayerForm
// surfaces friendly UI errors before the op runs.

// Curated ISO 3166-1 alpha-2 options so the Select can't produce an invalid code
// (CountryCode is exactly two uppercase letters). '' → no country (null).
export const COUNTRY_OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'AU', label: 'Australia (AU)' },
  { value: 'NZ', label: 'New Zealand (NZ)' },
  { value: 'GB', label: 'United Kingdom (GB)' },
  { value: 'US', label: 'United States (US)' },
  { value: 'CN', label: 'China (CN)' },
  { value: 'IN', label: 'India (IN)' },
  { value: 'VN', label: 'Vietnam (VN)' },
  { value: 'MY', label: 'Malaysia (MY)' },
  { value: 'SG', label: 'Singapore (SG)' },
  { value: 'ID', label: 'Indonesia (ID)' },
  { value: 'PH', label: 'Philippines (PH)' },
  { value: 'KR', label: 'South Korea (KR)' },
  { value: 'JP', label: 'Japan (JP)' },
]

/** Blank form for the quick-create page. */
export function emptyPlayerForm() {
  return {
    firstName: '',
    lastName: '',
    displayName: '',
    phone: '',
    email: '',
    streetAddress: '',
    countryCode: '',
  }
}

/** Player doc → string-keyed form state for the profile-edit tab. */
export function playerFormFromDoc(p) {
  return {
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    displayName: p.displayName ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    streetAddress: p.streetAddress ?? '',
    countryCode: p.countryCode ?? '',
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Returns a human-readable error string, or null when the form is valid. */
export function validatePlayerForm(form) {
  if (!form.firstName.trim()) return 'First name is required.'
  if (!form.lastName.trim()) return 'Last name is required.'
  if (!form.phone.trim()) return 'Phone number is required.'
  const email = form.email.trim()
  if (email && !EMAIL_RE.test(email)) return 'That email address looks invalid.'
  return null
}

/** Form → createPlayer args (the op trims + nulls; we pass raw strings). */
export function buildPlayerArgs(form) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    displayName: form.displayName,
    phone: form.phone,
    email: form.email,
    streetAddress: form.streetAddress,
    countryCode: form.countryCode,
  }
}

/**
 * Form → updatePlayer patch. Required fields are trimmed (they must be non-empty
 * NonEmptyStrings); the op normalizes '' → null on the nullable optionals.
 */
export function buildPlayerPatch(form) {
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    displayName: form.displayName,
    phone: form.phone.trim(),
    email: form.email,
    streetAddress: form.streetAddress,
    countryCode: form.countryCode,
  }
}
