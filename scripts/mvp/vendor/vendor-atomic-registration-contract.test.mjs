import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync("supabase/migrations/20261104153000_vendor_atomic_pending_registration.sql","utf8");
const service=readFileSync("services/vendorAtomicSignupService.ts","utf8");
const code=service.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^\s*\/\/.*$/gm,"");

test("T1 one SQL transaction creates three account rows and nothing operational",()=>{
  assert.match(sql,/create or replace function public\.qf_register_pending_vendor_atomic/);
  assert.match(sql,/returns table\(outcome text, vendor_id uuid\)/);
  assert.match(sql,/insert into public\.vendors\s*\(/);
  assert.match(sql,/update public\.profiles set role='vendor'/);
  assert.match(sql,/where id=p_auth_user_id and role is null/);
  assert.match(sql,/insert into public\.vendor_dashboard_users\s*\(/);
  assert.match(sql,/'Pending','Pending','Unpaid',false,false/);
  assert.match(sql,/false,0,0,'unverified',null,null,null/);
  assert.match(sql,/false,false,null,null/);
  assert.doesNotMatch(sql,/insert into public\.(?:lead_assignments|vendor_credit_logs|payments)/i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.(?:vendors|profiles|vendor_dashboard_users)/i);
});

test("T2 DB lock plus unique indexes, no historical adoption or silent backfill",()=>{
  for(const index of ["uq_qf_vendor_signup_auth_principal","uq_qf_vendor_signup_mobile_10","uq_qf_vendor_signup_owner_membership"])
    assert.ok(sql.includes(index),index);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/v_existing_owner is distinct from p_auth_user_id/);
  assert.match(sql,/v_mapping_vendor is distinct from v_existing_id/);
  assert.match(sql,/owner_repair_required/);
  assert.match(sql,/resume_existing/);
  assert.match(sql,/created_pending/);
  assert.doesNotMatch(sql,/on conflict\s+do\s+nothing/i);
});

test("T3 SQL rechecks private vendor purpose, Auth phone and WhatsApp message",()=>{
  for(const token of [
    "from auth.users", "v_phone_confirmed_at is null",
    "from public.client_accounts", "r.purpose='vendor_login'",
    "r.state='claimed'","r.auth_user_id=p_auth_user_id",
    "m.message_type='vendor_login_otp'", "m.channel='whatsapp'",
    "m.entity_id=p_auth_user_id","m.destination_hash=p_destination_hash",
    "m.provider=p_provider_key","m.correlation_id=v_webhook_id"
  ]) assert.ok(sql.includes(token),token);
  assert.match(sql,/r\.created_at>now\(\)-interval '10 minutes'/);
  assert.match(sql,/m\.status in \('accepted','sent','delivered','read'\)/);
  assert.match(sql,/p_registration->>'registration_consent_version' is distinct from '2026-11-04-v1'/);
});

test("T4 browser cannot call service-role-only registration RPC",()=>{
  assert.match(sql,/revoke all on function public\.qf_register_pending_vendor_atomic\(uuid,text,text,text,jsonb\)\s+from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.qf_register_pending_vendor_atomic\(uuid,text,text,text,jsonb\)\s+to service_role/);
  assert.match(service,/import "server-only"/);
  assert.match(service,/QF_VENDOR_ATOMIC_SIGNUP_MODE !== "staging"/);
  assert.match(service,/verifyVendorSignupWhatsappOtp\(otpInput, runtime\)/);
  assert.match(service,/await sb\.auth\.getUser\(\)/);
  assert.match(service,/readClaimedVendorOtpPurpose\(phoneE164, current\.user\.id\)/);
  assert.match(service,/adminClient\(\)\.rpc\("qf_register_pending_vendor_atomic"/);
  assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(|\.sendMessage\(|\.auth\.admin\./);
});

test("T5 client cannot submit role, credit, verification or session authorization",()=>{
  const m=service.match(/const payload = \{([\s\S]*?)\n    \};/);
  assert.ok(m,"allowlisted RPC input absent");
  for(const prohibited of ["role:","paid_status:","status:","remaining_credits:","total_credits:","accepting_leads:","public_visibility:","user_id:","authUserId:","office_latitude:"])
    assert.ok(!m[1].includes(prohibited),prohibited);
  assert.match(sql,/p_registration->'registration_consent_accepted' is distinct from 'true'::jsonb/);
  assert.match(service,/mobile10 !== verified\.mobile10/);
  assert.match(service,/current\.user\.id !== verified\.authUserId/);
});
