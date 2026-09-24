# Real homepage photos — drop files here

The homepage automatically switches from illustrations to real photos when
files with these exact names appear in this folder (next deploy picks them up).
Use `.webp` or `.jpg`. Landscape, well-lit, photos only when QuickFurno has documented ownership or publication rights. Do not use watermarked, watermark-removed, scraped, or provenance-unknown images.

## File list

| File                                   | Where it appears                  | Ideal size        |
| -------------------------------------- | --------------------------------- | ----------------- |
| `hero.jpg`                             | Big hero image, top of homepage   | 1200×760, < 250KB |
| `trust.jpg`                            | Trust & safety panel ("PUNE LAUNCH") | 1200×900, < 180KB |
| `categories/interior-designers.jpg`    | Interior Designers service card   | 400×300, < 60KB   |
| `categories/carpenters.jpg`            | Carpenters service card           | 400×300, < 60KB   |
| `categories/modular-factory.jpg`       | Modular Factory service card      | 400×300, < 60KB   |
| `categories/premium-interiors.jpg`     | Premium Interiors service card    | 400×300, < 60KB   |
| `categories/sofa.jpg`                  | Sofa service card                 | 400×300, < 60KB   |
| `categories/painter.jpg`               | Painter service card              | 400×300, < 60KB   |
| `categories/civil-work.jpg`            | Civil Work service card           | 400×300, < 60KB   |
| `categories/false-ceiling.jpg`         | False Ceiling service card        | 400×300, < 60KB   |

## Slots from the 2026 boards

These have **no illustrated fallback**. Until the file exists the section
renders a reserved empty frame; drop the file in and it appears on the next
build. Same rule as above: `.webp` wins over `.jpg`.

| File                    | Where it appears                         | Ideal size         |
| ----------------------- | ---------------------------------------- | ------------------ |
| `how-step-1.webp`       | How it works, step 1                     | 900×1100, < 140KB  |
| `how-step-3.webp`       | How it works, step 3                     | 900×1100, < 140KB  |
| `faq-person.webp`       | FAQ section, right side                  | 900×1100, < 140KB  |
| `pro-cutout.webp`       | Tradesman, alpha cut-out (4 sections)    | ~600×1000 ✅ added |
| `homeowner-cutout.webp` | Homeowner, alpha cut-out (3 sections)    | ~600×880 ✅ added  |
| `vendor-coverage-map.webp` | /vendors Pune coverage map            | 1040×650, < 160KB  |

Both cut-outs carry a real alpha channel and were split from a single
two-person export. They are used at roughly 300–450px wide, so they are
stored at source size rather than upscaled.

### Substituted, not needed unless you want an upgrade

| Was going to be   | Using instead                                        |
| ----------------- | ---------------------------------------------------- |
| 8 3D trade tiles  | the eight real photos in `categories/`               |
| phone mockup      | the `.qfv-phone` mockup already built in CSS         |
| dashboard capture | built as real HTML, so it carries no invented figures |

Nothing in these may show invented vendor names, ratings, review counts or
prices. A screenshot that fabricates marketplace data is the one thing the
homepage rules forbid outright.

Partial is fine: add only `hero.jpg` and the hero becomes a photo while the
cards keep their illustrations. Delete a file to go back to the illustration.
