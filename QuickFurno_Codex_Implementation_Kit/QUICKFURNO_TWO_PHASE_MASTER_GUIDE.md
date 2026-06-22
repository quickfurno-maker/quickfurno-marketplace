# QuickFurno Two-Phase Website Completion Plan

## Phase 1 — Claude: Strategy, Design, Copy, Animation

Use Claude only for planning and reusable design decisions. Do not ask Claude to edit the project directly unless absolutely needed.

Claude tasks:
1. Final design system
2. Final website copy
3. Animation plan
4. Component hierarchy
5. UX review after screenshots

Use prompts inside:
`01_PHASE_1_CLAUDE/`

Output from Claude should be saved as markdown notes, then passed to Codex.

## Phase 2 — Codex in VS Code: Implementation and Testing

Use Codex only for code work inside the existing QuickFurno project.

Codex sequence:
1. Copy assets to `public/assets/quickfurno`
2. Inspect project, no changes
3. Add global design system
4. Redesign homepage only
5. Test and commit
6. Redesign vendor listing only
7. Test and commit
8. Redesign vendor landing page only
9. Test and commit
10. Test forms and Supabase
11. Polish mobile
12. Add lightweight animations
13. Final production check
14. Deploy

Use prompts inside:
`02_PHASE_2_CODEX/`

## Token-saving rule

One prompt = one page or one task.

Do not ask: “Redesign the whole website.”
Ask: “Only redesign homepage. Do not touch other pages.”

## Backend safety rule

Never allow Codex to change:
- Supabase keys
- environment variables
- database schema unless you approve
- deployment config
- working lead submission logic

## Vendor priority logic for MVP

- Show all enabled vendors in category
- Paid/subscribed vendors appear first
- Paid vendors receive client leads
- Non-paid vendors remain visible with “Ask Vendor to Contact” or WhatsApp future CTA
- Hide only vendors who disable themselves or are disabled by admin
