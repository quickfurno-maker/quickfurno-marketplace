import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const files = {
  operatingMigration: read("supabase/migrations/20261002043238_vendor_v3_v5_operating_flow.sql"),
  connectionMigration: read("supabase/migrations/20261002044054_vendor_v3_connection_delivery_gate.sql"),
  indexMigration: read("supabase/migrations/20261002045022_vendor_v3_v5_fk_indexes.sql"),
  triggerMigration: read("supabase/migrations/20261002052224_vendor_v3_db_delivery_projection.sql"),
  lifecycleService: read("services/leadAssignmentLifecycleService.ts"),
  webhookService: read("services/metaWhatsAppWebhookService.ts"),
  matching: read("services/leadMatchingEngine.ts"),
  vendorService: read("services/vendorService.ts"),
  leadsModel: read("components/vendor-dashboard-v2/leads/leadsModel.ts"),
  leadCard: read("components/vendor-dashboard-v2/leads/VendorLeadCard.tsx"),
  actions: read("app/actions.ts"),
  recoveryService: read("services/badLeadRecoveryService.ts"),
  recoveryAos: read("lib/aos/v2/badLeadRecoveryRecommendation.ts"),
  adminUi: read("components/admin/LeadMatchingAuditPanels.tsx"),
  vendorIntelligence: read("services/vendorIntelligenceService.ts"),
  nativeWorker: read("worker/nativeAutomationWorker.ts"),
  jarvisContract: read("lib/jarvis/contextContract.ts"),
  jarvisRead: read("lib/jarvis/contextRead.ts"),
  jarvisService: read("services/jarvisContextService.ts"),
  conversational: read("services/conversationalWhatsAppService.ts"),
};

let passed = 0;
let failed = 0;
function check(name, condition) {
  const n = String(passed + failed + 1).padStart(2, "0");
  if (condition) { passed += 1; console.log(`PASS ${n} ${name}`); }
  else { failed += 1; console.error(`FAIL ${n} ${name}`); }
}

// V3 — real provider-confirmed delivery + acknowledgement.
check("V3 provider delivery projection requires WhatsApp lead-assignment template",
  files.operatingMigration.includes("v_message.channel is distinct from 'whatsapp'")
  && files.operatingMigration.includes("v_message.template_key is distinct from 'lead_assignment_alert'"));
check("V3 delivery projection requires delivered/read provider truth",
  files.operatingMigration.includes("v_message.status not in ('delivered','read')"));
check("V3 delivery projection resolves canonical communication intent",
  files.operatingMigration.includes("v_intent.aggregate_type is distinct from 'lead_assignment'")
  && files.operatingMigration.includes("v_intent.template_purpose is distinct from 'vendor_lead_assigned'"));
check("V3 only advances assigned to delivered", files.operatingMigration.includes("lifecycle_status = 'assigned'"));
check("V3 writes append-only delivery lifecycle event", files.operatingMigration.includes("'delivery_confirmed:'"));
check("V3 creates a real provider-linked delivery log", files.operatingMigration.includes("communication_message_id") && files.operatingMigration.includes("provider_delivered_at"));
check("V3 fairness clock is provider delivery based", files.operatingMigration.includes("last_delivered_at"));
check("V3 delivery RPC contains no credit mutation primitive",
  !/qf_apply_(?:vendor_)?credit|remaining_credits\s*=|total_credits\s*=/.test(
    files.operatingMigration.slice(
      files.operatingMigration.indexOf("qf_project_vendor_lead_delivery_v1"),
      files.operatingMigration.indexOf("qf_acknowledge_vendor_lead_v1")
    )
  ));
check("V3 acknowledgement is delivered to accepted only",
  files.operatingMigration.includes("v_assignment.lifecycle_status <> 'delivered'")
  && files.operatingMigration.includes("set lifecycle_status='accepted'"));
check("V3 acknowledgement replay is explicit", files.operatingMigration.includes("'already_applied'"));
check("V3 response evidence requires provider-confirmed delivery", files.connectionMigration.includes("QF_CONNECTION_DELIVERY_REQUIRED"));
check("V3 response implies acknowledgement without second authority", files.connectionMigration.includes("vendor_response_implied_ack"));
check("V3 lifecycle RPCs are service-role only",
  files.operatingMigration.includes("grant execute on function public.qf_project_vendor_lead_delivery_v1(uuid) to service_role")
  && files.operatingMigration.includes("grant execute on function public.qf_acknowledge_vendor_lead_v1(uuid,uuid) to service_role"));
check("V3 webhook projects lifecycle only after canonical delivery processing",
  files.webhookService.indexOf("const res = await service.processWebhook")
    < files.webhookService.indexOf("const lifecycleProjection = await projectLeadAssignmentLifecycleFromProviderMessages"));
check("V3 lifecycle projection reads canonical communication_messages", files.lifecycleService.includes('.from("communication_messages")'));
check("V3 vendor acknowledgement derives vendor identity server-side",
  files.actions.includes("vendorAcknowledgeLeadFromForm") && files.actions.includes("const me = await getMyVendor()"));
check("V3 browser gets lifecycle state but no operation/credit evidence",
  files.vendorService.includes("lifecycle_status")
  && !files.leadsModel.includes("operation_id")
  && !files.leadsModel.includes("credit_deducted"));
check("V3 lead UI exposes acknowledgement only after delivered", files.leadsModel.includes('canAcknowledge: row.lifecycle_status === "delivered"'));
check("V3 connection UI waits for provider delivery", files.leadCard.includes("Available after QuickFurno confirms lead delivery."));
check("V3 matcher consumes provider delivery fairness", files.matching.includes("const lastDeliveredAt = fairness?.ledger_present") && files.matching.includes("? fairness.last_delivered_at") && files.matching.includes(": asText(vendor.last_delivered_at)") && files.matching.includes("last_assigned_at: lastDeliveredAt"));
check("V3 matcher does not consume vendor last_assigned_at", !files.matching.includes("last_assigned_at: asText(vendor.last_assigned_at)"));
check("V3 fairness evidence names provider-confirmed consumption under the fair-opportunity model", files.matching.includes("fairness_model: FAIRNESS_MODEL_VERSION") && files.matching.includes('opportunity_consumption: "provider_confirmed_delivery"'));
check("V3 database trigger projects only canonical delivered/read lead-assignment messages",
  files.triggerMigration.includes("new.channel = 'whatsapp'")
  && files.triggerMigration.includes("new.template_key = 'lead_assignment_alert'")
  && files.triggerMigration.includes("new.status in ('delivered','read')"));
check("V3 database trigger reuses the single canonical delivery projection RPC",
  files.triggerMigration.includes("perform public.qf_project_vendor_lead_delivery_v1(new.id)"));
check("V3 database trigger is idempotency-friendly on unchanged delivery truth",
  files.triggerMigration.includes("old.status is not distinct from new.status")
  && files.triggerMigration.includes("old.delivered_at is not distinct from new.delivered_at")
  && files.triggerMigration.includes("old.read_at is not distinct from new.read_at"));
check("V3 database trigger is not callable by browser or service roles",
  files.triggerMigration.includes("from public, anon, authenticated, service_role"));

// V4 — human-governed recovery.
check("V4 report recovery vocabulary is constrained", files.operatingMigration.includes("restore_credit_and_replace") && files.operatingMigration.includes("bad_lead_reports_recovery_status_check"));
check("V4 non-reject mutation requires reviewed report", files.operatingMigration.includes("human_review_required"));
check("V4 original assignment is invalidated before recovery", files.operatingMigration.includes("'bad_lead_validated'") && files.operatingMigration.includes("lifecycle_status='invalid'"));
check("V4 credit restoration reuses existing canonical approval RPC", files.operatingMigration.includes("public.qf_approve_credit_restoration_v2("));
check("V4 restoration approval is idempotency-keyed", files.operatingMigration.includes("bad_lead_recovery:'||v_report.id::text||':credit"));
check("V4 replacement request is idempotency-keyed", files.operatingMigration.includes("bad_lead_recovery:'||v_report.id::text||':replacement"));
check("V4 replacement request carries human approver", files.operatingMigration.includes("p_actor_id,p_actor_id,v_now"));
check("V4 DB recovery does not auto-select replacement vendors",
  !files.operatingMigration.includes("qf_assign_lead_vendors_v2"));
check("V4 AOS recommendation is pure advisory", !/supabase|adminClient|fetch\(|executeCanonicalAssignment/.test(files.recoveryAos));
check("V4 AOS recommendation never mutates recovery", files.recoveryAos.includes("cannot restore credits"));
check("V4 application service ranks replacements through existing MatchCore", files.recoveryService.includes("evaluateVendorsForLead"));
check("V4 replacement assignment uses sole canonical assignment authority", files.recoveryService.includes("executeCanonicalAssignment") && files.recoveryService.includes('mode:"replacement"'));
check("V4 replacement assignment binds approved replacement request", files.recoveryService.includes("replacementRequestId"));
check("V4 replacement finalization is separate and governed", files.recoveryService.includes("qf_finalize_replacement_request_v1"));
check("V4 application service never directly updates vendor credits",
  !files.recoveryService.includes("remaining_credits") && !files.recoveryService.includes("total_credits"));
check("V4 admin recovery is Superadmin-gated through asAdmin", files.actions.includes("adminApplyBadLeadRecovery") && files.actions.includes("asAdmin(async (actor)"));
check("V4 admin UI requires explicit human confirmation", files.adminUi.includes("Confirm human recovery decision"));
check("V4 admin UI keeps recommendation separate from execution",
  files.adminUi.includes("Generate recovery recommendation") && files.adminUi.includes("Restore credit + replace"));
check("V4 finalization links invalid original to canonical replacement", files.operatingMigration.includes("replaced_by_assignment_id=v_new.id"));
check("V4 browser roles cannot execute recovery RPCs", files.operatingMigration.includes("VENDOR_V3_V5_AUTHORITY_EXPOSED"));

// V5 — Anisha advisory intelligence.
check("V5 notifications use an idempotent dedupe key", files.operatingMigration.includes("uq_vendor_notifications_dedupe_key"));
check("V5 intelligence service writes only vendor_notifications",
  files.vendorIntelligence.includes('.from("vendor_notifications").insert')
  && !/\.from\("(?:vendors|lead_assignments|vendor_packages|vendor_credit_logs|replacement_requests|bad_lead_reports)"\)\.update/.test(files.vendorIntelligence));
check("V5 low-credit signal is advisory", files.vendorIntelligence.includes('"low_credit"'));
check("V5 package-expiry signal is advisory", files.vendorIntelligence.includes('"package_expiry"'));
check("V5 inactivity/reactivation signal is advisory", files.vendorIntelligence.includes('"reactivation"'));
check("V5 delivered-unacknowledged lead signal is advisory", files.vendorIntelligence.includes('"lead_ack_required"'));
check("V5 worker runs only behind existing vendor_journey control", files.nativeWorker.includes('isAutomationStudioWorkflowEnabled("vendor_journey")'));
check("V5 worker reuses native maintenance worker", files.nativeWorker.includes("runVendorIntelligenceMaintenance"));
check("V5 Anisha context remains vendor-only by contract",
  files.jarvisContract.includes('request.actor === "ANISHA" && r.entityType !== "vendor"')
  || files.jarvisContract.includes('r.actor === "ANISHA" && r.entityType !== "vendor"'));
check("V5 Anisha context exposes readiness bands not raw credit balance",
  files.jarvisContract.includes("packageReadinessBand")
  && !files.jarvisContract.includes("remainingCredits"));
check("V5 Anisha gets bounded operating counts",
  files.jarvisContract.includes("activeLeadCount")
  && files.jarvisContract.includes("deliveredUnacknowledgedCount")
  && files.jarvisContract.includes("pendingBadLeadReportCount")
  && files.jarvisContract.includes("unreadNotificationCount"));
check("V5 vendor context source aggregates Core truth read-only",
  files.jarvisService.includes('.from("lead_assignments")')
  && files.jarvisService.includes('.from("bad_lead_reports")')
  && files.jarvisService.includes('.from("vendor_notifications")'));
check("V5 vendor context does not select client phone/email", !/phone|email/.test(files.jarvisService));
check("V5 package expiry is bucketed before reaching Anisha", files.jarvisRead.includes("packageExpiryBand:expiryBand"));
check("V5 existing conversational layer still routes vendor to Anisha", files.conversational.includes("ANISHA"));
check("V5 intelligence service cannot invoke canonical assignment or credit authority",
  !/executeCanonicalAssignment|qf_assign_lead|qf_apply_credit|qf_apply_vendor_credit/.test(files.vendorIntelligence));

// Whole-slice authority guards.
check("V3-V5 migration never grants lifecycle/recovery RPCs to browser roles",
  files.operatingMigration.includes("revoke all on function public.qf_apply_bad_lead_recovery_v1")
  && files.operatingMigration.includes("from public, anon, authenticated"));
check("V3-V5 new foreign keys have covering indexes",
  files.indexMigration.includes("idx_bad_lead_reports_credit_restoration_approval_id")
  && files.indexMigration.includes("idx_bad_lead_reports_replacement_request_id")
  && files.indexMigration.includes("idx_lead_delivery_logs_communication_intent_id"));
check("V3-V5 production-side sends were not introduced by the new intelligence service",
  !/sendWhatsapp|dispatchCommunication|MetaCloudWhatsAppProvider|CommunicationService/.test(files.vendorIntelligence));
check("V3-V5 recovery UI contains no direct Supabase/database client", !/supabase|adminClient/.test(files.adminUi));

console.log(`\nVendor V3-V5 guard: ${passed}/${passed + failed} checks passed.`);
if (failed > 0) process.exit(1);
