# Venue display v2 — design notes

Source: Guy's like/dislike pass over researched poker-clock design patterns
(Tournament Director, Blind Valet, WSOP/casino floor boards), 10 Aug 2026.
These notes drive the `feature/display-v2` work on `/display`.

## Direction

Keep the *identity* of the v1 display — dark, red-accented, giant digits,
crossfading slide rotation — but **use the whole screen** (Guy's overriding
note: the v1 single centered stack wasted the sides). The clock slide is a
**three-zone layout** in the Tournament Director tradition, which Guy did NOT
dislike (only the top/bottom broadcast bands and the half/half split screen):

- **Left rail — the game:** buy-in, starting stack, level length, next level,
  next break countdown, late-reg status.
- **Center — the hero:** level, blinds, ante, giant countdown, progress bar,
  level track, player counters. Still the dominant zone.
- **Right rail — the money:** prize pool, guarantee, payout ladder.

On top of the layout, add **stage-awareness** (the display tells the right
story for the current moment of the tournament) and **peripheral richness**
(ticker, level track, pulses).

## Keep as-is

- Dark minimal look, red brand accents, giant countdown digits + thin progress bar
- Crossfading slide rotation (clock ↔ prizes), counter strip, time of day

## Additions

**Timer zone**
- Segmented level track: one block per level until the next break, filled as
  levels complete. Answers "how long until the break?" at a glance.
- Final-minute state: countdown digits and bar shift to warning red under 1:00.
- Level-change pulse: brief animation on the blinds row when the level rolls.

**Break mode**
- Breaks get a distinct full-screen look (cool/sky tone shift): BREAK hero,
  "back at H:MM" wall-clock line, next level preview. Color-up notices live
  here only (never a permanent element — Guy disliked that).

**Bottom ticker strip**
- Scrolling strip on every slide: payouts once the pool is real, guarantee,
  late-reg/buy-in info. This is the "payouts visible on the clock screen"
  mechanism, so the hero never gives up space. Hidden when it has nothing to say.

**Stage-aware content**
- While late reg is open: "late reg closes in MM:SS (end of level N)" plus
  buy-in & starting-stack info — shown when players entering need it.
- Once reg closes: that slot swaps to "paying N places" / payout emphasis.
- Counter strip gains total chips in play.
- Prizes slide drops out of rotation while the prize pool is $0 (early doors),
  unless a dedicated TV pins `?screen=prizes`.

## Explicitly out (disliked)

- Top/bottom broadcast bands; half/half split screen (clock left, payouts right)
- Progress ring around the countdown
- Everything-at-once dense static layout
- Permanent chip color-up notices

(First draft of these notes wrongly listed the three-panel grid as out — Guy
never downvoted it, and after seeing the centered-stack v2 draft he explicitly
asked for the screen real estate to be used. The three-zone layout above is
the correction.)

## Degrade gracefully

Every new element disappears rather than leaving a gap: ticker hides with no
content, reg slot vanishes after close, level track hides when the structure
slice has no upcoming break context.
