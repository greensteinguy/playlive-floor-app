// The shared player-profile field set, used by both the quick-create form
// (task 3.3) and the profile-edit tab on the player detail page (task 3.1).
// Controlled over a string-keyed form object; the parent owns state + save. Pure
// presentation — mapping/validation live in src/lib/playerForm.js.

import { Section, Text, Select } from './FormFields'
import { COUNTRY_OPTIONS } from '../lib/playerForm'

export default function PlayerProfileFields({ form, set, disabled }) {
  return (
    <>
      <Section title="Name">
        <Text label="First name" value={form.firstName} onChange={(v) => set({ firstName: v })} placeholder="Jane" disabled={disabled} />
        <Text label="Last name" value={form.lastName} onChange={(v) => set({ lastName: v })} placeholder="Doe" disabled={disabled} />
        <Text label="Display name (optional)" value={form.displayName} onChange={(v) => set({ displayName: v })} placeholder='Overrides "First Last"' disabled={disabled} />
      </Section>

      <Section title="Contact">
        <Text label="Phone" value={form.phone} onChange={(v) => set({ phone: v })} placeholder="0400 123 456" disabled={disabled} inputMode="tel" />
        <Text label="Email (optional)" value={form.email} onChange={(v) => set({ email: v })} placeholder="jane@example.com" disabled={disabled} inputMode="email" />
        <Text label="Street address (optional)" value={form.streetAddress} onChange={(v) => set({ streetAddress: v })} placeholder="1 Example St, Melbourne" disabled={disabled} />
        <Select label="Country (optional)" value={form.countryCode} onChange={(v) => set({ countryCode: v })} options={COUNTRY_OPTIONS} disabled={disabled} />
      </Section>
    </>
  )
}
