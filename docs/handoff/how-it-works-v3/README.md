# Handoff — "How it works" v3 (dark)

Branch: `ui/home-how-it-works-dark-teams-20260925`
Designed on canvas, verified at 1280 / 1000 / 390. Ready to wire in.

Reference renders: `preview-desktop.png`, `preview-mobile.png` (same folder).

---

## 1. What this replaces

The light `.qfp-how` section on the launch homepage — kicker, "Three steps.
Zero running around.", and the three `.qfp-step` cards.

Everything is new markup under a `.qfh-*` prefix. Nothing in the old
`.qfp-step*` CSS is reused, so once this is live those rules can be deleted
from `app/home-pune-launch.css` (they are not shared with any other section —
check `.qfp-step` usage before removing).

---

## 2. Files in this drop

| File | Goes to |
|---|---|
| `home-how-v3.css` | `app/home-how-v3.css` |
| `HowItWorksV3.tsx` | `components/home/HowItWorksV3.tsx` |

## 3. Wiring

1. Copy the two files to the paths above.
2. In `components/home/PuneLaunchHomepage.tsx`:
   - add `import HowItWorksV3 from "./HowItWorksV3";`
   - add `import "@/app/home-how-v3.css";` next to the existing
     `home-pune-launch.css` import (wherever that lives in this tree)
   - delete the whole `<section className="qfp-section qfp-how" id="how-it-works"> … </section>`
     block and put `<HowItWorksV3 />` in its place.
3. The old `how-step-1-d/m`, `how-step-2-d/m`, `how-step-3-d/m` image slots
   are no longer referenced. Leave the files in `public/` for now — deleting
   them is a separate call.

`HowItWorksV3` is a **server component** (it calls `optionalRealImage`, which
uses `fs`). Do not add `"use client"`.

---

## 4. Images

No new assets. The only photos are existing category images, resolved through
the documented slot helper:

```ts
optionalRealImage(`categories/${slug}-v2`)
```

Slugs used: `interior-designers`, `carpenters`, `painter`, `false-ceiling`,
`premium-interiors`. If a slot returns `null` the component renders the frame
without an `<img>` — deliberate, per the honesty rule in
`lib/homepage-images.ts`. Do not add a stock fallback.

All three use `next/image`: `fill` + `sizes="96px"` for the phone tiles,
fixed `26x26` and `34x34` for the map chips and the shortlist. That matters —
the source category photos are 30-65KB each and are rendered here at 26-96px,
so serving them raw would add roughly 300KB to the homepage for thumbnails.

Everything else — the phone, the map, the pins, the rings, the arcs — is drawn
in CSS. There is no background image in this section.

---

## 5. Breakpoints

Desktop-first, matching the rest of the homepage:

- **base** — 3 across, 1160px shell
- **`max-width: 1100px`** — still 3 across, tightened type and map furniture
- **`max-width: 760px`** — single column, 350px shell, connectors flip from
  right-arrows to down-arrows

Card heights are `auto`. The grid equalises each row, so longer copy cannot
clip — it just makes the row taller. Do not reintroduce fixed card heights.

The connector is positioned with `left: calc(100% + var(--qfh-gap) / 2)`, so
it stays centred in the gap if `--qfh-gap` changes. `.qfh-step` must keep
`overflow: visible` or the connectors get clipped — the visual pane does its
own corner clipping via `border-top-*-radius: inherit`.

---

## 6. Constraints — please keep these

These were decided deliberately. They are not oversights to tidy up.

1. **No star ratings, no review counts.** The source mockups had
   "4.8 (120)" style ratings. QuickFurno has no rating system and zero
   reviews, so those were removed. Chips show trade + distance instead.
2. **"Profile checked", not "Verified pro".** It matches the live
   "Verified Profiles" / "Reviewed before listed" language on the page.
3. **The three businesses are examples.** Abhijeet Interiors, Woodcraft Pune,
   Onestop Interiors — the same names and distances as the `/vendors`
   matching board (`app/vendors/vendors-content.ts` → `MATCH_PINS`), so the
   two pages agree. If you change them in one place, change both.
4. **The disclaimer stays.** `.qfh-note` — "Example Teams shown — illustrative
   preview, not live listings." The map also carries an illustrative
   `aria-label`. There is a test precedent for this:
   `scripts/mvp/suites/marketplace.mjs` asserts invented vendor names on the
   `/vendors` preview are labelled. Consider adding the same assertion here.
5. **No human faces.** The mockups used AI-generated photos of named people
   presented as verified vendors. Category photos are used instead.
6. **"Your location", not an invented customer.** The centre pin is the
   viewer, not "Priya Sharma".

---

## 7. Open item — the "Teams" wording

This section now says **"Teams"** (capitalised) where the rest of the page
says "pros" / "professionals":

- `We find eligible Teams`
- `up to 3 active Teams`
- `3 Teams matched`

That was a deliberate choice, but **the rest of the homepage has not been
swept yet**. As it stands the page says "eligible Teams" in this band and
"professionals" elsewhere. Either:

- sweep the rest of the homepage to "Teams", or
- change these three strings back to "pros" / "professionals".

Do not leave it half-and-half.

---

## 8. Known gap

The phone's header renders the wordmark as **styled text** (`Quick` + orange
`Furno`), not the real asset — the app screen is white and only the *light*
wordmark was available on the design canvas. The real file is already in the
repo at `public/assets/quickfurno/logos/qf-wordmark.webp`. Swapping it in is a
small change to `AppPreview()` in the component.

---

## 9. Checks before merging

- `npm run lint` and `npm run typecheck`
- `npm run build` — the homepage should still prerender
- Eyeball at 1280, 1024, 768 and 390
- Contrast: the disclaimer, the shortlist meta line and the search placeholder
  were each adjusted to clear 4.5:1. If you restyle them, re-check.
- `npm run test:mvp:marketplace` — passes today; make sure it still does

Note: the quality gate does not run `npm run build`, and does not run on
`main` — only on branch pushes and PRs. So run the build locally.
