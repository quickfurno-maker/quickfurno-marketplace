"""Phase 3B-18B: local read-only check of actual Production logical backup.
No managed endpoints, no PII output, no restoration, no change to archive.
Selected-table recovery proof is NOT a full Supabase recovery certificate.
"""
import argparse,hashlib,json,pathlib,subprocess,sys
EXPECTED_SHA="5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797"
EXPECTED={
 "vendors":29,"leads":74,"lead_assignments":71,"lead_assignment_events":73,
 "vendor_credit_logs":81,"lead_delivery_logs":135,"assignment_operations":36,
 "client_notification_logs":41,"automation_transport_requests":32165,
 "users":10,"identities":10,"sessions":22,"profiles":10,
 "lead_assignment_queue":7,"lead_assignment_approvals":4,
 "lead_scores":32,"lead_matching_runs":36,"vendor_notifications":15,
 "vendor_dashboard_users":8,"lead_clarification_requests":6,"bad_lead_reports":1
}
AUTH_TABLES={"users","identities","sessions"}
def check(dirpath,restore_bin):
 root=pathlib.Path(dirpath)
 archive=root/"quickfurno-production-prealltestpurge-20261024.dump"
 manifest_path=root/"quickfurno-production-prealltestpurge-20261024-manifest.json"
 evidence_path=root/"quickfurno-production-restore-allactive-plus-20261025-evidence.json"
 if not all(f.is_file() for f in (archive,manifest_path,evidence_path)):
  raise ValueError("ARCHIVE_MANIFEST_OR_PRIVATE_RESTORE_EVIDENCE_MISSING")
 m=json.loads(manifest_path.read_text(encoding="utf-8-sig"))
 e=json.loads(evidence_path.read_text(encoding="utf-8-sig"))
 h=hashlib.sha256()
 with archive.open("rb") as f:
  for chunk in iter(lambda:f.read(1<<20),b""):h.update(chunk)
 digest=h.hexdigest().upper()
 if digest!=EXPECTED_SHA or str(m.get("sha256","")).upper()!=EXPECTED_SHA:
  raise ValueError("ARCHIVE_DIGEST_MISMATCH")
 if archive.stat().st_size!=4879114 or m.get("bytes")!=4879114:
  raise ValueError("ARCHIVE_SIZE_MISMATCH")
 if m.get("source_project_ref")!="yqpgcsduqbxulrlzwzap" or m.get("environment")!="QuickFurno Production":
  raise ValueError("ARCHIVE_PROJECT_MISMATCH")
 if m.get("action")!="READ_ONLY_EXPORT":raise ValueError("ARCHIVE_SOURCE_NOT_READ_ONLY")
 if e.get("archive_sha256","").upper()!=EXPECTED_SHA or e.get("archive_bytes")!=4879114:
  raise ValueError("RESTORE_EVIDENCE_ARCHIVE_MISMATCH")
 if e.get("restored_counts")!=EXPECTED:raise ValueError("RESTORE_COUNTS_MISMATCH")
 if e.get("selected_orphan_refs")!=0 or e.get("selected_table_restore_verified") is not True:
  raise ValueError("RESTORE_SELECTED_REFS_NOT_CERTIFIED")
 if e.get("restored_vendor_auth_links")!="9|8|9":
  raise ValueError("RESTORED_VENDOR_AUTH_CROSS_LINKS_NOT_CERTIFIED")
 if e.get("local_postgres_stopped") is not True:raise ValueError("SCRATCH_SERVER_NOT_STOPPED")
 if e.get("full_database_restore_verified") is not False or e.get("roles_acl_storage_binaries_pitr_verified") is not False:
  raise ValueError("IMPROPER_FULL_RECOVERY_ATTESTATION")
 result=subprocess.run([restore_bin,"--list",str(archive)],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=35)
 if result.returncode:raise ValueError("RESTORE_TOC_INVALID")
 toc=result.stdout
 for t in EXPECTED:
  schema="auth" if t in AUTH_TABLES else "public"
  if not any(" TABLE DATA "+schema+" "+t+" " in line for line in toc.splitlines()):
   raise ValueError("TABLE_DATA_TOC_MISSING_"+schema+"_"+t)
 return {
  "status":"21_SELECTED_TABLES_RESTORABLE_EVIDENCE_PASS",
  "archive_sha256":digest,"archive_bytes":4879114,
  "selected_restored_tables":21,"selected_orphan_refs":0,
  "linked_auth_users":9,"linked_auth_sessions":8,
  "full_supabase_restore_certified":False,
  "production_deletion_authorized":False,
  "outstanding":["GLOBAL_ROLES_AND_ACL","POSTGIS_3_3_7",
   "VAULT_0_3_1","FULL_FK_RLS_AND_TRIGGER_CLONE",
   "PITR_RESTORE","STORAGE_BINARY_RECOVERY",
   "AUTH_SERVICE_LIFECYCLE","IMMUTABLE_EVENT_PRESERVATION_REVIEW"]
 }
if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--backup-dir",required=True)
 ap.add_argument("--pg-restore",default="C:/Program Files/PostgreSQL/17/bin/pg_restore.exe")
 args=ap.parse_args()
 try:
  print(json.dumps(check(args.backup_dir,args.pg_restore),indent=2))
 except Exception as exc:
  print("STEP3B18_LOCAL_READ_ONLY_RECOVERY_AUDIT_FAIL:"+str(exc),file=sys.stderr)
  sys.exit(1)
