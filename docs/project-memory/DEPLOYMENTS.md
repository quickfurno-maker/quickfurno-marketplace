# QuickFurno Deployment Memory

Last reviewed: 2026-09-15

Record QuickFurno application deployments only when independently evidenced.

## QF-PB-BOOTSTRAP

Date: 2026-09-14 to 2026-09-15
Type: repository + local Project Brain runtime foundation
Source baseline: `main @ 2a5aa5f4cd2e77ea87d098b1a2e56881857fd464`
QuickFurno application deployment: **none**

Validated local memory runtime:
- Graphify `0.9.61` with SQL support; generated repository graph remains ignored from Git.
- Graphiti Core `0.30.2` in lightweight pinned image `quickfurno/graphiti-mcp:0.30.2-gemini-c035afb-r1`.
- Neo4j `5.26.0` with dedicated persistent QuickFurno Project Brain volumes.
- Gemini `gemini-3.5-flash-lite` + `gemini-embedding-001`.
- Graphiti MCP health and Neo4j connection validated.
- Six reviewed bootstrap episodes processed; temporal searches validated.
- Local endpoints bind to `127.0.0.1` only.

This record certifies the local Project Brain runtime only. It does not certify or modify QuickFurno staging/production application deployment.

## Deployment record template

```text
### QF-DEP-YYYYMMDD-NN
Environment:
Date/time:
Deployed commit:
Operator/evidence:
Migration versions applied:
Services restarted:
Health checks:
Provider/runtime posture:
Rollback point:
Result:
Notes:
```
