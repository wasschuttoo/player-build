---
name: Build Album
description: A dark screening room hung with lit title cards. The player card is the poster on the wall, its builds hang beside it in a row, and one amber light marks whatever is chosen.
colors:
  bg: "#0B0E13"
  surface: "#151922"
  elevated: "#1F2430"
  line: "#262C38"
  line-2: "#3A4150"
  text: "#E6E6E8"
  text-2: "#A4A9B3"
  dim: "#6B7280"
  amber: "#FFC857"
  amber-hi: "#FFD67F"
  amber-ink: "#14100A"
  amber-soft: "#FFC8571A"
  amber-wash: "#312E28"
  amber-wash-2: "#3A3835"
  red: "#FF6B6B"
  red-ink: "#1A0606"
  green: "#5FD49A"
  build-1: "#6CB8FF"
  build-2: "#B69CFF"
  build-3: "#FF8FC7"
  pitch: "#0F1714"
  shade: "#000000"
typography:
  scale:
    tag: "0.6875rem"
    label: "0.75rem"
    small: "0.8125rem"
    note: "0.875rem"
    body: "0.9375rem"
    field: "1rem"
    row: "1.125rem"
    name: "1.25rem"
    numeral: "1.375rem"
    title: "1.5rem"
    sheet: "1.75rem"
    ladder: "2rem"
    build: "2.25rem"
    player: "3rem"
    average: "4rem"
    display: "4.5rem"
    hero: "6rem"
  display:
    fontFamily: "Big Shoulders Display, Impact, Arial Narrow, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Big Shoulders Display, Impact, Arial Narrow, sans-serif"
    fontSize: "clamp(1.75rem, 5vw, 2.25rem)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Big Shoulders Display, Impact, Arial Narrow, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "0.02em"
  numeral:
    fontFamily: "Big Shoulders Display, Impact, Arial Narrow, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 900
    lineHeight: 1
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  button:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  tick: "1px"
  hairline: "2px"
  track: "3px"
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  rail: "232px"
  tabbar: "64px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-primary-in-use:
    backgroundColor: "transparent"
    textColor: "{colors.amber}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "44px"
  playstyle-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px"
    height: "64px"
  playstyle-tile-selected:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.md}"
    padding: "12px"
    height: "64px"
  title-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  build-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "8px 16px 16px"
  build-card-selected:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "8px 16px 16px"
  slot-numeral:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text}"
    typography: "{typography.numeral}"
    rounded: "{rounded.sm}"
    height: "52px"
  tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    height: "64px"
  tag:
    backgroundColor: "transparent"
    textColor: "{colors.amber}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  pitch-mini:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 7px 7px"
    width: "clamp(60px, 18%, 84px)"
  sheet:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  toast:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# Design System: Build Album

## 1. Overview

**Creative North Star: "The Screening Room Wall"**

Build Album is a dark screening room. The house lights are down, the walls are near-black, and the things worth looking at hang on them as lit title cards: the player card is the poster, the three builds are the next cards along the row, and the squad is a pitch-shaped board of small cards. Nothing glows except what matters. One warm amber light falls on the chosen thing (the selected build, the pressed position, the current manager, the number you came for), and everything else waits in the dark until it is picked.

The wall reads like a streaming catalog: rows of cards you scan sideways, a focused card that grows to show its detail, and a fixed rail of places to go. It is a tool first. Every card carries real numbers, tap targets are generous, and the room never asks you to admire it before you can use it.

**Key Characteristics:**
- Near-black screening-room ground with a 5% film grain over everything.
- Big Shoulders Display for every numeral and title; Archivo for everything you read.
- One accent, amber, and it only ever means "chosen" or "the number that matters".
- Flat cards on hairline borders; only the hero player card is lit and lifted.
- Phone-first: bottom tab bar and side-scrolling rows on phones, a fixed left rail on desktop.

## 2. Colors

A cool, dark, low-chroma room with a single warm light source.

### Primary
- **Projector Amber** (#FFC857): the one light. Selected states, the player's OVR, the XI average, the active tab, the focus ring, primary buttons. **Amber Highlight** (#FFD67F) is its hover step. Text on amber is **Amber Ink** (#14100A).
- **Amber Glow** (#FFC857 at 10%): the floor wash under a selected tile, tab or manager row.
- **Amber Wash** (#312E28) and **Amber Wash Deep** (#3A3835): solid warm fills for the chased stat row in the stat table and the edge of the final step in the card-to-managed ladder.

### Neutral
- **Screening Room** (#0B0E13): page ground, sheets, the slider thumb ring.
- **Card Stock** (#151922): every card, field and the phone tab bar.
- **Raised Card** (#1F2430): slot numerals, pitch minis, toasts, counters, proficiency pills.
- **Hairline** (#262C38) and **Hairline Strong** (#3A4150): resting borders; the strong line marks interactive edges (buttons, fields, chips).
- **Screen White** (#E6E6E8): primary text, 15.5:1 on the ground.
- **Caption Grey** (#A4A9B3): secondary text and labels, 7.5:1 on Card Stock.
- **Dim** (#6B7280): a hover border on fields and nothing else.

### Status
- **Off-Side Red** (#FF6B6B): errors, a player out of position, a destructive action once armed (text on it is **Red Ink**, #1A0606). Resting danger borders use it at 45% alpha.
- **Go Green** (#5FD49A): success messages and the success toast edge only.
- **Night Pitch** (#0F1714): the squad pitch, the one green-tinted surface, kept almost black.
- **Shadow Black** (#000000): shadows only, at 35 to 75% alpha (lit card, card art lift, pitch mini lift). Never a fill, a border or text.

### Build identity
- **Build Sky** (#6CB8FF), **Build Violet** (#B69CFF) and **Build Rose** (#FF8FC7) name builds 1, 2 and 3. Each build carries its hue everywhere it appears: card edge, number badge, OVR and chase number, slot washes, its diff chips, its stat-table header chip and its whole stat column (7% tint, 16% when selected). Washes are `color-mix` of the hue into the surface they sit on, so the amber chase row still reads through a build column. Text on a filled build badge is Screening Room (#0B0E13).

**The Build Colours Are Names Rule.** Build hues identify which build a number belongs to; they never mean "chosen". Selection inside a build's own surfaces is shown by a stronger fill of that build's hue (filled badge, filled header chip, 16% column), never by swapping to amber. Amber keeps the stat buttons, the chase-stat row, the manager tag and every non-build selection.

**The Amber Marks the Chosen Rule.** Amber appears only on what is selected, active, focused, or the one number the screen exists to show. It never decorates, never fills an unselected control, and never appears twice at full strength in a way that competes for "chosen". If nothing is chosen, nothing is amber.

**The Dim Is Not Text Rule.** Dim measures 4.0:1 on the ground and 3.6:1 on Card Stock, so it never carries words. The quietest readable text is Caption Grey.

**The Status Is Not Selection Rule.** Red and green report outcomes; they never mark a choice. A selected item that is also an error keeps its red edge and loses no meaning to amber.

## 3. Typography

**Display Font:** Big Shoulders Display (with Impact, Arial Narrow)
**Body Font:** Archivo (with system-ui, Segoe UI)

Big Shoulders is the poster face: tall, condensed, heavy, set uppercase for words and tabular for numbers. Archivo is a sturdy grotesk that keeps controls, notes and tables legible at small sizes. Both are self-hosted and subset to Latin and Latin Extended.

### Hierarchy
- **Display** (900, 4.5rem, line-height 0.85; 6rem from 960px): the player's OVR on the title card, in amber. The XI average uses the same voice at 4rem.
- **Headline** (900, clamp(1.75rem, 5vw, 2.25rem), line-height 1): row headings on the wall and, at 1.75rem, sheet titles. The player name runs larger, clamp(2rem, 7vw, 3rem).
- **Title** (800, 1.5rem, line-height 1.1): state titles, card position, playstyle proficiency; steps down to 1.375rem for the brand on wide screens, 1.25rem for the manager name and 1.125rem for manager rows and diff keys.
- **Numeral** (900, 1.375rem, tabular; 1.5rem from 960px): the seven training-slot values and the pitch mini OVRs. Build OVRs step up to 2.25rem, ladder steps and the level readout to 2rem.
- **Body** (400, 0.9375rem, line-height 1.5): running text. Notes and metadata step down to 0.875rem and 0.8125rem.
- **Label** (600, 0.75rem, uppercase, 0.08em tracking): the one label voice for section labels, tab names and counters; 0.6875rem for tags and fact keys, and for slot keys and mini positions at 0.04em.
- **Button** (600, 0.8125rem, uppercase, 0.08em tracking): every button.
- **Field** (400, 1rem): text typed into fields, never smaller, so phones do not zoom on focus.

The full ramp is seventeen steps: 0.6875, 0.75, 0.8125, 0.875, 0.9375, 1, 1.125, 1.25, 1.375, 1.5, 1.75, 2, 2.25, 3, 4, 4.5 and 6rem. Nothing sets type between them. An empty XI average shows its dash at 2rem in Caption Grey.

**The Numerals Are Posters Rule.** Every number a player would read off the screen (OVR, slot points, level, averages) is Big Shoulders with tabular figures. Archivo never sets a headline number, and Big Shoulders never sets a sentence.

**The One Label Voice Rule.** Section labels, counters and tab names share one voice (Archivo 600, 0.75rem, uppercase, 0.08em, Caption Grey). Tags and tile names may tighten to 0.06em and slot keys to 0.04em, but nothing invents a new eyebrow style or a colored label outside a selected state.

## 4. Layout

The page is a wall of rows. On phones the brand rail sits at the top (56px) and the two views live in a bottom tab bar (64px, safe-area padded). Below 960px, rows that hold more than fit (Team Playstyles) scroll sideways with snap points at 44% card width, bleeding to the screen edge.

- **From 720px:** the rail becomes a 64px top bar with the view tabs inline beside the brand; page padding grows from 16px to 24px.
- **From 960px:** the album hero splits into the title card and a 320 to 400px control column; the squad splits into a sticky 300 to 360px side column and the pitch (max 520px).
- **From 1024px:** the rail moves to a fixed 232px left column with tabs stacked and actions pinned to the bottom; page padding becomes 32px and content caps at 1440px.
- **From 1280px:** the three builds hang side by side.

Spacing runs on a 4px base (4, 8, 12, 16, 24, 32, 48). Sections on the wall are 32px apart; cards inside a row are 8 to 12px apart.

**The Forty-Four Rule.** Every control is at least 44px tall or wide, including chips, tabs, links in card footers and the level stepper.

## 5. Elevation & Depth

The room is flat. Cards separate from the ground by tone (Card Stock on Screening Room) and a 1px hairline, not by shadow. A fixed 5% fractal-noise grain sits over the whole page as the film texture.

- **Lit card shadow** (0 16px 36px -12px black at 75%, plus 0 2px 6px black at 35%): the hero title card, sheets and toasts, the things that hang forward of the wall.
- **Title card sheen**: a soft radial light from the top-left (Raised Card fading to Card Stock by 62%) on the hero title card only.
- **Card art lift** (1px Hairline Strong ring plus 0 12px 32px black at 45%): the card image on the title card.
- **Pitch mini lift** (0 6px 18px black at 40%): placed minis on the pitch; empty and bench minis are flat.
- **Sheet backdrop**: near-black at 74%.

**The One Lit Card Rule.** Only one card on the wall gets the sheen and the deep shadow: the player you are building. Builds, manager rows and tiles stay flat; selection is shown with amber, never with lift.

## 6. Shapes

Small, firm corners; nothing soft or bubbly.

- **Small** (4px): slot numerals, tags, badges, the brand mark, build numbers.
- **Medium** (6px): buttons, fields, playstyle tiles, pitch minis, toasts.
- **Large** (10px): cards, panels, the pitch, sheets (top corners only on phones).
- **Pill** (999px): position chips and skill tags.
- **Circle**: the level stepper buttons and the slider thumb.
- **Hairline** (2px) and **Track** (3px): pitch markings, the active-tab indicator and the slider track.
- **Tick** (1px): the short diff mark under a training slot that changed.

**The No Soft Corners Rule.** No radius above 10px except pills and circles.

## 7. Components

### Buttons
Uppercase Archivo labels, 44px tall, 6px corners, color transitions only (0.2s).
- **Primary**: Projector Amber with Amber Ink text; hovers to Amber Highlight. When the action is already done ("In use") it turns into an amber outline with amber text and no fill.
- **Outline**: transparent with a Hairline Strong edge and Screen White text; hovers to an amber edge and amber text.
- **Round**: 44px circle outline for the level stepper.
- **Danger**: Off-Side Red text on a 45% red edge; once armed it fills red with Red Ink text.
- **Link**: Caption Grey underlined text, amber on hover; red once armed.

### Fields
Card Stock fill, Hairline Strong edge, 16px text so phones do not zoom. Hover darkens the edge to Dim; focus turns the edge amber with a 2px amber outline. The finder search carries a 20px line icon inset 12px; selects use a custom chevron.

### Position chips
Pills, 44px tall, set in Big Shoulders at 0.9375rem. Resting chips have a Hairline Strong edge; the selected chip fills amber with Amber Ink text. Positions the card cannot play are dashed and grey.

### Team Playstyle tiles
64px tiles with a name label and the manager's proficiency in Big Shoulders. Selected: amber edge, Amber Glow floor, amber name.

### Title card (the player poster)
The hero. Card art on the left (120 by 170px, 240 by 340px from 960px), amber OVR and position beside it, the name in large uppercase below, the card type as a quiet outlined tag, then the seven training slots. Lit with the sheen and the deep shadow. Facts, skills and links fold away behind a disclosure.

### Build cards
Flat cards with a numbered badge, title and big OVR, each in its build hue (Sky, Violet, Rose): a 40% hue edge, a tinted badge, and the OVR and chase number in the hue. Each carries a seven-numeral slot row. Selected: full-hue edge and 12% hue floor, the badge fills with the hue, and the slot numerals sit on a 16% hue wash with hue underlines where they differ from the other builds. The title card's slot row and the stat table follow the selected build's hue.

### Training slots
Seven equal Raised Card cells, 52px tall, with a small label key and a Big Shoulders value. Zero slots are hollow (hairline ring, grey value).

### Card-to-managed ladder
A row of small steps from card OVR to managed OVR; the last step is the destination, with an Amber Wash Deep edge, Amber Glow floor and amber numeral.

### Navigation
- **Phone tab bar**: Card Stock bar fixed to the bottom, two equal tabs with a 20px line icon over the label. Active: amber icon and label plus a 2px amber bar along the top edge.
- **Top bar (720px+) and left rail (1024px+)**: tabs sit inline as 40px rows with the icon beside the label, then stack 44px tall in the rail. Resting tabs have no edge; active gets an amber edge and Amber Glow.

### Squad pitch
A Night Pitch board (3:4) with faint stripes and hairline markings. Minis are small Raised Card cards with OVR, position and name; hover edges turn amber, off-position minis get a red edge and note, empty slots are dashed with a plus. The bench is a grid of flat minis.

### Rows, sheets and toasts
- **Manager and club rows**: flat cards; the current one has an amber edge, Amber Glow and an amber "Current" tag; missing ones are dashed.
- **Sheets**: bottom sheets on phones, centered 640px dialogs from 720px, with a sticky header and a segmented tab control.
- **Toasts**: Raised Card with the lit shadow, green or red edge by outcome.

### Motion
One authored motion: when a player card or pitch mini is placed it rises 10px and scales from 0.96 into place over 0.42s on the room's single easing, cubic-bezier(.16, 1, .3, 1). The loading spinner is the only other animation. Everything else is a 0.2s color, border or background transition. Reduced motion collapses transitions and the placement to 1ms and slows the spinner to 2.4s.

## 8. Do's and Don'ts

### Do:
- **Do** keep amber for the chosen thing and the number that matters, and check every new amber against that test.
- **Do** set every player-facing number in Big Shoulders with tabular figures.
- **Do** separate cards with tone and hairlines, and save lift for the hero title card and floating layers.
- **Do** keep every control at 44px or more and keep text at Caption Grey or brighter.
- **Do** let long rows scroll sideways on phones instead of wrapping into a pile.

### Don't:
- **Don't** bring back the matte sticker album: no paper whites, navy pages, sticker red or die-cut shadows.
- **Don't** add a second accent color or use red or green to mark selection. The three build identity hues are the one sanctioned exception, and only on build surfaces.
- **Don't** use Dim for text.
- **Don't** use gradient text, glass blur, eyebrow labels or colored side stripes thicker than 1px.
- **Don't** add motion beyond the placement and the spinner.
