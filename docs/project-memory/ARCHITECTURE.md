# QuickFurno Architecture Memory

Last reviewed: 2026-09-14

This file stores durable boundaries. Graphify provides the generated repository graph.

## Main repository areas

- `app/` — Next.js routes and application surfaces.
- `components/` — UI.
- `services/` — application/business services.
- `lib/` — contracts, domain helpers and shared logic.
- `supabase/` — migrations and database configuration.
- `automation/` — automation assets including n8n workflows.
- `scripts/` — tests, certification, governance and operator tooling.
- `ops/` — operational tooling where present.

## Authority boundaries

- **QuickFurno Core** owns governed business truth and mutations.
- **n8n** orchestrates workflows but does not become an alternate business database.
- **AOS V2** is advisory; recommendations are still governed by Core.
- **Communication providers** transport approved communication; provider state does not replace domain authority.
- **Project Brain** is context infrastructure only.

## Project Brain topology

```text
AI agents
  |-- canonical project-memory docs
  |-- Graphiti temporal memory
  |-- Graphify repository graph
  |-- Git/GitHub history
  `-- live systems only through existing governed interfaces
```

Graphify and Graphiti must stay additive and removable. QuickFurno must continue operating normally if both are offline.

Memory may explain or propose; memory alone may not:
- send WhatsApp;
- assign a lead;
- alter credits;
- enable a runtime;
- activate a provider mapping;
- apply a migration;
- deploy production.
