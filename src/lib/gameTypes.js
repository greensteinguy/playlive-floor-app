// Game-type and re-entry option lists shared across the tournament-config forms
// and list/detail views. Single source of truth so the human-readable labels
// can't drift between, say, the template list and the tournament list.
//
// The `value`s must stay in sync with the GameType / reentryConfig.type enums in
// src/lib/schema/tournament.js.

export const GAME_TYPES = [
  { value: 'nlh', label: "No-Limit Hold'em" },
  { value: 'plo', label: 'Pot-Limit Omaha' },
  { value: 'plo5', label: 'PLO 5-card' },
  { value: 'omaha', label: 'Omaha' },
  { value: 'horse', label: 'HORSE' },
  { value: 'stud', label: 'Stud' },
  { value: 'mixed', label: 'Mixed game' },
  { value: 'mainEvent', label: 'Main Event' },
  { value: 'mysteryBounty', label: 'Mystery Bounty' },
  { value: 'satellite', label: 'Satellite' },
]

export const GAME_TYPE_LABEL = Object.fromEntries(GAME_TYPES.map((g) => [g.value, g.label]))

export const REENTRY_TYPES = [
  { value: 'freezeout', label: 'Freezeout' },
  { value: 'reentry', label: 'Re-entry' },
  { value: 'rebuy', label: 'Rebuy' },
]
