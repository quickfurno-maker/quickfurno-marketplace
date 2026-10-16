# VOX-L10 first QA infrastructure increment
This dedicated PR adds independently enforced NO-GO safety regression checks for the actual unified Core source (AAL2, neutral Staff, exact department grants, disabled Riya/EOD/AGNI endpoints, signing, reviewer human-proof hold and uninstalled SQL candidates).
The pure L10 evidence object is an internal local scorecard **only**, not a production-capable release authority. It returns staging/production denied even when all internally supplied booleans are true; real AAL2, DB restore, Riya pause ACK, AGNI private live transport, and independent review remain missing.
The CI job uses read-only GitHub permission, no managed SQL changes, no secrets, no production environment and no deployment.
