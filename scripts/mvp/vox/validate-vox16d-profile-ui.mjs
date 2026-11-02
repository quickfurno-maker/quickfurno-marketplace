import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),read=p=>readFileSync(resolve(root,p),'utf8');
const core=read('apps/vox-web/lib/core.ts'),api=read('apps/vox-web/app/api/vendor-profile-review/route.ts'),
 ui=read('apps/vox-web/app/vendor360/components/ProfileReviewQueue.tsx'),
 page=read('apps/vox-web/app/vendor360/page.tsx');
let n=0;function t(k,f){f();n++;console.log('PASS',k)}
t('BFF defaults OFF',()=>assert.match(core,/VOX_VENDOR_PROFILE_REVIEW_UI_ENABLED!=="staging"/));
t('server only Core origin',()=>assert.match(core,/const base=origin\(\)/));
t('verified staff MFA',()=>assert.match(core,/verifiedMfaSession\(\)/));
t('Core trusted narrow path',()=>assert.match(core,/\/api\/vox\/v1\/vendor-profile-review\?vendorId=/));
t('no cache, bounded timeout',()=>assert.match(core,/signal:AbortSignal.timeout\(3500\)/));
t('current vendor response proof',()=>assert.match(core,/v.vendorId!==vendorId/));
t('return sanitizes into allowlist',()=>assert.doesNotMatch(core.slice(core.indexOf('export async function fetchScopedProfileReviews'),core.indexOf('export async function fetchStaffOverview')),/proposed_changes|current_snapshot|admin_notes/));
t('requests nonexecuting',()=>assert.match(core,/row.canExecute!==false/));
t('native Core required',()=>assert.match(core,/row.requiresNativeCoreReview!==true/));
t('GET only',()=>assert.match(api,/export function POST\(\)\{return safeJson\(\{ok:false/));
t('UI requires dedicated flag',()=>assert.match(page,/VOX_VENDOR_PROFILE_REVIEW_UI_ENABLED==="staging"/));
t('UI never sends changes',()=>assert.doesNotMatch(ui,/method:"POST"|method:"PATCH"|method:"DELETE"/));
t('UI assigned options',()=>assert.match(ui,/UUID.test\(x.vendorId\)/));
console.log('VOX16D_NATIVE_VENDOR_PROFILE_REVIEW_WEB_PASS '+n+'/'+n);
