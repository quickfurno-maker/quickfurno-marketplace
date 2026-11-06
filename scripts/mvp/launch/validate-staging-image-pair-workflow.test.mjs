import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {auditStagingImagePairWorkflow} from "./validate-staging-image-pair-workflow.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const workflow=readFileSync(resolve(root,".github/workflows/qf-p4-staging-image-pair.yml"),"utf8");
function mutation(name,oldString,newString,expected){
 test(name,()=>{
  assert.ok(workflow.includes(oldString),"mutation anchor must exist");
  const outcome=auditStagingImagePairWorkflow(workflow.replace(oldString,newString));
  assert.equal(outcome.valid,false);
  assert.ok(outcome.failures.includes(expected),outcome.failures.join(","));
  assert.equal(outcome.releaseAuthorized,false);
  assert.equal(outcome.deploys,false);
 });
}
test("intact Staging publisher policy passes but NEVER authorizes deployment",()=>{
 const report=auditStagingImagePairWorkflow(workflow);
 assert.deepEqual(report.failures,[]);
 assert.equal(report.valid,true);
 assert.equal(report.releaseAuthorized,false);
});
mutation("auto publish on PR is blocked","github.event_name == 'workflow_dispatch'","github.event_name == 'pull_request'","MANUAL_PUBLISH_REQUIRED");
mutation("missing main branch pin blocked","github.ref == 'refs/heads/main'","github.ref == 'refs/heads/my-feature'","PROTECTED_MAIN_REQUIRED");
mutation("missing explicit confirmation blocked","inputs.typed_confirmation == 'PUBLISH_STAGING_PAIR_ONLY'","inputs.typed_confirmation == 'anything'","HUMAN_CONFIRMATION_REQUIRED");
mutation("missing repo permit blocked","vars.QF_STAGING_IMAGE_PUBLISH_APPROVED == 'true'","true","EXPLICIT_REPO_SWITCH_REQUIRED");
mutation("missing environment gate blocked","    environment: staging","    environment: none","STAGING_ENV_REQUIRED");
mutation("wrong Staging project blocked","test \"$STAGING_URL\" = \"https://uckafzuochmbvtiodmcl.supabase.co\"","test \"$STAGING_URL\" = \"https://example.supabase.co\"","STAGING_URL_EXACT");
mutation("missing per-image vulnerability policy blocked","enforce-trivy-report.mjs core-trivy.json","echo skip-core-trivy","BOTH_IMAGE_VULN_POLICIES");
mutation("missing VOX attestation blocked","steps.registry.outputs.vox_digest","steps.registry.outputs.invalid_digest","BOTH_ATTESTATIONS");
mutation("remote deployment attempt blocked","          docker push \"$CORE_IMAGE:$GITHUB_SHA\"","          ssh staging-server echo bad\n          docker push \"$CORE_IMAGE:$GITHUB_SHA\"","NO_DEPLOY_COMMANDS");
mutation("privileged key injection blocked","          docker push \"$CORE_IMAGE:$GITHUB_SHA\"","          SUPABASE_SERVICE_ROLE_KEY=unsafe\n          docker push \"$CORE_IMAGE:$GITHUB_SHA\"","NO_SERVICE_SECRETS");
mutation("unpinned external action blocked","actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1","actions/checkout@main","ALL_EXTERNAL_ACTIONS_PINNED");
mutation("opaque project-unspecified public key blocked",'if(key.startsWith("sb_publishable_"))process.exit(78)','if(key.startsWith("sb_publishable_"))process.exit(0)',"OPAQUE_PUBLIC_KEY_FAIL_CLOSED");
mutation("registry image swap blocked","$(cat core-build-image-id.txt)","$(cat unexpected-core-image.txt)","PUBLISH_MUST_MATCH_BUILD_IMAGE_IDS");
mutation("absent Core attestation verification blocked",'gh attestation verify "oci://$CORE_REF"','echo skip-core-attestation',"VERIFY_BOTH_REGISTRY_ATTESTATIONS");
mutation("unauthenticated private attestation verification blocked",'GH_TOKEN: "${{ github.token }}"','GH_TOKEN: ""',"AUTHENTICATED_ATTESTATION_VERIFY");
mutation("missing signed identities blocked","cosign verify --certificate-identity","cosign verify --unsafe-ignore-signed","BOTH_COSIGN_SIGNATURES");
