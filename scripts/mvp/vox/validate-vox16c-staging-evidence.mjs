import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const ledger=JSON.parse(readFileSync(resolve(root,'supabase/staging-history/qf-post-g1-migration-ledger-20260929.json'),'utf8'));
const rows=ledger.records.filter(r=>String(r.version).startsWith('20261014')&&String(r.name).startsWith('vox_'));
assert.equal(rows.length,7);
for(const r of rows){
 const bytes=readFileSync(resolve(root,r.path)).toString('utf8').replace(/\r\n?/g,'\n');
 const sum=createHash('sha256').update(bytes).digest('hex');
 assert.equal(sum,r.canonicalSha256);
 assert.equal(r.exactVersionPresence?.staging,false);
 assert.equal(r.exactVersionPresence?.production,false);
}
const mandatory=[
 'independently_verified_full_staging_backup',
 'archive_checksum_verified',
 'restore_to_separate_isolated_database',
 'post_restore_table_rls_and_row_count_report',
 'owner_signed_db_migration_approval',
 'staging_auth_aal2_scope_tests',
 'signed_web_core_jarvis_gateway_release',
 'rollback_rehearsal'
];
const report={schema:'qf.vox.staging.release.evidence.v1',
 sourceCommit:process.env['GITHUB_SHA']||'LOCAL_SOURCE',
 migrationCount:rows.length,
 migrationSetDigest:createHash('sha256').update(rows.map(x=>x.version+':'+x.canonicalSha256).join('|')).digest('hex'),
 stagingRelease:'HOLD',productionRelease:'HOLD',migrationApplyAuthorized:false,
 missingMandatoryProof:mandatory,reason:'REAL_STAGING_BACKUP_AND_RESTORE_UNVERIFIED'};
assert.equal(report.migrationSetDigest,'798b6b5182817807cabf5e6b5373960fca7f6f26ecb9896f43ec55dc2d7a0022');
if(process.argv.includes('--authorize')||process.argv.includes('--apply')){
 console.error('DENY_STAGING_PROMOTION_MISSING_PROOF');process.exit(42);
}
console.log('VOX16C_STAGING_HOLD_SOURCE_GATE_PASS '+JSON.stringify(report));
