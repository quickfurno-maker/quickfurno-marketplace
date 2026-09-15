# QuickFurno Decision Log

## QF-DEC-001 — Adopt Unified Project Brain v1
Date: 2026-09-14
Status: active

Use Graphify for repository intelligence, Graphiti for temporal memory, `docs/project-memory/` for reviewed truth, Git/GitHub for engineering history, and MCP for shared AI access.

## QF-DEC-002 — Source-of-truth hierarchy
Date: 2026-09-14
Status: active

Resolve conflicts in this order: independently verified live state -> current deployed code/schema -> canonical project-memory docs -> Graphiti -> Graphify -> historical chats/notes.

## QF-DEC-003 — Project Brain is out-of-band
Date: 2026-09-14
Status: active

Graphify and Graphiti must not be placed in the critical execution path for QuickFurno business operations.

## QF-DEC-004 — Split temporal memory from code intelligence
Date: 2026-09-14
Status: active

Graphiti stores changing project history. Graphify maps repository structure and relationships. Do not force either to replace the other.

## QF-DEC-005 — Pune-only launch remains current
Date: 2026-09-14
Status: active
Source anchor: PR #84 / bootstrap source commit.

Treat Pune as the only launch geography until explicitly superseded.

## Decision template

```text
## QF-DEC-NNN — Title
Date:
Status: proposed | active | superseded
Supersedes:
Evidence:
Decision:
Reason:
Consequences:
```
