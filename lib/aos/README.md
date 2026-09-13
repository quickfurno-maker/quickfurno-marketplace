# QuickFurno AOS V2

QuickFurno AOS is the internal intelligence layer for the QuickFurno lead-generation marketplace.
It is not the business authority, customer-care system, or execution engine.

## Permanently locked platform roles

- **QuickFurno Core** = business truth, policy, validation, money/credits, assignment and authorization. Core is the integration hub.
- **AOS** = internal analysis, recommendations, prioritization, risk, matching intelligence and operational summaries.
- **Jarvis** = future customer conversation and customer-care layer, integrated only through QuickFurno Core.
- **n8n** = execution/orchestration of work already authorized by QuickFurno Core.

AOS must not directly command Jarvis or n8n. Jarvis must not directly mutate AOS or business state. n8n must not invent business decisions.

## Permanently locked seven agents

1. `QF-AOS-NexusKernel` — authority guard and recommendation coordination.
2. `QF-AOS-FurnoMemory` — structured internal memory derived from canonical Core facts.
3. `QF-AOS-LeadLens` — canonical lead-quality intelligence.
4. `QF-AOS-TrustShield` — duplicate, hard-gate and platform-risk intelligence.
5. `QF-AOS-MatchForge` — canonical vendor-matching intelligence.
6. `QF-AOS-LeadFlow` — lead lifecycle intelligence through verified vendor delivery.
7. `QF-AOS-OpsBrief` — read-only lead-generation operations reporting.

## Lead-generation business boundary

QuickFurno responsibility ends at **verified vendor lead delivery**, except for platform obligations that arise from that delivery.

QuickFurno owns:
- lead capture, validation, consent and quality gates;
- vendor eligibility, matching, assignment and verified delivery;
- credit correctness and delivery evidence;
- lead-validity/replacement disputes;
- platform support, privacy, audit and abuse controls.

After verified delivery, the vendor and client own:
- quotation and pricing;
- site visits;
- negotiation;
- project execution;
- whether the commercial relationship converts or closes.

AOS must not manage those post-delivery commercial stages or create KPIs that make QuickFurno operationally accountable for them.
