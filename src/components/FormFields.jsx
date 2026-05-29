// Shared form primitives for the tournament-config forms (template editor and
// the tournament create/edit form). Dumb controlled inputs over string values;
// money/number conversion lives in src/lib/money.js and happens at the
// form/storage boundary, not here.

export function Section({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-felt-800 border border-white/5 rounded-lg p-4">
        {children}
      </div>
    </section>
  )
}

function fieldLabel(label) {
  return <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">{label}</span>
}

export function Text({ label, value, onChange, placeholder, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      {fieldLabel(label)}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
      />
    </label>
  )
}

export function Money({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      {fieldLabel(label)}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          disabled={disabled}
          className="w-full bg-felt-900 border border-white/10 rounded pl-6 pr-3 py-2 text-sm disabled:opacity-50"
        />
      </div>
    </label>
  )
}

export function Num({ label, value, onChange, disabled, allowEmpty = false }) {
  return (
    <label className="flex flex-col gap-1">
      {fieldLabel(label)}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={allowEmpty ? 'unlimited' : '0'}
        disabled={disabled}
        className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
      />
    </label>
  )
}

export function DateTime({ label, value, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      {fieldLabel(label)}
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50 [color-scheme:dark]"
      />
    </label>
  )
}

export function Select({ label, value, onChange, options, disabled }) {
  return (
    <label className="flex flex-col gap-1">
      {fieldLabel(label)}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-felt-900 border border-white/10 rounded px-3 py-2 text-sm disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Toggle({ label, checked, onChange, disabled, hint }) {
  return (
    <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="accent-gold-500" />
      {label}
      {hint && <span className="text-[10px] text-white/30">({hint})</span>}
    </label>
  )
}

export function BountyValues({ values, onChange, disabled }) {
  const setAt = (i, v) => onChange(values.map((x, idx) => (idx === i ? v : x)))
  const add = () => onChange([...values, ''])
  const removeAt = (i) => onChange(values.filter((_, idx) => idx !== i))
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {fieldLabel('Bounty values (at least one)')}
        <button type="button" onClick={add} disabled={disabled} className="px-2 py-1 rounded text-[11px] bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-40">
          + Add value
        </button>
      </div>
      {values.length === 0 ? (
        <p className="text-xs text-white/40">Add at least one bounty value.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <div key={i} className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={v}
                onChange={(e) => setAt(i, e.target.value)}
                placeholder="0.00"
                disabled={disabled}
                className="w-28 bg-felt-900 border border-white/10 rounded pl-5 pr-6 py-1.5 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label="Remove value"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-white/30 hover:text-red-300 text-sm"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function EmptyState({ title, body, tone = 'neutral' }) {
  const border = tone === 'error' ? 'border-red-500/30' : 'border-white/5'
  return (
    <div className={`bg-felt-800 border ${border} rounded-lg p-8 text-center`}>
      <div className="font-display text-lg text-white mb-1">{title}</div>
      {body && <p className="text-sm text-white/50 max-w-md mx-auto">{body}</p>}
    </div>
  )
}
