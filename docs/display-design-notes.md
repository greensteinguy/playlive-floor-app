# Venue display v2 — design notes

Source: Guy's like/dislike pass over researched poker-clock design patterns
(Tournament Director, Blind Valet, WSOP/casino floor boards), 10 Aug 2026.
These notes drive the `feature/display-v2` work on `/display`.

## Direction

Keep the *identity* of the v1 display — dark, red-accented, giant digits, one
centered hero column, crossfading slide rotation. The complaint was that it is
static and sparse, not that it is minimal. Fix it by adding **stage-awareness**
(the display tells the right story for the current moment of the tournament)
and **peripheral richness** (ticker, level track, pulses) around the hero,
never by crowding the screen with permanent panels.

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

- Side panels (three-panel grid, split screen), top/bottom broadcast bands
- Progress ring around the countdown
- Everything-at-once dense static layout
- Permanent chip color-up notices

## Degrade gracefully

Every new element disappears rather than leaving a gap: ticker hides with no
content, reg slot vanishes after close, level track hides when the structure
slice has no upcoming break context.
