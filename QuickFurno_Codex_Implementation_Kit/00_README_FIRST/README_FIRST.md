# QuickFurno Claude + Codex Implementation Kit

This ZIP is structured so you can upload it to Claude/Codex and implement the website in phases without wasting tokens.

## Folder Map

- `01_PHASE_1_CLAUDE/` — prompts for Claude only. Use Claude for final design system, UX decisions, copy, and animation plan.
- `02_PHASE_2_CODEX/` — prompts for Codex only. Use Codex inside VS Code for file inspection, coding, testing, and deployment preparation.
- `03_DESIGN_SYSTEM/` — colors, CSS variables, Tailwind snippet, fonts, UI rules.
- `04_PUBLIC_ASSETS/quickfurno/` — ready-to-use SVG icons, logos, illustrations, vendor thumbnails, and UI reference mockups.
- `05_DATA_SEEDS/` — sample category/vendor JSON for Codex to map into components.
- `06_DOCS_AND_CHECKLISTS/` — full plan document and test checklists.
- `07_DEPLOYMENT_COMMANDS/` — local Git and server commands.

## Important Implementation Rule

Do not create a new project from scratch. Use the existing QuickFurno project and replace/redesign the frontend in phases while keeping:
- Supabase integration
- Existing environment variables
- Lead forms
- Existing routes where possible
- Deployment setup

## How to use assets in code

Copy the folder:

`04_PUBLIC_ASSETS/quickfurno`

to your project:

`public/assets/quickfurno`

Then use paths like:

`/assets/quickfurno/logos/quickfurno-logo.svg`
`/assets/quickfurno/icons/categories/interiors.svg`
`/assets/quickfurno/images/hero/hero-interior-diorama.svg`

## Two-phase workflow

Phase 1: Claude finalizes design/copy/animation rules. No coding.
Phase 2: Codex implements page-by-page inside VS Code and tests each phase.
