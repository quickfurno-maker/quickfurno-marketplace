import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const owner=readFileSync(new URL("../../../components/admin/OwnerMfaSetup.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../../../app/admin/security/mfa/page.tsx",import.meta.url),"utf8");
test("P1 Owner enrollment route is server-gated to Staging and genuine Superadmin session",()=>{
 for(const marker of [
  'VOX_OWNER_MFA_STAGING_ENABLED','VOX_DEPLOYMENT_ENV',
  '!== "staging"','uckafzuochmbvtiodmcl.supabase.co','getAdminSession','!owner.isSuperadmin','!owner.userId'
 ])assert.ok(page.includes(marker),marker);
 assert.match(page,/redirect\("\/admin\/login"\)/);
 assert.doesNotMatch(page,/auth\.admin\.inviteUserByEmail|createUser|service_role/);
});
test("P1 factor is created and challenged solely by current browser Supabase Auth identity",()=>{
 for(const marker of [
  'sb.auth.getUser()', 'identity.user?.id!==expectedOwnerId',
  'identity.user.app_metadata?.admin_role!=="Superadmin"',
  'sb.auth.mfa.listFactors()','sb.auth.mfa.getAuthenticatorAssuranceLevel()',
  'sb.auth.mfa.enroll(', 'factorType:"totp"',
  'sb.auth.mfa.challengeAndVerify(', 'currentLevel!=="aal2"',
  'x.status==="verified"','setQrCode(null)','setCode("")'
 ])assert.ok(owner.includes(marker),marker);
});
test("P1 MFA code/QR cannot be logged, placed in URLs or persisted in user-managed storage",()=>{
 for(const forbidden of [
  'localStorage','sessionStorage','console.log','console.error',
  'serviceRoleKey','NEXT_PUBLIC_SUPABASE_SERVICE_ROLE',
  'auth.admin.', 'URLSearchParams','document.cookie', 'fetch("/api/'
 ])assert.equal(owner.includes(forbidden),false,forbidden);
 assert.match(owner,/do not share/i);assert.match(owner,/autoComplete="one-time-code"/);
});
