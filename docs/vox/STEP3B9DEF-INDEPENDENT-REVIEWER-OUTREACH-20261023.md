# 3B-9D/E/F — Independent reviewer outreach (unsent, no reviewer appointed)

## DBA — invitation draft
Subject: Independent PostgreSQL/Supabase DBA review — QuickFurno VOX staged migration and rollback
We are preparing a protected Staging release and need independent approval before managed DDL. We have 104 divergent migration versions (52 per environment), and 72 versions absent from current Git SQL paths but identifiable in managed migration ledgers. Seven shared migration versions have conflicting SQL-array fingerprints. Please review per-version historical SQL provenance and semantics, global roles/ACL/default grants, extension/data dependencies, rollback/PITR, auth/storage recovery and proposed exact SQL/release SHA. Evidence is in draft GitHub PR #404 and the new 3B9D packet. Access to historical SQL containing potentially sensitive material must be restricted, and no database changes are requested during review. Please provide signed findings, risks, required remediations and approve/reject decisions.

## AppSec — invitation draft
Subject: Independent application/database security review — QuickFurno VOX RLS and Owner/Staff IAM
We need an independent AppSec assessment before activating managed Staging. The evidence includes 69 RLS policies across 40 tables, 37 affecting writes or ALL commands, helper access grants, inactive Admin and suspended vendor edge cases, and multiple-policy composition. Please validate permissions under real PostgreSQL execution semantics, function/view privilege bypass, owner/staff AAL2, cross-tenant isolation, session revocation and historical transaction record access. Review exact candidate changes and provide independent signed accept/reject findings and test evidence. The source and scope are available in draft PR #404 and new 3B9E matrix. No Production change is authorized.

**Outreach status:** templates prepared only; no named independent DBA/AppSec assigned, no email or invitation sent, no signoff obtained. Owner must authorize reviewer access under least privilege.
