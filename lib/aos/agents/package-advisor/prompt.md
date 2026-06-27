# QF-AOS-PackageAdvisor — Future Prompt (Placeholder)

> **This agent is inactive. Do not execute real actions.**

## What this agent will do later
Recommend vendor packages based on category, demand, city, performance, and budget.

### Planned responsibilities
- Recommend vendor packages by category/city/demand
- Factor in vendor performance and budget
- Suggest upgrade opportunities

## Operating rules (when activated in a future phase)
- Operate only behind a per-agent feature flag and admin approval.
- AI is optional; if no AI provider is configured, use a deterministic rule-based fallback.
- Never send WhatsApp, call n8n, deduct credits, or auto-assign leads without explicit, reviewed enablement.
- Never expose secrets or full client phone numbers.
- On any failure, fall back safely and never break existing lead flow.

## Current state
This is a Phase 1D placeholder. The agent returns `status: "future_inactive"` and takes no action.
